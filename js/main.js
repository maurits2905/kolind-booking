import config from '../config.js';
import { isConfigured, auth } from './api.js';
import { state, emit, subscribe, isAdmin, refreshMeQuietly } from './state.js';
import { loadSessionData } from './session.js';
import { route, start, parse, navigate } from './router.js';
import { html, mount, $ } from './html.js';
import { renderShell } from './shell.js';
import { errorState } from './ui.js';
import { icon } from './icons.js';

import home from './views/home.js';
import property from './views/property.js';
import calendarView from './views/calendar.js';
import mine from './views/mine.js';
import adminView from './views/admin.js';
import profile from './views/profile.js';
import { login, invite, reset } from './views/auth.js';
import { guestRequest, guestStatus } from './views/guest.js';
import setup from './views/setup.js';

route('/', home);
route('/bolig/:id', property);
route('/kalender', calendarView);
route('/mine', mine);
route('/admin', adminView);
route('/admin/:tab', adminView);
route('/profil', profile);
route('/login', login);
route('/invitation/:token', invite);
route('/nulstil/:token', reset);
route('/gaest/:token', guestRequest);
route('/status/:token', guestStatus);

const viewEl = () => $('#view');
let cleanup = null;
let lastPath = null;
let renderSeq = 0;

function inactiveView() {
  return html`<div class="state-page"><div class="inner">
    <div class="empty-icon">${icon('lock')}</div>
    <h1 class="h2">${state.me ? 'Din adgang er sat på pause' : 'Kontoen har ingen adgang'}</h1>
    <p class="muted">${state.me ? '' : 'Kontoen er ikke oprettet via en invitation. '}Kontakt ${config.adminNames || 'en administrator'}, hvis det er en fejl.</p>
    <button class="btn" type="button" data-logout>Log ud</button>
  </div></div>`;
}

// The loading screen (#boot) shows its emblem after 250 ms. Once the emblem is
// visible it stays at least ~0.7 s so it never flickers, then fades out.
let bootDone = false;
function hideBoot() {
  if (bootDone) return;
  bootDone = true;
  const el = document.getElementById('boot');
  if (!el) return;
  const shown = performance.now() - 250;
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 600);
  }, shown > 0 ? Math.max(0, 700 - shown) : 0);
}

async function onRoute() {
  const r = parse();
  const seq = ++renderSeq;
  if (!r.view) return navigate('/', { replace: true });
  const v = r.view;

  if ((v.access === 'member' || v.access === 'admin') && !state.session) {
    return navigate(`/login?next=${encodeURIComponent(r.path)}`, { replace: true });
  }
  if (v.access === 'admin' && !isAdmin()) return navigate('/', { replace: true });

  cleanup?.();
  cleanup = null;
  const el = viewEl();
  el.removeAttribute('data-theme');
  el.className = 'view';
  void el.offsetWidth;
  el.classList.add('view');

  const samePage = Boolean(lastPath?.startsWith('/admin') && r.path.startsWith('/admin'));
  if (!samePage) window.scrollTo({ top: 0, behavior: 'instant' });
  else el.classList.add('no-anim');

  const linkRoute = v.chrome === 'guest' || v.chrome === 'minimal' || r.path === '/login';
  if (state.session && !state.me?.active && !linkRoute) {
    renderShell({ path: r.path, chrome: 'minimal', overHero: false });
    mount(el, inactiveView());
    el.querySelector('[data-logout]').addEventListener('click', () => auth.signOut());
    hideBoot();
    return;
  }

  const chrome = v.chrome || 'full';
  const overHero = typeof v.overHero === 'function' ? v.overHero(r) : Boolean(v.overHero);
  renderShell({ path: r.path, chrome, overHero });
  document.title = [v.title?.(r) || '', config.siteName].filter(Boolean).join(' · ');

  try {
    const result = await v.render(el, r);
    if (seq !== renderSeq) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = typeof result === 'function' ? result : null;
  } catch (err) {
    console.error(err);
    mount(el, html`<div class="state-page"><div class="inner">${errorState(err)}</div></div>`);
    el.querySelector('[data-retry]')?.addEventListener('click', () => onRoute());
  }
  hideBoot();

  if (lastPath !== null && !samePage) el.focus({ preventScroll: true });
  lastPath = r.path;
}

async function boot() {
  if (!isConfigured()) {
    renderShell({ path: '/', chrome: 'minimal', overHero: false });
    await setup.render(viewEl());
    hideBoot();
    return;
  }

  try {
    state.session = await auth.session();
    await loadSessionData();
  } catch (err) {
    renderShell({ path: '/', chrome: 'minimal', overHero: false });
    mount(viewEl(), html`<div class="state-page"><div class="inner">${errorState(err)}</div></div>`);
    viewEl().querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
    hideBoot();
    return;
  }

  auth.onChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      state.session = null;
      state.me = null;
      state.properties = [];
      state.byId = {};
      state.calendar = { from: null, to: null, entries: [], at: 0 };
      emit();
      navigate('/');
    } else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      state.session = session;
    }
  });

  // Keep the admin badge and data fresh when the app comes back into view.
  let lastSeen = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.session) return;
    if (Date.now() - lastSeen < 60_000) return;
    lastSeen = Date.now();
    state.calendar.at = 0;
    await refreshMeQuietly();
    renderShell();
    emit();
  });

  subscribe(() => renderShell());
  start(onRoute);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

setTimeout(hideBoot, 15000); // never leave the loading screen up if something hangs

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
