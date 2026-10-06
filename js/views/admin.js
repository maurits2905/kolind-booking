import config from '../../config.js';
import { html, mount, $, $$ } from '../html.js';
import { icon } from '../icons.js';
import * as D from '../dates.js';
import { admin, api } from '../api.js';
import { state, firstName, calendarEntries, loadProperties, invalidateCalendar, refreshMeQuietly } from '../state.js';
import { style } from '../properties.js';
import { nowStatus } from '../availability.js';
import {
  statusChip, propertyTag, toast, toastError, busy, errorState, emptyState, skeletonList, openSheet,
  confirmDialog, copyText, shareText, appUrl, initials, nextId, segmented,
} from '../ui.js';
import { openBookingSheet } from '../booking-form.js';
import { openBookingDetail, decide, whoLabel } from '../booking-detail.js';
import { navigate } from '../router.js';
import { openMailDraft, inviteDraft } from '../mail.js';

const TABS = [
  { id: 'overblik', label: 'Overblik' },
  { id: 'ophold', label: 'Ophold' },
  { id: 'familie', label: 'Familie' },
  { id: 'boliger', label: 'Boliger' },
];

// ---------------------------------------------------------------------------
// Overblik
// ---------------------------------------------------------------------------

function requestCard(b) {
  const st = style(b.property_id);
  return html`<article class="request-card" data-theme="${st.theme}" data-id="${b.id}">
    <header class="request-head">
      <span class="avatar">${initials(b.person_name)}</span>
      <div class="request-who">
        <strong>${b.person_name}</strong>
        <span class="small muted">${b.is_guest ? `Gæst${b.sponsor_name ? ` · kender ${firstName(b.sponsor_name)}` : ''}` : 'Familie'} · sendt ${D.fmtTimestamp(b.created_at)}</span>
      </div>
      ${propertyTag(state.byId[b.property_id] || { id: b.property_id, name: b.property_name })}
    </header>
    <div class="request-dates">
      <span>${D.fmtDayMedium(b.start_date)}</span>${icon('arrow-right')}<span>${D.fmtDayMedium(b.end_date)}</span>
    </div>
    <p class="small muted">${D.nightsLabel(b.nights)} · ${D.guestsLabel(b.guests || 1)} · ankomst ${D.relative(b.start_date)}</p>
    ${b.comment ? html`<blockquote class="quote"><cite>${firstName(b.person_name)}</cite>${b.comment}</blockquote>` : ''}
    ${b.conflict
      ? html`<div class="notice notice-danger">${icon('alert')}<span>Overlapper et godkendt ophold og kan ikke godkendes.</span></div>`
      : b.competing
        ? html`<div class="notice notice-warn">${icon('info')}<span>${b.competing === 1 ? 'En anden har' : `${b.competing} andre har`} også spurgt om nogle af datoerne.</span></div>`
        : ''}
    <div class="request-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-detail="${b.id}">Detaljer</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-danger-quiet" data-reject="${b.id}">${icon('x')}Afslå</button>
      <button type="button" class="btn btn-accent" data-approve="${b.id}" ${b.conflict ? 'disabled' : ''}>${icon('check')}Godkend</button>
    </div>
  </article>`;
}

function bookingRow(b) {
  const { d, m } = D.parts(b.start_date);
  return html`<li>
    <button type="button" class="booking-row p-${b.property_id}" data-detail="${b.id}">
      <span class="date-chip"><strong>${d}</strong><span>${D.MONTHS_SHORT[m - 1]}</span></span>
      <span class="booking-row-main">
        <strong>${whoLabel(b)}</strong>
        <span class="small muted">${b.property_name} · ${D.fmtRange(b.start_date, b.end_date)} · ${D.nightsLabel(b.nights)}${b.guests ? ` · ${D.guestsLabel(b.guests)}` : ''}</span>
      </span>
      ${statusChip(b.status, b.kind)}
      ${icon('chevron-right', 'row-chevron')}
    </button>
  </li>`;
}

async function renderOverview(host, ctx) {
  mount(host, skeletonList(3));
  let pending;
  let upcoming;
  let entries;
  try {
    const from = D.addMonths(D.startOfMonth(D.today()), -1);
    [pending, upcoming, entries] = await Promise.all([
      admin.bookings('pending'),
      admin.bookings('upcoming'),
      calendarEntries(from, D.addMonths(from, 18), { force: true }),
    ]);
  } catch (err) {
    mount(host, errorState(err));
    $('[data-retry]', host)?.addEventListener('click', () => renderOverview(host, ctx));
    return;
  }
  const t = D.today();
  const nextArrival = upcoming.find((b) => b.start_date >= t && b.kind !== 'blocked');

  mount(
    host,
    html`<div class="admin-quick">
        <button type="button" class="quick" data-new="stay">${icon('plus')}<span><strong>Opret ophold</strong><span class="tiny muted">Godkendt med det samme</span></span></button>
        <button type="button" class="quick" data-new="owner">${icon('sun')}<span><strong>Egen ferie</strong><span class="tiny muted">Jeres egne dage</span></span></button>
        <button type="button" class="quick" data-new="blocked">${icon('ban')}<span><strong>Bloker periode</strong><span class="tiny muted">Håndværkere, udlejning …</span></span></button>
        <button type="button" class="quick" data-invite>${icon('users')}<span><strong>Inviter familie</strong><span class="tiny muted">Send et link</span></span></button>
      </div>

      <section class="admin-section">
        <div class="section-head">
          <h2 class="h2">Afventer godkendelse ${pending.length ? html`<span class="count-pill">${pending.length}</span>` : ''}</h2>
        </div>
        ${pending.length
          ? html`<div class="request-grid">${pending.map(requestCard)}</div>`
          : emptyState({ icon: 'check', title: 'Ingen forespørgsler venter', text: 'Nye forespørgsler dukker op her. Tallet på Admin-fanen viser, når der er noget.' })}
      </section>

      <section class="admin-section">
        <div class="section-head"><h2 class="h2">Lige nu</h2></div>
        <div class="now-grid">
          ${state.properties.map((p) => {
            const now = nowStatus(entries, p.id);
            const cur = now.free ? null : upcoming.find((b) => b.property_id === p.id && b.start_date <= t && b.end_date > t);
            const next = upcoming.find((b) => b.property_id === p.id && b.start_date > t);
            const st = style(p.id);
            return html`<a class="now-tile" href="#/bolig/${p.id}" data-theme="${st.theme}">
              <img src="${st.imageSm}" alt="" style="object-position:${st.focus}">
              <div>
                <span class="eyebrow">${p.name}</span>
                <strong class="h4">${now.free ? 'Ledig nu' : `${cur ? whoLabel(cur) : 'Optaget'} til ${D.fmtDay(now.until)}`}</strong>
                <span class="small muted">${next ? `Næste: ${whoLabel(next)}, ${D.fmtRange(next.start_date, next.end_date)}` : 'Ingen kommende ophold'}</span>
              </div>
            </a>`;
          })}
        </div>
      </section>

      <section class="admin-section">
        <div class="section-head">
          <h2 class="h2">Kommende ophold</h2>
          <a class="link-arrow" href="#/admin/ophold">Alle ophold ${icon('arrow-right')}</a>
        </div>
        ${upcoming.length
          ? html`<ul class="booking-list">${upcoming.slice(0, 8).map(bookingRow)}</ul>`
          : emptyState({ icon: 'calendar', title: 'Ingen kommende ophold', text: 'Godkendte ophold vises her.' })}
        ${nextArrival ? html`<p class="small muted" style="margin-top:14px">Næste ankomst: ${whoLabel(nextArrival)} på ${nextArrival.property_name} ${D.relative(nextArrival.start_date)}.</p>` : ''}
      </section>`,
  );

  const all = [...pending, ...upcoming];
  for (const b of $$('[data-approve]', host)) {
    b.addEventListener('click', async () => {
      const bk = all.find((x) => x.id === b.dataset.approve);
      const u = await decide(bk, true, { button: b });
      if (u) removeCardThen(b, () => ctx.refresh());
    });
  }
  for (const b of $$('[data-reject]', host)) {
    b.addEventListener('click', async () => {
      const bk = all.find((x) => x.id === b.dataset.reject);
      const u = await decide(bk, false, { button: b });
      if (u) removeCardThen(b, () => ctx.refresh());
    });
  }
  bindCommon(host, ctx);
}

function removeCardThen(btn, fn) {
  const card = btn.closest('.request-card');
  if (!card) return fn();
  card.classList.add('is-leaving');
  card.addEventListener('animationend', fn, { once: true });
  setTimeout(fn, 500);
}

function bindCommon(host, ctx) {
  for (const b of $$('[data-detail]', host)) {
    b.addEventListener('click', () => openBookingDetail(b.dataset.detail, { onChange: () => ctx.refresh() }));
  }
  for (const b of $$('[data-new]', host)) {
    b.addEventListener('click', () => openBookingSheet({ kind: b.dataset.new, onDone: () => ctx.refresh() }));
  }
  $('[data-invite]', host)?.addEventListener('click', () => inviteDialog(() => ctx.refresh()));
}

// ---------------------------------------------------------------------------
// Ophold
// ---------------------------------------------------------------------------

const SCOPES = [
  { id: 'pending', label: 'Afventer' },
  { id: 'upcoming', label: 'Kommende' },
  { id: 'past', label: 'Tidligere' },
  { id: 'closed', label: 'Afvist og annulleret' },
  { id: 'all', label: 'Alle' },
];

async function renderBookings(host, ctx) {
  const scope = SCOPES.some((s) => s.id === ctx.query.vis) ? ctx.query.vis : 'upcoming';
  const prop = ctx.query.bolig || '';
  mount(
    host,
    html`<div class="admin-toolbar">
        <div class="chips" role="group" aria-label="Filter">
          ${SCOPES.map((s) => html`<button type="button" class="chip" aria-pressed="${s.id === scope}" data-scope="${s.id}">${s.label}</button>`)}
        </div>
        <div class="chips" role="group" aria-label="Bolig">
          <button type="button" class="chip" aria-pressed="${!prop}" data-prop="">Begge huse</button>
          ${state.properties.map((p) => html`<button type="button" class="chip" aria-pressed="${p.id === prop}" data-prop="${p.id}"><span class="prop-dot ${p.id}"></span>${p.name}</button>`)}
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-new="stay">${icon('plus')}Opret ophold</button>
      </div>
      <div class="list-host">${skeletonList(4)}</div>`,
  );
  const go = (vis, bolig) => navigate(`/admin/ophold?vis=${vis}${bolig ? `&bolig=${bolig}` : ''}`, { replace: true });
  for (const c of $$('[data-scope]', host)) c.addEventListener('click', () => go(c.dataset.scope, prop));
  for (const c of $$('[data-prop]', host)) c.addEventListener('click', () => go(scope, c.dataset.prop));

  let list;
  try {
    list = await admin.bookings(scope);
  } catch (err) {
    mount($('.list-host', host), errorState(err));
    $('[data-retry]', host)?.addEventListener('click', () => renderBookings(host, ctx));
    return;
  }
  if (prop) list = list.filter((b) => b.property_id === prop);
  mount(
    $('.list-host', host),
    list.length
      ? html`<ul class="booking-list">${list.map(bookingRow)}</ul><p class="tiny muted" style="margin-top:12px">${list.length} ${list.length === 1 ? 'ophold' : 'ophold'}</p>`
      : emptyState({ icon: 'calendar', title: 'Intet at vise', text: 'Der er ingen ophold med det filter.' }),
  );
  bindCommon(host, ctx);
}

// ---------------------------------------------------------------------------
// Familie
// ---------------------------------------------------------------------------

function linkDialog({ title, intro, url, message, mail }) {
  const sheet = openSheet({
    title,
    body: html`<div class="stack">
      <div class="success-mark">${icon('link')}</div>
      <p class="muted" style="text-align:center">${intro}</p>
      <div class="copy-field"><code>${url}</code><button type="button" class="btn btn-sm" data-copy>${icon('copy')}Kopiér</button></div>
      <div class="btn-row link-send">
        ${mail ? html`<button type="button" class="btn btn-accent" data-mail>${icon('mail')}Send som mail</button>` : ''}
        <button type="button" class="btn" data-share>${icon('share')}SMS eller besked</button>
      </div>
    </div>`,
    foot: html`<button type="button" class="btn" data-done>Færdig</button>`,
  });
  $('[data-copy]', sheet.body).addEventListener('click', () => copyText(url));
  $('[data-done]', sheet.foot).addEventListener('click', () => sheet.close());
  $('[data-share]', sheet.body).addEventListener('click', () => shareText({ title, text: message, url }));
  $('[data-mail]', sheet.body)?.addEventListener('click', () =>
    openMailDraft(mail, { title: 'Mail klar til afsendelse', intro: 'Tjek teksten, og tryk Åbn i mail.' }),
  );
}

function inviteDialog(onDone) {
  const ids = { name: nextId('n'), email: nextId('e') };
  const sheet = openSheet({
    title: 'Inviter til familien',
    body: html`<form class="stack" novalidate>
      <p class="muted">Du får et personligt link, som du selv sender. Personen vælger en adgangskode og er klar.</p>
      <div class="field"><label class="label" for="${ids.name}">Navn</label><input class="input" id="${ids.name}" name="name" maxlength="80" required autofocus autocomplete="off"></div>
      <div class="field"><label class="label" for="${ids.email}">Email</label><input class="input" id="${ids.email}" name="email" type="email" maxlength="120" required autocomplete="off"><span class="hint">Personen logger ind med den.</span></div>
      <fieldset class="fieldset">
        <legend class="label">Rolle</legend>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="role" value="member" checked><span class="dot"></span><span>Familie<small>Kan se ledighed og forespørge</small></span></label>
          <label class="choice"><input type="radio" name="role" value="admin"><span class="dot"></span><span>Administrator<small>Kan godkende og redigere alt</small></span></label>
        </div>
      </fieldset>
      <div class="form-error" role="alert"></div>
    </form>`,
    foot: html`<button type="button" class="btn" data-cancel>Fortryd</button><button type="button" class="btn btn-primary" data-create>Lav invitation</button>`,
  });
  $('[data-cancel]', sheet.foot).addEventListener('click', () => sheet.close());
  $('[data-create]', sheet.foot).addEventListener('click', async (e) => {
    const form = $('form', sheet.body);
    const err = $('.form-error', form);
    err.textContent = '';
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    if (!name || !email) {
      err.textContent = 'Udfyld navn og email.';
      return;
    }
    try {
      const inv = await busy(e.currentTarget, () => admin.invite(email, name, form.role.value));
      sheet.close();
      onDone?.();
      const url = appUrl(`/invitation/${inv.token}`);
      linkDialog({
        title: `Invitation til ${firstName(inv.full_name)}`,
        intro: `Send linket til ${inv.full_name}. Det virker i 30 dage og kan bruges én gang.`,
        url,
        message: `Hej ${firstName(inv.full_name)}! Her er dit link til ${config.siteName}, familiens side for husene på Mallorca og Sjællands Odde. Vælg en adgangskode, så er du klar:`,
        mail: inviteDraft(inv, url),
      });
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

function memberDialog(m, onDone) {
  const ids = { name: nextId('n'), phone: nextId('p') };
  const sheet = openSheet({
    title: m.full_name,
    body: html`<form class="stack" novalidate>
      <p class="small muted">${m.email}</p>
      <div class="field"><label class="label" for="${ids.name}">Navn</label><input class="input" id="${ids.name}" name="name" value="${m.full_name}" maxlength="80"></div>
      <div class="field"><label class="label" for="${ids.phone}">Telefon <span class="muted">(valgfri)</span></label><input class="input" id="${ids.phone}" name="phone" type="tel" value="${m.phone || ''}" maxlength="30"></div>
      <fieldset class="fieldset">
        <legend class="label">Rolle</legend>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="role" value="member" ${m.role === 'member' ? 'checked' : ''} ${m.is_me ? 'disabled' : ''}><span class="dot"></span>Familie</label>
          <label class="choice"><input type="radio" name="role" value="admin" ${m.role === 'admin' ? 'checked' : ''}><span class="dot"></span>Administrator</label>
        </div>
      </fieldset>
      <label class="switch"><span><strong>Aktiv</strong><span class="hint" style="display:block">Slå fra for at fjerne adgangen uden at slette historikken.</span></span>
        <input type="checkbox" name="active" ${m.active ? 'checked' : ''} ${m.is_me ? 'disabled' : ''}></label>
      <hr class="divider">
      <div>
        <strong>Glemt adgangskode?</strong>
        <p class="small muted">Lav et link, hvor ${firstName(m.full_name)} selv vælger en ny adgangskode.</p>
        <button type="button" class="btn btn-sm" data-reset style="margin-top:10px">${icon('key')}Lav nulstillingslink</button>
      </div>
      <div class="form-error" role="alert"></div>
    </form>`,
    foot: html`<button type="button" class="btn" data-cancel>Fortryd</button><button type="button" class="btn btn-primary" data-save>Gem</button>`,
  });
  $('[data-cancel]', sheet.foot).addEventListener('click', () => sheet.close());
  $('[data-reset]', sheet.body).addEventListener('click', async (e) => {
    try {
      const r = await busy(e.currentTarget, () => admin.passwordReset(m.id));
      sheet.close();
      const url = appUrl(`/nulstil/${r.token}`);
      linkDialog({
        title: 'Link til ny adgangskode',
        intro: `Send linket til ${m.full_name}. Det virker i 7 dage og kan bruges én gang.`,
        url,
        message: `Hej ${firstName(m.full_name)}! Her kan du vælge en ny adgangskode til ${config.siteName}:`,
        mail: inviteDraft(m, url, { reset: true }),
      });
    } catch (err) {
      toastError(err);
    }
  });
  $('[data-save]', sheet.foot).addEventListener('click', async (e) => {
    const form = $('form', sheet.body);
    const err = $('.form-error', form);
    err.textContent = '';
    try {
      await busy(e.currentTarget, () =>
        admin.updateMember({
          id: m.id,
          fullName: form.name.value,
          phone: form.phone.value,
          role: m.is_me ? 'admin' : form.role.value,
          active: m.is_me ? true : form.active.checked,
        }),
      );
      sheet.close();
      toast('Gemt.', { type: 'success' });
      onDone?.();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

async function renderFamily(host, ctx) {
  mount(host, skeletonList(4));
  let people;
  try {
    people = await admin.people();
  } catch (err) {
    mount(host, errorState(err));
    $('[data-retry]', host)?.addEventListener('click', () => renderFamily(host, ctx));
    return;
  }
  const reload = () => renderFamily(host, ctx);
  mount(
    host,
    html`<div class="admin-toolbar">
        <p class="muted">Kun personer med en invitation kan oprette en konto. Ingen kan melde sig til selv.</p>
        <button type="button" class="btn btn-primary btn-sm" data-invite>${icon('plus')}Inviter</button>
      </div>
      <section class="admin-section">
        <h2 class="h3">Familien <span class="count-pill">${people.members.length}</span></h2>
        <ul class="people-list">
          ${people.members.map(
            (m) => html`<li>
              <button type="button" class="person-row ${m.active ? '' : 'is-inactive'}" data-member="${m.id}">
                <span class="avatar ${m.role === 'admin' ? 'avatar-admin' : ''}">${initials(m.full_name)}</span>
                <span class="person-main"><strong>${m.full_name}${m.is_me ? ' (dig)' : ''}</strong><span class="small muted">${m.email}</span></span>
                ${m.role === 'admin' ? html`<span class="tag">Administrator</span>` : ''}
                ${m.active ? '' : html`<span class="status status-cancelled">Inaktiv</span>`}
                ${m.upcoming ? html`<span class="tiny muted person-upcoming">${m.upcoming} kommende</span>` : ''}
                ${icon('chevron-right', 'row-chevron')}
              </button>
            </li>`,
          )}
        </ul>
      </section>
      <section class="admin-section">
        <h2 class="h3">Sendte invitationer <span class="count-pill">${people.invitations.length}</span></h2>
        ${people.invitations.length
          ? html`<ul class="people-list">
              ${people.invitations.map(
                (i) => html`<li class="invite-row">
                  <span class="avatar avatar-ghost">${initials(i.full_name)}</span>
                  <span class="person-main"><strong>${i.full_name}</strong><span class="small muted">${i.email} · ${i.role === 'admin' ? 'administrator' : 'familie'} · ${i.expired ? 'udløbet' : `udløber ${D.fmtDay(i.expires_at.slice(0, 10))}`}</span></span>
                  ${i.expired ? '' : html`<button type="button" class="btn btn-sm" data-share-invite="${i.id}">${icon('send')}Send link</button>`}
                  <button type="button" class="btn btn-sm btn-icon btn-ghost" data-del-invite="${i.id}" aria-label="Slet invitation til ${i.full_name}">${icon('trash')}</button>
                </li>`,
              )}
            </ul>`
          : html`<p class="small muted">Ingen ubrugte invitationer.</p>`}
      </section>
      <section class="admin-section">
        <h2 class="h3">Aktive gæstelinks <span class="count-pill">${people.guest_links.length}</span></h2>
        ${people.guest_links.length
          ? html`<ul class="people-list">
              ${people.guest_links.map(
                (l) => html`<li class="invite-row">
                  <span class="avatar avatar-ghost">${icon('link')}</span>
                  <span class="person-main"><strong>${l.label}</strong><span class="small muted">Lavet af ${l.created_by_name || 'ukendt'} · ${l.property_id ? state.byId[l.property_id]?.name : 'begge huse'} · ${l.request_count}/${l.max_requests} brugt · til ${D.fmtDay(l.expires_at.slice(0, 10))}</span></span>
                  <button type="button" class="btn btn-sm btn-danger-quiet" data-revoke="${l.id}">Luk</button>
                </li>`,
              )}
            </ul>`
          : html`<p class="small muted">Familiemedlemmer kan lave gæstelinks til venner under Mine ophold → Gæstelinks.</p>`}
      </section>`,
  );
  $('[data-invite]', host).addEventListener('click', () => inviteDialog(reload));
  for (const b of $$('[data-member]', host)) {
    b.addEventListener('click', () => memberDialog(people.members.find((m) => m.id === b.dataset.member), reload));
  }
  for (const b of $$('[data-share-invite]', host)) {
    b.addEventListener('click', () => {
      const inv = people.invitations.find((i) => i.id === b.dataset.shareInvite);
      const url = appUrl(`/invitation/${inv.token}`);
      linkDialog({
        title: `Invitation til ${firstName(inv.full_name)}`,
        intro: `Linket virker til ${D.fmtDay(inv.expires_at.slice(0, 10))} og kan bruges én gang.`,
        url,
        message: `Hej ${firstName(inv.full_name)}! Her er dit link til ${config.siteName}. Vælg en adgangskode, så er du klar:`,
        mail: inviteDraft(inv, url),
      });
    });
  }
  for (const b of $$('[data-del-invite]', host)) {
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Slet invitationen?', message: 'Linket holder op med at virke.', confirmLabel: 'Slet', danger: true });
      if (!ok) return;
      try {
        await admin.deleteInvitation(b.dataset.delInvite);
        reload();
      } catch (err) {
        toastError(err);
      }
    });
  }
  for (const b of $$('[data-revoke]', host)) {
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Luk gæstelinket?', message: 'Linket holder op med at virke. Sendte forespørgsler bliver liggende.', confirmLabel: 'Luk link', danger: true });
      if (!ok) return;
      try {
        await api.revokeGuestLink(b.dataset.revoke);
        reload();
      } catch (err) {
        toastError(err);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Boliger
// ---------------------------------------------------------------------------

async function renderProperties(host, ctx) {
  const id = state.byId[ctx.query.id] ? ctx.query.id : state.properties[0]?.id;
  const p = state.byId[id];
  const f = (name, label, value, { type = 'text', rows = 0, hint = '', placeholder = '' } = {}) => {
    const fid = nextId(name);
    return html`<div class="field">
      <label class="label" for="${fid}">${label}</label>
      ${rows
        ? html`<textarea class="textarea" id="${fid}" name="${name}" rows="${rows}" placeholder="${placeholder}">${value ?? ''}</textarea>`
        : html`<input class="input" id="${fid}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${type === 'number' ? 'step="any"' : ''}>`}
      ${hint ? html`<span class="hint">${hint}</span>` : ''}
    </div>`;
  };

  mount(
    host,
    html`<div class="admin-toolbar">
        <div class="segmented" data-prop-switch role="group" aria-label="Bolig">
          ${state.properties.map((x) => html`<button type="button" data-value="${x.id}" aria-pressed="${x.id === id}"><span class="seg-dot prop-dot ${x.id}"></span>${x.name}</button>`)}
        </div>
        <a class="link-arrow small" href="#/bolig/${id}">Se siden ${icon('arrow-right')}</a>
      </div>
      <form class="prop-form" data-theme="${style(id).theme}" novalidate>
        <section class="form-section">
          <header><h2 class="h3">Præsentation</h2><p class="small muted">Det, familien ser øverst på siden.</p></header>
          <div>
            <div class="field-row">${f('name', 'Navn', p.name)}${f('area', 'Område', p.area, { hint: 'Fx "Byen · Mallorca"' })}</div>
            ${f('tagline', 'Kort beskrivelse', p.tagline, { hint: 'Én sætning.' })}
            ${f('description', 'Om huset', p.description, { rows: 6, hint: 'Tom linje giver nyt afsnit.' })}
          </div>
        </section>
        <section class="form-section">
          <header><h2 class="h3">Praktisk</h2><p class="small muted">Vises for alle i familien.</p></header>
          <div>
            ${f('address', 'Adresse', p.address, { rows: 3 })}
            <div class="field-row">${f('check_in_time', 'Ankomst fra', p.check_in_time, { type: 'time' })}${f('check_out_time', 'Afrejse senest', p.check_out_time, { type: 'time' })}</div>
            <div class="field-row">${f('max_guests', 'Max antal personer', p.max_guests, { type: 'number' })}<div></div></div>
            ${f('arrival_info', 'Ankomst og nøgle', p.arrival_info, { rows: 3 })}
            ${f('practical_info', 'Godt at vide', p.practical_info, { rows: 4 })}
            ${f('house_rules', 'Husregler', p.house_rules, { rows: 4, hint: 'Én regel pr. linje.' })}
            <div class="field-row">${f('contact_name', 'Kontaktperson', p.contact_name)}${f('contact_phone', 'Kontakt-telefon', p.contact_phone, { type: 'tel' })}</div>
          </div>
        </section>
        <section class="form-section">
          <header><h2 class="h3">Wi-Fi og adgang</h2><p class="small muted">Vises kun for dem med et godkendt ophold, fra godkendelse til afrejse.</p></header>
          <div class="access-fields"><div class="skeleton" style="height:160px"></div></div>
        </section>
        <section class="form-section">
          <header><h2 class="h3">Vejr</h2><p class="small muted">Koordinater til vejrudsigten. Find dem ved at højreklikke på huset i Google Maps.</p></header>
          <div class="field-row">${f('latitude', 'Breddegrad', p.latitude, { type: 'number' })}${f('longitude', 'Længdegrad', p.longitude, { type: 'number' })}</div>
        </section>
        <div class="form-actions">
          <div class="form-error" role="alert"></div>
          <button type="submit" class="btn btn-accent btn-lg">Gem ${p.name}</button>
        </div>
      </form>
      <section class="form-section data-section">
        <header><h2 class="h3">Backup</h2><p class="small muted">Download alle ophold, noter, familie og indstillinger som én fil. Gem den et sikkert sted.</p></header>
        <div><button type="button" class="btn" data-export>${icon('download')}Download backup (JSON)</button></div>
      </section>`,
  );

  segmented($('[data-prop-switch]', host), (v) => navigate(`/admin/boliger?id=${v}`, { replace: true }));

  const accessHost = $('.access-fields', host);
  try {
    const a = (await api.propertyAccess(id)) || {};
    mount(
      accessHost,
      html`<div class="field-row">${f('wifi_name', 'Wi-Fi-netværk', a.wifi_name)}${f('wifi_password', 'Wi-Fi-kode', a.wifi_password)}</div>
        ${f('access_info', 'Adgang', a.access_info, { rows: 3, placeholder: 'Fx nøgleboks-kode eller hvor nøglen ligger' })}`,
    );
  } catch (err) {
    mount(accessHost, html`<div class="form-error">${err.message}</div>`);
  }

  const form = $('.prop-form', host);
  const grow = (t) => {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  };
  for (const t of form.querySelectorAll('textarea')) grow(t);
  form.addEventListener('input', (e) => {
    if (e.target.tagName === 'TEXTAREA') grow(e.target);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.textContent = '';
    const fd = new FormData(form);
    const data = {};
    for (const k of ['name', 'area', 'tagline', 'description', 'address', 'check_in_time', 'check_out_time', 'max_guests', 'arrival_info', 'practical_info', 'house_rules', 'contact_name', 'contact_phone', 'latitude', 'longitude']) {
      data[k] = fd.get(k);
    }
    if (!data.name?.trim()) {
      err.textContent = 'Navnet må ikke være tomt.';
      return;
    }
    try {
      await busy(form.querySelector('[type="submit"]'), async () => {
        await admin.updateProperty(id, data);
        if (fd.has('wifi_name')) {
          await admin.updateAccess(id, { wifi_name: fd.get('wifi_name'), wifi_password: fd.get('wifi_password'), access_info: fd.get('access_info') });
        }
        await loadProperties();
      });
      toast(`${data.name} er opdateret.`, { type: 'success' });
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  $('[data-export]', host).addEventListener('click', async (e) => {
    try {
      const data = await busy(e.currentTarget, () => admin.exportAll());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kolind-booking-backup-${D.today()}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      toast('Backup downloadet.', { type: 'success' });
    } catch (err) {
      toastError(err);
    }
  });
}

// ---------------------------------------------------------------------------

export default {
  access: 'admin',
  title: () => 'Administration',
  async render(el, r) {
    const tab = TABS.some((t) => t.id === r.params.tab) ? r.params.tab : 'overblik';
    const pending = state.me.pending_count || 0;
    mount(
      el,
      html`<div class="page admin-page">
        <div class="container">
          <header class="page-head">
            <p class="eyebrow">Administration</p>
            <h1 class="h1">${D.greeting()}, <em>${firstName(state.me.full_name)}</em></h1>
            <p class="lede">${pending ? `${pending === 1 ? 'Én forespørgsel venter' : `${pending} forespørgsler venter`} på jeres svar.` : 'Alt er besvaret. Her styrer I husene, familien og kalenderen.'}</p>
          </header>
          <nav class="tabs" aria-label="Administration">
            ${TABS.map(
              (t) => html`<a href="#/admin${t.id === 'overblik' ? '' : `/${t.id}`}" aria-current="${t.id === tab ? 'page' : 'false'}">${t.label}${t.id === 'overblik' && pending ? html`<span class="count">${pending}</span>` : ''}</a>`,
            )}
          </nav>
          <div class="admin-host"></div>
        </div>
      </div>`,
    );
    const host = $('.admin-host', el);
    const ctx = {
      query: r.query,
      refresh: async () => {
        invalidateCalendar();
        await refreshMeQuietly();
        const p = state.me.pending_count || 0;
        const lede = $('.lede', el);
        if (lede) lede.textContent = p ? `${p === 1 ? 'Én forespørgsel venter' : `${p} forespørgsler venter`} på jeres svar.` : 'Alt er besvaret. Her styrer I husene, familien og kalenderen.';
        await RENDER[tab](host, ctx);
      },
    };
    const RENDER = { overblik: renderOverview, ophold: renderBookings, familie: renderFamily, boliger: renderProperties };
    await RENDER[tab](host, ctx);
  },
};
