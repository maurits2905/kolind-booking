// Local stand-in for Supabase, for development and end-to-end tests only.
//
// Serves the app and implements the small part of the Supabase API the app
// uses (email/password auth + RPC) on top of a local Postgres that has
// dev/supabase-stub.sql and supabase/setup.sql loaded.
//
//   cd dev && npm install && node local-supabase.mjs      → http://localhost:8787
//
// Env: PGHOST, PGPORT, PGUSER, PGDATABASE (as for psql), PORT (default 8787).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const SECRET = 'local-dev-jwt-secret-not-for-production';
const API_KEY = 'sb_publishable_local_dev';
const pool = new pg.Pool({ database: process.env.PGDATABASE || 'kolind_dev', max: 8 });
const refreshTokens = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// ---------- JWT (HS256) ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (sig !== parts[2]) return null;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    ...headers,
  });
  res.end(body === undefined ? '' : isJson ? JSON.stringify(body) : body);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}
function authError(res, status, code, msg) {
  send(res, status, { code: status, error_code: code, msg });
}
function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.email_confirmed_at, phone: '', app_metadata: u.raw_app_meta_data || {},
    user_metadata: u.raw_user_meta_data || {}, identities: [], created_at: u.created_at,
    updated_at: u.updated_at, last_sign_in_at: u.last_sign_in_at, is_anonymous: false,
  };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const access = signJwt({
    sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email,
    iat: now, exp: now + expiresIn, session_id: crypto.randomUUID(),
    user_metadata: u.raw_user_meta_data || {}, app_metadata: u.raw_app_meta_data || {},
  });
  const refresh = crypto.randomBytes(24).toString('base64url');
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: expiresIn, expires_at: now + expiresIn,
           refresh_token: refresh, user: userJson(u) };
}
function bearerClaims(req) {
  const h = req.headers.authorization || '';
  return verifyJwt(h.replace(/^Bearer\s+/i, ''));
}

// ---------- auth (GoTrue subset) ----------
async function handleAuth(req, res, url) {
  const route = url.pathname.replace('/auth/v1', '');
  if (route === '/signup' && req.method === 'POST') {
    const { email, password, data } = await readBody(req);
    if (!password || password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters.');
    const client = await pool.connect();
    try {
      await client.query('set role supabase_auth_admin');
      const { rows } = await client.query(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at, last_sign_in_at)
         values (lower($1), extensions.crypt($2, extensions.gen_salt('bf', 8)), $3, now(), now()) returning *`,
        [email, password, data || {}]);
      return send(res, 200, session(rows[0]));
    } catch (e) {
      if (e.code === '23505') return authError(res, 422, 'user_already_exists', 'User already registered');
      console.warn('[signup]', e.message);
      return authError(res, 500, 'unexpected_failure', 'Database error saving new user');
    } finally {
      await client.query('reset role');
      client.release();
    }
  }
  if (route === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const { rows } = await pool.query(
        `update auth.users set last_sign_in_at = now()
         where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)
         returning *`, [body.email, body.password]);
      if (!rows[0]) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      return send(res, 200, session(rows[0]));
    }
    if (grant === 'refresh_token') {
      const uid = refreshTokens.get(body.refresh_token);
      if (!uid) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(body.refresh_token);
      const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
      if (!rows[0]) return authError(res, 400, 'user_not_found', 'User not found');
      return send(res, 200, session(rows[0]));
    }
    return authError(res, 400, 'unsupported_grant_type', 'Unsupported grant type');
  }
  if (route === '/user') {
    const claims = bearerClaims(req);
    if (!claims) return authError(res, 401, 'no_authorization', 'Invalid JWT');
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.password) {
        await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 8)),
                          updated_at = now() where id = $1`, [claims.sub, body.password]);
      }
    }
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
    if (!rows[0]) return authError(res, 404, 'user_not_found', 'User not found');
    return send(res, 200, userJson(rows[0]));
  }
  if (route === '/logout') return send(res, 204);
  return authError(res, 404, 'not_found', `Not implemented in local emulator: ${route}`);
}

// ---------- REST (PostgREST RPC subset) ----------
const fnCache = new Map();
async function functionInfo(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const { rows } = await pool.query(
    `select p.proargnames as args, p.pronargs as nargs, p.pronargdefaults as ndefaults,
            format_type(p.prorettype, null) as ret, p.provolatile as volatile
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`, [name]);
  const info = rows[0] || null;
  fnCache.set(name, info);
  return info;
}
function pgrstStatus(code, authenticated) {
  if (code === '42501') return authenticated ? 403 : 401;
  if (/^23/.test(code)) return 409;
  if (code === '42883' || code === 'PGRST202') return 404;
  return 400;
}
async function handleRest(req, res, url) {
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
  if (!m || req.method !== 'POST') {
    return send(res, 404, { code: 'PGRST000', message: 'Only POST /rest/v1/rpc/<fn> is emulated locally.' });
  }
  const fn = m[1];
  const info = await functionInfo(fn);
  if (!info) {
    return send(res, 404, { code: 'PGRST202', details: null, hint: null,
      message: `Could not find the function public.${fn} in the schema cache` });
  }
  const args = await readBody(req);
  const claims = bearerClaims(req);
  const role = claims ? 'authenticated' : 'anon';
  const names = Object.keys(args);
  const sqlArgs = names.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const values = names.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(claims || { role: 'anon' })]);
    const { rows } = await client.query(`select public.${fn}(${sqlArgs}) as result`, values);
    await client.query('commit');
    if (info.ret === 'void') return send(res, 204);
    return send(res, 200, rows[0].result ?? null);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    const status = pgrstStatus(e.code, !!claims);
    return send(res, status, { code: e.code, details: e.detail ?? null, hint: e.hint ?? null, message: e.message });
  } finally {
    client.release();
  }
}

// ---------- static files ----------
async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || rel.includes('/dev/') || rel.includes('/.')) return send(res, 404, 'Not found');
  try {
    let data = await fs.readFile(file);
    if (rel === '/config.js') {
      data = data.toString()
        .replace(/supabaseUrl:\s*'[^']*'/, `supabaseUrl: 'http://${req.headers.host}'`)
        .replace(/supabaseKey:\s*'[^']*'/, `supabaseKey: '${API_KEY}'`);
    }
    send(res, 200, data, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream',
                           'cache-control': 'no-store' });
  } catch {
    send(res, 404, 'Not found');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url);
    return await handleStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
}).listen(PORT, () => console.log(`Kolind Booking (lokal) kører på http://localhost:${PORT}`));
