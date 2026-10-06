// Header, mobile tab bar and footer.

import config from '../config.js';
import { html, mount, $ } from './html.js';
import { icon } from './icons.js';
import { state, isAdmin, isMember, firstName } from './state.js';
import { initials } from './ui.js';
import { auth } from './api.js';

const header = () => $('#site-header');
const tabbar = () => $('#tabbar');

let current = { path: '/', chrome: 'full', overHero: false };

export function wordmark() {
  const name = (config.siteName || 'Kolind Booking').trim();
  const words = name.split(/\s+/);
  const accent = words.length > 1 ? words.pop() : '';
  return html`<a class="wordmark" href="#/" aria-label="${name}, forside">${words.join(' ')}${accent ? html`<span class="amp">${accent}</span>` : ''}</a>`;
}

function isActive(path, target) {
  if (target === '/') return path === '/';
  return path === target || path.startsWith(`${target}/`);
}

export function renderShell({ path = current.path, chrome = current.chrome, overHero = current.overHero } = {}) {
  current = { path, chrome, overHero };
  const h = header();
  h.classList.toggle('is-over-hero', overHero);
  h.classList.toggle('is-solid', !overHero);

  const member = isMember();
  const admin = isAdmin();
  const pending = admin ? state.me?.pending_count || 0 : 0;
  const badge = pending ? html`<span class="nav-badge" aria-label="${pending} afventer">${pending}</span>` : '';
  const cur = (t) => (isActive(path, t) ? 'page' : 'false');

  const nav =
    chrome === 'full' && member
      ? html`<nav class="main-nav" aria-label="Hovedmenu">
          <a href="#/" aria-current="${cur('/')}">Husene</a>
          <a href="#/kalender" aria-current="${cur('/kalender')}">Kalender</a>
          <a href="#/mine" aria-current="${cur('/mine')}">Mine ophold</a>
          ${admin ? html`<a href="#/admin" aria-current="${cur('/admin')}">Administration${badge}</a>` : ''}
        </nav>`
      : '';

  let actions = '';
  if (chrome === 'full' && state.session && state.me) {
    actions = html`<div class="menu-wrap">
      <button class="avatar-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Konto: ${state.me.full_name}" data-account>
        ${initials(state.me.full_name)}
      </button>
      <div class="menu" role="menu" hidden>
        <div class="menu-head">
          <strong>${state.me.full_name}</strong>
          <span class="tiny muted">${state.me.email}</span>
        </div>
        <a href="#/profil" role="menuitem">${icon('user')}Profil og adgangskode</a>
        <a href="#/mine" role="menuitem">${icon('suitcase')}Mine ophold</a>
        ${admin ? html`<a href="#/admin" role="menuitem">${icon('admin')}Administration</a>` : ''}
        <button type="button" role="menuitem" data-logout>${icon('log-out')}Log ud</button>
      </div>
    </div>`;
  } else if (chrome === 'full' && !state.session && path !== '/login') {
    actions = html`<a class="btn btn-sm ${overHero ? 'btn-glass' : 'btn-primary'}" href="#/login">Log ind</a>`;
  }

  mount(
    h,
    html`<div class="container header-inner">
      ${wordmark()}
      ${nav}
      <div class="header-actions">${actions}</div>
    </div>`,
  );

  const acc = $('[data-account]', h);
  if (acc) {
    const menu = acc.nextElementSibling;
    const close = () => {
      menu.hidden = true;
      acc.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', outside, true);
      document.removeEventListener('keydown', esc);
    };
    const outside = (e) => {
      if (!menu.contains(e.target) && e.target !== acc) close();
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        close();
        acc.focus();
      }
    };
    acc.addEventListener('click', () => {
      const open = menu.hidden;
      if (!open) return close();
      menu.hidden = false;
      acc.setAttribute('aria-expanded', 'true');
      menu.querySelector('a,button')?.focus();
      setTimeout(() => {
        document.addEventListener('click', outside, true);
        document.addEventListener('keydown', esc);
      });
    });
    menu.addEventListener('click', async (e) => {
      if (e.target.closest('[data-logout]')) {
        close();
        await auth.signOut();
        return;
      }
      if (e.target.closest('a')) close();
    });
  }

  // Mobile tab bar
  const tb = tabbar();
  const showTabs = chrome === 'full' && member;
  tb.hidden = !showTabs;
  document.body.classList.toggle('has-tabbar', showTabs);
  if (showTabs) {
    mount(
      tb,
      html`<a href="#/" aria-current="${cur('/')}">${icon('home')}<span>Husene</span></a>
        <a href="#/kalender" aria-current="${cur('/kalender')}">${icon('calendar')}<span>Kalender</span></a>
        <a href="#/mine" aria-current="${cur('/mine')}">${icon('suitcase')}<span>Mine ophold</span></a>
        ${admin
          ? html`<a href="#/admin" aria-current="${cur('/admin')}">${icon('admin')}<span>Admin</span>${badge}</a>`
          : html`<a href="#/profil" aria-current="${cur('/profil')}">${icon('user')}<span>Profil</span></a>`}`,
    );
  }
}

export function footer() {
  const member = isMember();
  return html`<footer class="site-footer">
    <div class="container row">
      <div>
        ${wordmark()}
        <p class="small" style="margin-top:8px">${config.siteTagline || ''}${state.me ? html` · Hej ${firstName(state.me.full_name)}` : ''}</p>
      </div>
      ${member
        ? html`<nav aria-label="Genveje">
            <a href="#/kalender">Kalender</a>
            <a href="#/mine">Mine ophold</a>
            <a href="#/profil">Profil</a>
          </nav>`
        : html`<nav><a href="#/login">Log ind</a></nav>`}
    </div>
  </footer>`;
}

// Header turns solid once the hero has scrolled away.
let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      header()?.classList.toggle('is-scrolled', window.scrollY > 24);
      ticking = false;
    });
  },
  { passive: true },
);
