// End-to-end test of the main flows against the local emulator.
//
//   ./reset-local-db.sh && node local-supabase.mjs   (in another terminal)
//   npm install playwright && npx playwright install chromium
//   node e2e.mjs
//
// Env: BASE (default http://localhost:8787/), CHROME_PATH (optional browser
// binary), SHOTS (folder for screenshots, default ./shots). Uses psql with
// the usual PG* variables to check what ended up in the database.

import { chromium, devices } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.env.SHOTS || new URL('./shots', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8787/';
const DB = process.env.PGDATABASE || 'kolind_dev';
const sql = (q) => execSync(`psql -d ${DB} -Atc "${q}"`).toString().trim();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const errors = [];
async function newPage(kind) {
  const ctx = await browser.newContext(kind === 'mobile'
    ? { ...devices['iPhone 13'], locale: 'da-DK', timezoneId: 'Europe/Copenhagen' }
    : { viewport: { width: 1440, height: 900 }, locale: 'da-DK', timezoneId: 'Europe/Copenhagen' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${kind}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${kind} pageerror] ${e.message}`));
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 503, body: '' }));
  return page;
}
async function login(page, email) {
  await page.goto(`${BASE}#/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'ferie2026');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
  await page.waitForTimeout(600);
}
async function pickRange(page, scope, nights) {
  // choose first selectable day in the visible month(s) whose following nights are free
  const days = await page.$$eval(`${scope} .cal-day[data-date]`, (els) => els.map((e) => ({ d: e.dataset.date, un: e.classList.contains('is-unavailable') })));
  for (let i = 0; i < days.length - nights; i++) {
    if (days[i].un) continue;
    let ok = true;
    for (let k = 1; k < nights; k++) if (days[i + k].un) ok = false;
    if (!ok) continue;
    await page.click(`${scope} .cal-day[data-date="${days[i].d}"]`);
    await page.click(`${scope} .cal-day[data-date="${days[i + nights].d}"]`);
    return [days[i].d, days[i + nights].d];
  }
  throw new Error('no free range');
}
const step = (m) => console.log('✓', m);

// 1. Member request on mobile
{
  const page = await newPage('mobile');
  await login(page, 'dorte@familien.dk');
  await page.goto(`${BASE}#/bolig/odde`);
  await page.waitForSelector('.cal-day[data-date]');
  await page.click('.cal-host [data-nav="1"]');
  await page.waitForTimeout(300);
  const [s, e] = await pickRange(page, '.cal-host', 3);
  await page.waitForSelector('.selection-bar:not([hidden])');
  await page.screenshot({ path: `${OUT}/flow-member-selection.png` });
  await page.click('.selection-bar [data-continue]');
  await page.waitForSelector('dialog.sheet[open] [data-submit]');
  await page.waitForTimeout(500);
  await page.click('dialog.sheet [data-step="1"]');
  await page.fill('dialog.sheet textarea[name=comment]', 'Vi tager hunden med, hvis det er ok?');
  await page.screenshot({ path: `${OUT}/flow-member-sheet.png` });
  await page.click('dialog.sheet [data-submit]');
  await page.waitForSelector('dialog.sheet .success-mark');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/flow-member-success.png` });
  const st = sql(`select status||':'||guests from bookings where person_name='Dorte' and start_date='${s}' and end_date='${e}'`);
  if (st !== 'pending:3') throw new Error('request not stored correctly: ' + st);
  step(`member request stored pending ${s}→${e} with 3 guests`);
  const mailHref = await page.getAttribute('dialog.sheet [data-mail-open]', 'href');
  if (!/^mailto:[^?]*anne@familien\.dk/.test(mailHref) || !/^mailto:[^?]*bent@familien\.dk/.test(mailHref) || !mailHref.includes('subject=Ny%20foresp')) {
    throw new Error('mail draft to admins wrong: ' + mailHref);
  }
  step('ready-made mail to Anne and Bent is shown');
  await page.click('dialog.sheet [data-mine]');
  await page.waitForSelector('.booking-card');
  step('navigated to Mine ophold');
  await page.context().close();
}

// 2. Admin approves on desktop
{
  const page = await newPage('desktop');
  await login(page, 'bent@familien.dk');
  await page.goto(`${BASE}#/admin`);
  await page.waitForSelector('.request-card');
  const id = sql(`select id from bookings where person_name='Dorte' and status='pending' and comment like 'Vi tager hunden%'`);
  await page.click(`.request-card [data-approve="${id}"]`);
  await page.waitForSelector('dialog.sheet[open] textarea');
  await page.fill('dialog.sheet textarea', 'Selvfølgelig, hunden er velkommen.');
  await page.screenshot({ path: `${OUT}/flow-admin-confirm.png` });
  await page.click('dialog.sheet [data-ok]');
  await page.waitForSelector('.toast-success');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/flow-admin-approved.png` });
  const st = sql(`select status||':'||decision_note from bookings where id='${id}'`);
  if (!st.startsWith('approved:Selvfølgelig')) throw new Error('approve failed: ' + st);
  step('admin approved with message');
  await page.waitForSelector('dialog.sheet[open] [data-mail-open]');
  const decisionHref = await page.getAttribute('dialog.sheet[open] [data-mail-open]', 'href');
  if (!decisionHref.startsWith('mailto:dorte@familien.dk?subject=Godkendt')) throw new Error('decision mail wrong: ' + decisionHref);
  await page.screenshot({ path: `${OUT}/flow-admin-mail.png` });
  await page.click('dialog.sheet[open] .sheet-close');
  await page.waitForTimeout(500);
  step('ready-made approval mail to Dorte pops up');
  // Try to approve conflicting Peter? create block via quick action
  await page.click('[data-new="blocked"]');
  await page.waitForSelector('dialog.sheet[open] .picker-cal .cal-day');
  await page.click('dialog.sheet [data-prop] [data-value="odde"]');
  await page.waitForTimeout(400);
  await page.click('dialog.sheet .picker-cal [data-nav="1"]');
  await page.click('dialog.sheet .picker-cal [data-nav="1"]');
  await page.waitForTimeout(300);
  const [bs, be] = await pickRange(page, 'dialog.sheet .picker-cal', 2);
  await page.waitForTimeout(400);
  await page.fill('dialog.sheet input[name=title]', 'Nyt tag');
  await page.screenshot({ path: `${OUT}/flow-admin-block.png` });
  await page.click('dialog.sheet [data-submit]');
  await page.waitForSelector('.toast-success >> text=blokeret');
  const bst = sql(`select kind||':'||status from bookings where title='Nyt tag'`);
  if (bst !== 'blocked:approved') throw new Error('block failed ' + bst);
  step(`admin blocked ${bs}→${be}`);
  // open booking detail from list
  await page.goto(`${BASE}#/admin/ophold`);
  await page.waitForSelector('.booking-row');
  await page.click('.booking-row >> nth=2');
  await page.waitForSelector('dialog.sheet[open] .detail');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/flow-admin-detail.png` });
  step('booking detail opens');
  await page.context().close();
}

// 3. Guest flow on mobile
{
  const page = await newPage('mobile');
  await page.goto(`${BASE}#/gaest/local-guest-link-peter-000`);
  await page.waitForSelector('[data-pick-prop]');
  await page.screenshot({ path: `${OUT}/flow-guest-start.png`, fullPage: true, animations: 'disabled' });
  await page.click('[data-pick-prop="odde"]');
  await page.waitForSelector('.cal-host .cal-day[data-date]');
  await page.click('.cal-host [data-nav="1"]');
  await page.click('.cal-host [data-nav="1"]');
  await page.waitForTimeout(300);
  const [gs, ge] = await pickRange(page, '.cal-host', 2);
  await page.waitForSelector('.guest-form input[name=name]');
  await page.fill('.guest-form input[name=name]', 'Anne Holm');
  await page.fill('.guest-form input[name=email]', 'anne@example.com');
  await page.fill('.guest-form textarea[name=comment]', 'Tusind tak for tilbuddet!');
  await page.screenshot({ path: `${OUT}/flow-guest-form.png`, fullPage: true, animations: 'disabled' });
  await page.click('.guest-form [type=submit]');
  await page.waitForSelector('.status-card');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/flow-guest-status.png`, fullPage: true, animations: 'disabled' });
  const g = sql(`select status||':'||source from bookings where person_name='Anne Holm'`);
  if (g !== 'pending:guest') throw new Error('guest failed ' + g);
  step(`guest request ${gs}→${ge}`);
  await page.context().close();
}

// 4. Invite flow on desktop
{
  const page = await newPage('desktop');
  await page.goto(`${BASE}#/invitation/local-invite-ida-00000000`);
  await page.waitForSelector('input[name=password]');
  await page.screenshot({ path: `${OUT}/flow-invite.png` });
  await page.fill('input[name=password]', 'idas-kode-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.hero .display');
  await page.waitForTimeout(800);
  const p = sql(`select role from profiles where email='ida@familien.dk'`);
  if (p !== 'member') throw new Error('invite failed ' + p);
  step('invite accepted, Ida logged in as member');
  await page.screenshot({ path: `${OUT}/flow-invite-home.png` });
  await page.context().close();
}

const real = errors.filter((e) => !e.includes('503'));
console.log(real.length ? 'ERRORS:\n' + real.join('\n') : 'All flows passed without console errors.');
if (real.length) process.exitCode = 1;
await browser.close();
