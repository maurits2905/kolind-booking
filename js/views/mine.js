import config from '../../config.js';
import { html, mount, $, $$ } from '../html.js';
import { icon } from '../icons.js';
import * as D from '../dates.js';
import { api } from '../api.js';
import { state, firstName, invalidateCalendar, refreshMeQuietly, cap } from '../state.js';
import { style } from '../properties.js';
import { statusChip, confirmDialog, toast, toastError, busy, errorState, emptyState, skeletonList, openSheet, copyText, shareText, appUrl, nextId } from '../ui.js';
import { downloadIcs, googleCalendarUrl } from '../ics.js';
import { adminContacts, cancelDraft, openMailDraft } from '../mail.js';

function bookingCard(b) {
  const st = style(b.property_id);
  const p = state.byId[b.property_id];
  const t = D.today();
  const upcoming = b.end_date > t && (b.status === 'approved' || b.status === 'pending');
  const ongoing = b.status === 'approved' && b.start_date <= t && b.end_date > t;
  const canCancel = upcoming && b.status !== 'cancelled';
  return html`<article class="booking-card ${upcoming ? '' : 'is-past'}" data-theme="${st.theme}">
    <a class="booking-card-media" href="#/bolig/${b.property_id}" tabindex="-1" aria-hidden="true">
      <img src="${st.imageSm}" alt="" loading="lazy" style="object-position:${st.focus}">
    </a>
    <div class="booking-card-body">
      <div class="row row-wrap" style="--gap:8px;justify-content:space-between">
        <span class="eyebrow">${b.property_name}</span>
        ${statusChip(b.status, b.kind)}
      </div>
      <h3 class="h3">${D.fmtRange(b.start_date, b.end_date)}</h3>
      <p class="small muted">
        ${D.fmtDayMedium(b.start_date)} ${p?.check_in_time ? `fra ${p.check_in_time}` : ''} → ${D.fmtDayMedium(b.end_date)} ${p?.check_out_time ? `inden ${p.check_out_time}` : ''}
        · ${D.nightsLabel(b.nights)}${b.guests ? ` · ${D.guestsLabel(b.guests)}` : ''}
      </p>
      ${upcoming && !ongoing ? html`<p class="countdown">${b.status === 'approved' ? `Afrejse til ${b.property_name} ${D.relative(b.start_date)}` : `Sendt ${D.fmtTimestamp(b.created_at)}. ${cap(config.adminNames)} har ikke svaret endnu.`}</p>` : ''}
      ${ongoing ? html`<p class="countdown">God ferie! I rejser hjem ${D.relative(b.end_date)}.</p>` : ''}
      ${b.comment ? html`<blockquote class="quote"><cite>Din besked</cite>${b.comment}</blockquote>` : ''}
      ${b.decision_note ? html`<blockquote class="quote quote-reply"><cite>${b.decided_by_name || cap(config.adminNames)}</cite>${b.decision_note}</blockquote>` : ''}
      ${upcoming
        ? html`<div class="booking-card-actions">
            ${b.status === 'approved'
              ? html`<a class="btn btn-sm btn-accent" href="#/bolig/${b.property_id}">${icon('key')}Praktisk info</a>
                  <div class="menu-wrap">
                    <button type="button" class="btn btn-sm" data-cal-menu aria-haspopup="true" aria-expanded="false">${icon('calendar')}Tilføj til kalender</button>
                    <div class="menu menu-left" hidden>
                      <button type="button" data-ics="${b.id}">${icon('download')}Apple, Outlook m.fl. (.ics)</button>
                      <a href="${googleCalendarUrl(b, p)}" target="_blank" rel="noopener">${icon('external')}Google Kalender</a>
                    </div>
                  </div>`
              : ''}
            ${canCancel ? html`<button type="button" class="btn btn-sm btn-ghost btn-danger-quiet" data-cancel="${b.id}">Annullér</button>` : ''}
          </div>`
        : ''}
    </div>
  </article>`;
}

function guestLinkCard(l) {
  const p = l.property_id ? state.byId[l.property_id] : null;
  const url = appUrl(`/gaest/${l.token}`);
  const expired = new Date(l.expires_at) < new Date();
  return html`<article class="link-card ${l.active ? '' : 'is-inactive'}">
    <div class="row row-wrap" style="--gap:10px;justify-content:space-between">
      <div>
        <h3 class="h4">${l.label}</h3>
        <p class="small muted">${p ? p.name : 'Begge huse'} · ${l.revoked_at ? 'Lukket' : expired ? 'Udløbet' : `gyldigt til ${D.fmtDay(l.expires_at.slice(0, 10))}`} · ${l.request_count} af ${l.max_requests} forespørgsler brugt</p>
      </div>
      ${l.active ? html`<span class="status status-approved">Aktivt</span>` : html`<span class="status status-cancelled">Inaktivt</span>`}
    </div>
    ${l.active
      ? html`<div class="copy-field"><code>${url}</code>
          <button type="button" class="btn btn-sm" data-copy-link="${url}">${icon('copy')}Kopiér</button>
          <button type="button" class="btn btn-sm btn-primary" data-share-link="${url}" data-label="${l.label}">${icon('share')}Del</button></div>`
      : ''}
    ${l.requests.length
      ? html`<ul class="mini-list">${l.requests.map((q) => html`<li><span>${q.person_name} · ${state.byId[q.property_id]?.name || ''} ${D.fmtRange(q.start_date, q.end_date)}</span>${statusChip(q.status)}</li>`)}</ul>`
      : ''}
    ${l.active ? html`<button type="button" class="link-btn small" data-revoke="${l.id}">Luk linket</button>` : ''}
  </article>`;
}

async function createGuestLinkDialog(onCreated) {
  const ids = { label: nextId('l'), days: nextId('d') };
  const sheet = openSheet({
    title: 'Nyt gæstelink',
    body: html`<form class="stack" novalidate>
      <p class="muted">Send linket til venner, der vil låne et af husene. De kan se ledige datoer (uden navne) og sende en forespørgsel, som ${config.adminNames} godkender.</p>
      <div class="field">
        <label class="label" for="${ids.label}">Hvem er linket til?</label>
        <input class="input" id="${ids.label}" name="label" maxlength="80" placeholder="Fx Peter og Anne" required autofocus>
      </div>
      <fieldset class="fieldset">
        <legend class="label">Hvilket hus?</legend>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="property" value="" checked><span class="dot"></span>Begge</label>
          ${state.properties.map((p) => html`<label class="choice"><input type="radio" name="property" value="${p.id}"><span class="dot"></span>${p.name}</label>`)}
        </div>
      </fieldset>
      <div class="field">
        <label class="label" for="${ids.days}">Linket virker i</label>
        <select class="select" id="${ids.days}" name="days">
          <option value="14">2 uger</option>
          <option value="30">1 måned</option>
          <option value="60" selected>2 måneder</option>
          <option value="120">4 måneder</option>
        </select>
        <span class="hint">Et link kan bruges til højst 3 forespørgsler.</span>
      </div>
      <div class="form-error" role="alert"></div>
    </form>`,
    foot: html`<button type="button" class="btn" data-cancel>Fortryd</button><button type="button" class="btn btn-primary" data-create>Lav link</button>`,
  });
  $('[data-cancel]', sheet.foot).addEventListener('click', () => sheet.close());
  $('[data-create]', sheet.foot).addEventListener('click', async (e) => {
    const form = $('form', sheet.body);
    const err = $('.form-error', form);
    err.textContent = '';
    const label = form.label.value.trim();
    if (!label) {
      err.textContent = 'Skriv hvem linket er til.';
      return;
    }
    try {
      const link = await busy(e.currentTarget, () =>
        api.createGuestLink({ label, propertyId: form.property.value || null, days: Number(form.days.value) }),
      );
      const url = appUrl(`/gaest/${link.token}`);
      sheet.setTitle('Linket er klar');
      sheet.setBody(html`<div class="stack">
        <div class="success-mark">${icon('link')}</div>
        <p class="muted" style="text-align:center">Send linket til ${label}. De skal ikke oprette en konto.</p>
        <div class="copy-field"><code>${url}</code><button type="button" class="btn btn-sm" data-copy-link="${url}">${icon('copy')}Kopiér</button></div>
      </div>`);
      sheet.setFoot(html`<button type="button" class="btn" data-done>Færdig</button><button type="button" class="btn btn-primary" data-share-link="${url}" data-label="${label}">${icon('share')}Del link</button>`);
      $('[data-done]', sheet.foot).addEventListener('click', () => sheet.close());
      bindLinkButtons(sheet.el);
      onCreated();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

function bindLinkButtons(root) {
  for (const b of $$('[data-copy-link]', root)) b.addEventListener('click', () => copyText(b.dataset.copyLink));
  for (const b of $$('[data-share-link]', root)) {
    b.addEventListener('click', () =>
      shareText({
        title: 'Lån af feriebolig',
        text: `Hej ${firstName(b.dataset.label)}! Her kan I se, hvornår vores ferieboliger er ledige, og sende en forespørgsel:`,
        url: b.dataset.shareLink,
      }),
    );
  }
}

export default {
  access: 'member',
  title: () => 'Mine ophold',
  async render(el, r) {
    let tab = ['kommende', 'tidligere', 'gaester'].includes(r.query.vis) ? r.query.vis : 'kommende';
    let bookings = null;
    let guestLinks = null;
    let error = null;

    const paint = () => {
      const t = D.today();
      const upcoming = (bookings || [])
        .filter((b) => b.end_date > t && (b.status === 'approved' || b.status === 'pending'))
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
      const past = (bookings || []).filter((b) => !upcoming.includes(b));
      const activeLinks = (guestLinks || []).filter((l) => l.active).length;

      mount(
        el,
        html`<div class="page mine-page">
          <div class="container container-narrow">
            <header class="page-head">
              <p class="eyebrow">Mine ophold</p>
              <h1 class="h1">Hej ${firstName(state.me.full_name)}</h1>
              <p class="lede">Her ser du dine forespørgsler og ophold, og hvad ${config.adminNames} har svaret.</p>
            </header>
            <div class="tabs" role="tablist">
              <button role="tab" aria-selected="${tab === 'kommende'}" data-tab="kommende">Kommende${bookings ? html`<span class="count">${upcoming.length}</span>` : ''}</button>
              <button role="tab" aria-selected="${tab === 'tidligere'}" data-tab="tidligere">Tidligere${bookings ? html`<span class="count">${past.length}</span>` : ''}</button>
              <button role="tab" aria-selected="${tab === 'gaester'}" data-tab="gaester">Gæstelinks${guestLinks ? html`<span class="count">${activeLinks}</span>` : ''}</button>
            </div>
            <div class="tab-panel" role="tabpanel">
              ${error
                ? errorState(error)
                : tab === 'gaester'
                  ? html`<div class="guest-intro card card-pad">
                        <div><h2 class="h4">Lån huset ud til venner</h2>
                        <p class="small muted">Lav et personligt link, som dine venner kan bruge til at se ledige datoer og sende en forespørgsel. De ser aldrig, hvem der ellers bor i husene.</p></div>
                        <button type="button" class="btn btn-primary" data-new-link>${icon('plus')}Nyt gæstelink</button>
                      </div>
                      ${guestLinks
                        ? guestLinks.length
                          ? html`<div class="stack" style="--stack:14px">${guestLinks.map(guestLinkCard)}</div>`
                          : ''
                        : skeletonList(2)}`
                  : !bookings
                    ? skeletonList(3)
                    : tab === 'kommende'
                      ? upcoming.length
                        ? html`<div class="stack" style="--stack:18px">${upcoming.map(bookingCard)}</div>`
                        : emptyState({
                            icon: 'suitcase',
                            title: 'Ingen kommende ophold',
                            text: 'Find en ledig periode, og send en forespørgsel. Du kan følge svaret her.',
                            action: html`<a class="btn btn-primary" href="#/kalender">${icon('calendar')}Find ledige datoer</a>`,
                          })
                      : past.length
                        ? html`<div class="stack" style="--stack:14px">${past.map(bookingCard)}</div>`
                        : emptyState({ icon: 'history', title: 'Ingen tidligere ophold endnu', text: 'Når du har været af sted, kan du se dine ophold her.' })}
            </div>
          </div>
        </div>`,
      );
      bind();
    };

    const bind = () => {
      for (const b of $$('[data-tab]', el)) {
        b.addEventListener('click', () => {
          tab = b.dataset.tab;
          history.replaceState(null, '', `#/mine?vis=${tab}`);
          paint();
          if (tab === 'gaester' && !guestLinks) loadLinks();
        });
      }
      $('[data-retry]', el)?.addEventListener('click', load);
      $('[data-new-link]', el)?.addEventListener('click', () => createGuestLinkDialog(loadLinks));
      bindLinkButtons(el);
      for (const b of $$('[data-revoke]', el)) {
        b.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: 'Luk linket?', message: 'Linket holder op med at virke. Forespørgsler, der allerede er sendt, bliver liggende.', confirmLabel: 'Luk link', danger: true });
          if (!ok) return;
          try {
            await api.revokeGuestLink(b.dataset.revoke);
            toast('Linket er lukket.', { type: 'success' });
            loadLinks();
          } catch (err) {
            toastError(err);
          }
        });
      }
      for (const b of $$('[data-cal-menu]', el)) {
        const menu = b.nextElementSibling;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = menu.hidden;
          $$('.booking-card .menu', el).forEach((m) => (m.hidden = true));
          menu.hidden = !open;
          b.setAttribute('aria-expanded', String(open));
          if (open) {
            const close = (ev) => {
              if (!menu.contains(ev.target)) {
                menu.hidden = true;
                b.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', close);
              }
            };
            setTimeout(() => document.addEventListener('click', close));
          }
        });
      }
      for (const b of $$('[data-ics]', el)) {
        b.addEventListener('click', () => {
          const bk = bookings.find((x) => x.id === b.dataset.ics);
          downloadIcs(bk, state.byId[bk.property_id]);
          b.closest('.menu').hidden = true;
        });
      }
      for (const b of $$('[data-cancel]', el)) {
        b.addEventListener('click', async () => {
          const bk = bookings.find((x) => x.id === b.dataset.cancel);
          const res = await confirmDialog({
            title: bk.status === 'pending' ? 'Træk forespørgslen tilbage?' : 'Annullér dit ophold?',
            message: `${bk.property_name} · ${D.fmtRange(bk.start_date, bk.end_date)}. Perioden bliver ledig for andre.`,
            confirmLabel: bk.status === 'pending' ? 'Træk tilbage' : 'Annullér ophold',
            cancelLabel: 'Behold',
            danger: true,
            input: { label: `Besked til ${config.adminNames} (valgfri)`, placeholder: 'Fx at planerne er ændret' },
          });
          if (!res) return;
          try {
            await api.cancelBooking(bk.id, res.value);
            invalidateCalendar();
            refreshMeQuietly();
            toast('Dit ophold er annulleret.', { type: 'success' });
            load();
            const admins = await adminContacts();
            openMailDraft(cancelDraft(bk, state.byId[bk.property_id], admins, res.value), {
              theme: style(bk.property_id).theme,
              title: `Mail til ${config.adminNames}`,
              intro: 'Send mailen, så de ved, at perioden er ledig igen.',
            });
          } catch (err) {
            toastError(err);
          }
        });
      }
    };

    const load = async () => {
      error = null;
      try {
        bookings = await api.myBookings();
      } catch (err) {
        error = err;
      }
      paint();
    };
    const loadLinks = async () => {
      try {
        guestLinks = await api.myGuestLinks();
      } catch (err) {
        error = err;
      }
      paint();
    };

    paint();
    await Promise.all([load(), loadLinks()]);
  },
};
