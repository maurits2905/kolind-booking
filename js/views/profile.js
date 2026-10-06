import config from '../../config.js';
import { html, mount, $ } from '../html.js';
import { icon } from '../icons.js';
import { api, auth } from '../api.js';
import { state, emit, firstName, cap } from '../state.js';
import { busy, toast, nextId } from '../ui.js';

function installHelp() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return html`<p class="small muted">Siden kører allerede som app på denne enhed.</p>`;
  if (window.__installPrompt) return html`<button type="button" class="btn" data-install>${icon('phone2')}Installér på denne enhed</button>`;
  if (ios) return html`<p class="small muted">På iPhone: tryk på ${icon('share', 'inline-icon')} Del-knappen i Safari, og vælg <strong>Føj til hjemmeskærm</strong>.</p>`;
  return html`<p class="small muted">I Chrome eller Edge: åbn browserens menu, og vælg <strong>Installér app</strong> eller <strong>Føj til startskærm</strong>.</p>`;
}

export default {
  access: 'member',
  title: () => 'Profil',
  async render(el) {
    const me = state.me;
    const ids = { name: nextId('n'), phone: nextId('p'), pw: nextId('pw') };
    mount(
      el,
      html`<div class="page profile-page">
        <div class="container container-narrow">
          <header class="page-head">
            <p class="eyebrow">Profil</p>
            <h1 class="h1">${firstName(me.full_name)}</h1>
            <p class="lede">${me.email}${me.role === 'admin' ? ' · administrator' : ''}</p>
          </header>

          <form class="card card-pad form-card" data-profile novalidate>
            <h2 class="h3">Dine oplysninger</h2>
            <div class="field-row">
              <div class="field"><label class="label" for="${ids.name}">Navn</label><input class="input" id="${ids.name}" name="name" value="${me.full_name}" maxlength="80" autocomplete="name"></div>
              <div class="field"><label class="label" for="${ids.phone}">Telefon <span class="muted">(valgfri)</span></label><input class="input" id="${ids.phone}" name="phone" type="tel" value="${me.phone || ''}" maxlength="30" autocomplete="tel"></div>
            </div>
            <p class="hint">${cap(config.adminNames)} kan se dit telefonnummer, så de kan fange dig om nøgler og den slags.</p>
            <div class="form-error" role="alert"></div>
            <div class="form-actions-inline"><button type="submit" class="btn btn-primary">Gem</button></div>
          </form>

          <form class="card card-pad form-card" data-password novalidate>
            <h2 class="h3">Skift adgangskode</h2>
            <div class="field">
              <label class="label" for="${ids.pw}">Ny adgangskode</label>
              <input class="input" id="${ids.pw}" name="password" type="password" autocomplete="new-password" minlength="8">
              <span class="hint">Mindst 8 tegn.</span>
            </div>
            <div class="form-error" role="alert"></div>
            <div class="form-actions-inline"><button type="submit" class="btn">Skift adgangskode</button></div>
          </form>

          <section class="card card-pad form-card">
            <h2 class="h3">Brug siden som en app</h2>
            <p class="muted">Læg siden på din hjemmeskærm, så åbner den som en app uden adresselinje.</p>
            <div class="install-help">${installHelp()}</div>
          </section>

          <button type="button" class="btn btn-block btn-lg logout-btn" data-logout>${icon('log-out')}Log ud</button>
        </div>
      </div>`,
    );

    const profile = $('[data-profile]', el);
    profile.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', profile);
      err.textContent = '';
      try {
        await busy(profile.querySelector('[type="submit"]'), async () => {
          state.me = await api.updateMyProfile(profile.name.value, profile.phone.value);
          emit();
        });
        toast('Dine oplysninger er gemt.', { type: 'success' });
      } catch (ex) {
        err.textContent = ex.message;
      }
    });

    const pw = $('[data-password]', el);
    pw.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', pw);
      err.textContent = '';
      if (pw.password.value.length < 8) {
        err.textContent = 'Adgangskoden skal være mindst 8 tegn.';
        return;
      }
      try {
        await busy(pw.querySelector('[type="submit"]'), () => auth.updatePassword(pw.password.value));
        pw.reset();
        toast('Din adgangskode er skiftet.', { type: 'success' });
      } catch (ex) {
        err.textContent = ex.message;
      }
    });

    $('[data-install]', el)?.addEventListener('click', async () => {
      const prompt = window.__installPrompt;
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => {});
      window.__installPrompt = null;
    });
    $('[data-logout]', el).addEventListener('click', () => auth.signOut());
  },
};
