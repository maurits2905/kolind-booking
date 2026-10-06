import config from '../../config.js';
import { html, mount, $ } from '../html.js';
import { icon } from '../icons.js';
import { auth, links } from '../api.js';
import { state, firstName } from '../state.js';
import { signedIn } from '../session.js';
import { navigate } from '../router.js';
import { busy, toast, nextId } from '../ui.js';

function art() {
  return html`<div class="auth-art" aria-hidden="true">
    <figure class="auth-photo auth-photo-a"><img src="assets/img/mallorca-portrait.webp" alt="" style="object-position:52% 50%"></figure>
    <figure class="auth-photo auth-photo-b"><img src="assets/img/odde-portrait.webp" alt="" style="object-position:46% 55%"></figure>
  </div>`;
}

function passwordField(id, label, { autocomplete = 'current-password', hint = '' } = {}) {
  return html`<div class="field">
    <label class="label" for="${id}">${label}</label>
    <div class="input-wrap">
      <input class="input" id="${id}" name="password" type="password" autocomplete="${autocomplete}" required minlength="${autocomplete === 'new-password' ? 8 : 1}">
      <button class="reveal" type="button" aria-label="Vis adgangskode" aria-pressed="false" data-reveal>${icon('eye')}</button>
    </div>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;
}

function bindReveal(root) {
  root.querySelectorAll('[data-reveal]').forEach((b) =>
    b.addEventListener('click', () => {
      const input = b.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(show));
      b.setAttribute('aria-label', show ? 'Skjul adgangskode' : 'Vis adgangskode');
      mount(b, icon(show ? 'eye-off' : 'eye'));
    }),
  );
}

function page(inner) {
  return html`<div class="auth-page">
    <div class="auth-grid container">
      ${art()}
      <div class="auth-panel">${inner}</div>
    </div>
  </div>`;
}

function safeNext(next) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export const login = {
  access: 'public',
  title: () => 'Log ind',
  async render(el, r) {
    const next = safeNext(r.query.next);
    if (state.session && state.me) return navigate(next, { replace: true });
    const ids = { email: nextId('email'), pw: nextId('pw') };
    mount(
      el,
      page(html`<form class="auth-card" novalidate>
        <p class="eyebrow">${config.siteTagline}</p>
        <h1 class="h1">Velkommen <em>tilbage</em></h1>
        <p class="muted">Log ind for at se ledige datoer, dine ophold og praktisk info om husene.</p>
        <div class="field">
          <label class="label" for="${ids.email}">Email</label>
          <input class="input" id="${ids.email}" name="email" type="email" autocomplete="username" inputmode="email" required autofocus>
        </div>
        ${passwordField(ids.pw, 'Adgangskode')}
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Log ind</button>
        <details class="forgot">
          <summary>Glemt adgangskoden?</summary>
          <p class="small muted">Bed ${config.adminNames} om et link til en ny adgangskode. De laver det under Administration → Familie.
            Er du ny, skal du bruge det invitationslink, du har fået tilsendt.</p>
        </details>
      </form>`),
    );
    const form = $('form', el);
    bindReveal(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!email || !password) {
        err.textContent = 'Udfyld både email og adgangskode.';
        return;
      }
      try {
        await busy(form.querySelector('[type="submit"]'), async () => {
          const session = await auth.signIn(email, password);
          await signedIn(session, next);
        });
      } catch (ex) {
        err.textContent = ex.message;
        form.password.select();
      }
    });
  },
};

export const invite = {
  access: 'public',
  chrome: 'minimal',
  title: () => 'Opret konto',
  async render(el, r) {
    const token = r.params.token;
    mount(el, page(html`<div class="auth-card"><div class="skeleton sk-title"></div><div class="skeleton" style="height:180px"></div></div>`));
    let info;
    try {
      info = await links.invitation(token);
    } catch (e) {
      mount(el, page(html`<div class="auth-card"><div class="form-error">${icon('alert')}${e.message}</div></div>`));
      return;
    }
    if (!info || !info.valid) {
      mount(
        el,
        page(html`<div class="auth-card">
          <div class="empty-icon">${icon(info?.used ? 'check' : 'link')}</div>
          <h1 class="h2">${info?.used ? 'Invitationen er allerede brugt' : 'Linket virker ikke længere'}</h1>
          <p class="muted">${info?.used
            ? 'Du har allerede oprettet en konto. Log ind med din email og adgangskode.'
            : `Invitationen er udløbet eller slettet. Bed ${config.adminNames} om et nyt link.`}</p>
          <a class="btn btn-primary btn-block" href="#/login">Gå til log ind</a>
        </div>`),
      );
      return;
    }
    const ids = { email: nextId('email'), pw: nextId('pw') };
    mount(
      el,
      page(html`<form class="auth-card" novalidate>
        <p class="eyebrow">Invitation${info.role === 'admin' ? ' · administrator' : ''}</p>
        <h1 class="h1">Velkommen, <em>${firstName(info.full_name)}</em></h1>
        <p class="muted">Du er inviteret til familiens booking-side for husene på Mallorca og Sjællands Odde. Vælg en adgangskode, så er du klar.</p>
        <div class="field">
          <label class="label" for="${ids.email}">Din email</label>
          <input class="input" id="${ids.email}" name="email" type="email" value="${info.email}" readonly autocomplete="username">
          <span class="hint">Det er den, du logger ind med.</span>
        </div>
        ${passwordField(ids.pw, 'Vælg adgangskode', { autocomplete: 'new-password', hint: 'Mindst 8 tegn. Din browser kan huske den for dig.' })}
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Opret konto</button>
      </form>`),
    );
    const form = $('form', el);
    bindReveal(form);
    form.password.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      if (form.password.value.length < 8) {
        err.textContent = 'Adgangskoden skal være mindst 8 tegn.';
        return;
      }
      try {
        await busy(form.querySelector('[type="submit"]'), async () => {
          const session = await auth.signUpWithInvite(info.email, form.password.value, token);
          await signedIn(session, '/');
          toast(`Din konto er klar, ${firstName(info.full_name)}.`, { type: 'success', title: 'Velkommen' });
        });
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  },
};

export const reset = {
  access: 'public',
  chrome: 'minimal',
  title: () => 'Ny adgangskode',
  async render(el, r) {
    const token = r.params.token;
    mount(el, page(html`<div class="auth-card"><div class="skeleton sk-title"></div><div class="skeleton" style="height:160px"></div></div>`));
    let info;
    try {
      info = await links.resetInfo(token);
    } catch (e) {
      mount(el, page(html`<div class="auth-card"><div class="form-error">${icon('alert')}${e.message}</div></div>`));
      return;
    }
    if (!info || !info.valid) {
      mount(
        el,
        page(html`<div class="auth-card">
          <div class="empty-icon">${icon('link')}</div>
          <h1 class="h2">Linket virker ikke længere</h1>
          <p class="muted">Det er brugt eller udløbet. Bed ${config.adminNames} om et nyt.</p>
          <a class="btn btn-primary btn-block" href="#/login">Gå til log ind</a>
        </div>`),
      );
      return;
    }
    const pw = nextId('pw');
    mount(
      el,
      page(html`<form class="auth-card" novalidate>
        <p class="eyebrow">Ny adgangskode</p>
        <h1 class="h1">Hej <em>${firstName(info.full_name)}</em></h1>
        <p class="muted">Vælg en ny adgangskode til <strong>${info.email}</strong>.</p>
        ${passwordField(pw, 'Ny adgangskode', { autocomplete: 'new-password', hint: 'Mindst 8 tegn.' })}
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Gem og log ind</button>
      </form>`),
    );
    const form = $('form', el);
    bindReveal(form);
    form.password.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      if (form.password.value.length < 8) {
        err.textContent = 'Adgangskoden skal være mindst 8 tegn.';
        return;
      }
      try {
        await busy(form.querySelector('[type="submit"]'), async () => {
          const email = await links.redeemReset(token, form.password.value);
          const session = await auth.signIn(email, form.password.value);
          await signedIn(session, '/');
          toast('Din nye adgangskode er gemt.', { type: 'success' });
        });
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  },
};
