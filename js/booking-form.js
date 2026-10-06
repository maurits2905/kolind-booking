// The booking sheet: family members send a request, the admins book,
// block or edit directly (always approved).

import config from '../config.js';
import { html, mount, $, $$ } from './html.js';
import { icon } from './icons.js';
import * as D from './dates.js';
import { api, admin } from './api.js';
import { state, isAdmin, property, calendarEntries, invalidateCalendar, refreshMeQuietly, firstName, cap } from './state.js';
import { style } from './properties.js';
import { openSheet, toast, busy, nextId, segmented } from './ui.js';
import { createCalendar } from './calendar.js';
import { takenNights, isRangeFree, overlapsPending } from './availability.js';
import { navigate } from './router.js';
import { adminContacts, requestDraft, mailDraftBlock, bindMailDraft } from './mail.js';

let familyCache = null;
async function family() {
  if (!familyCache) {
    const people = await admin.people();
    familyCache = people.members.filter((m) => m.active);
    setTimeout(() => (familyCache = null), 60_000);
  }
  return familyCache;
}

export function stepper(name, value, minV, maxV, label) {
  return html`<div class="stepper" data-stepper="${name}" data-min="${minV}" data-max="${maxV}" role="group" aria-label="${label}">
    <button type="button" data-step="-1" aria-label="Færre">${icon('minus')}</button>
    <output name="${name}" aria-live="polite">${value}</output>
    <button type="button" data-step="1" aria-label="Flere">${icon('plus')}</button>
  </div>`;
}

export function bindStepper(root, onChange) {
  for (const st of $$('[data-stepper]', root)) {
    const out = $('output', st);
    const minV = Number(st.dataset.min);
    const maxV = Number(st.dataset.max);
    const sync = () => {
      const v = Number(out.textContent);
      $('[data-step="-1"]', st).disabled = v <= minV;
      $('[data-step="1"]', st).disabled = v >= maxV;
    };
    st.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const v = Math.min(maxV, Math.max(minV, Number(out.textContent) + Number(b.dataset.step)));
      out.textContent = v;
      sync();
      onChange?.(st.dataset.stepper, v);
    });
    sync();
  }
}

/**
 * Opens the booking sheet.
 * opts: { propertyId, start, end, booking (admin edit), kind ('stay'|'owner'|'blocked'), onDone }
 */
export async function openBookingSheet(opts = {}) {
  const adminMode = isAdmin();
  const editing = Boolean(opts.booking);
  const b = opts.booking || {};
  const f = {
    propertyId: b.property_id || opts.propertyId || state.properties[0]?.id,
    start: b.start_date || opts.start || null,
    end: b.end_date || opts.end || null,
    kind: b.kind || opts.kind || 'stay',
    guests: b.guests || null,
    comment: b.comment || '',
    who: b.id ? (b.user_id ? (b.user_id === state.me.id ? 'me' : 'member') : 'guest') : 'me',
    userId: b.user_id || null,
    personName: b.user_id ? '' : b.person_name || '',
    guestEmail: b.guest_email || '',
    guestPhone: b.guest_phone || '',
    title: b.title || '',
  };
  let pickerOpen = !f.start || !f.end;
  let entries = [];
  let members = [];
  let cal = null;

  const title = editing
    ? 'Ret ophold'
    : adminMode
      ? f.kind === 'blocked'
        ? 'Bloker periode'
        : 'Opret ophold'
      : 'Forespørg ophold';

  const sheet = openSheet({ title, body: html`<div class="skeleton" style="height:220px"></div>`, wide: false, className: 'booking-sheet' });
  const adminsPromise = adminMode ? null : adminContacts();

  try {
    const from = D.addMonths(D.startOfMonth(D.today()), -1);
    [entries, members] = await Promise.all([
      calendarEntries(from, D.addMonths(from, 18)),
      adminMode ? family() : Promise.resolve([]),
    ]);
  } catch (err) {
    sheet.setBody(html`<div class="form-error">${icon('alert')}${err.message}</div>`);
    return;
  }
  // When editing, the booking's own nights must not count as taken.
  const pickerEntries = () => entries.filter((e) => !(b.id && e.id === b.id));

  function prop() {
    return property(f.propertyId) || { id: f.propertyId, name: f.propertyId, max_guests: 8 };
  }

  function datesValid() {
    if (!f.start || !f.end || f.end <= f.start) return false;
    if (f.kind !== 'stay' || adminMode) {
      return isRangeFree(takenNights(pickerEntries(), f.propertyId), f.start, f.end);
    }
    return f.start >= D.today() && isRangeFree(takenNights(pickerEntries(), f.propertyId), f.start, f.end);
  }

  function render() {
    const p = prop();
    const st = style(f.propertyId);
    sheet.el.dataset.theme = st.theme;
    if (!f.guests) f.guests = Math.min(2, p.max_guests || 2);
    if (f.guests > p.max_guests) f.guests = p.max_guests;
    const nights = f.start && f.end ? D.diffDays(f.start, f.end) : 0;
    const conflictPending = f.start && f.end && !adminMode && overlapsPending(entries, f.propertyId, f.start, f.end);
    const others = members.filter((m) => m.id !== state.me.id);
    const ids = { comment: nextId('c'), who: nextId('w'), name: nextId('n'), email: nextId('e'), phone: nextId('p'), title: nextId('t'), member: nextId('m') };

    sheet.setBody(html`<form class="booking-form" novalidate>
      ${adminMode && !editing
        ? html`<div class="segmented block" data-kind role="group" aria-label="Type">
            <button type="button" data-value="stay" aria-pressed="${f.kind === 'stay'}">Ophold</button>
            <button type="button" data-value="owner" aria-pressed="${f.kind === 'owner'}">Egen ferie</button>
            <button type="button" data-value="blocked" aria-pressed="${f.kind === 'blocked'}">Lukket</button>
          </div>`
        : ''}
      ${(adminMode && state.properties.length > 1) || (!f.start && state.properties.length > 1)
        ? html`<div class="segmented block" data-prop role="group" aria-label="Bolig">
            ${state.properties.map(
              (x) => html`<button type="button" data-value="${x.id}" aria-pressed="${x.id === f.propertyId}"><span class="seg-dot prop-dot ${x.id}"></span>${x.name}</button>`,
            )}
          </div>`
        : ''}

      <div class="stay-summary">
        <img src="${st.imageSm}" alt="" loading="lazy" style="object-position:${st.focus}">
        <div class="stay-summary-text">
          <span class="eyebrow">${p.area || ''}</span>
          <strong class="h4">${p.name}</strong>
          ${nights ? html`<span class="small muted">${D.nightsLabel(nights)}${f.kind !== 'blocked' ? html` · ${D.guestsLabel(f.guests)}` : ''}</span>` : ''}
        </div>
      </div>

      <div class="date-boxes" role="group" aria-label="Datoer">
        <button type="button" class="date-box ${pickerOpen && !f.start ? 'is-active' : ''}" data-toggle-picker>
          <span class="label">Ankomst</span>
          <strong>${f.start ? D.fmtDayMedium(f.start) : 'Vælg dato'}</strong>
          ${f.start && p.check_in_time && f.kind === 'stay' ? html`<span class="tiny muted">fra kl. ${p.check_in_time}</span>` : ''}
        </button>
        <span class="date-arrow" aria-hidden="true">${icon('arrow-right')}</span>
        <button type="button" class="date-box ${pickerOpen && f.start && !f.end ? 'is-active' : ''}" data-toggle-picker>
          <span class="label">Afrejse</span>
          <strong>${f.end ? D.fmtDayMedium(f.end) : 'Vælg dato'}</strong>
          ${f.end && p.check_out_time && f.kind === 'stay' ? html`<span class="tiny muted">senest kl. ${p.check_out_time}</span>` : ''}
        </button>
      </div>
      <div class="picker" ${pickerOpen ? '' : 'hidden'}><div class="picker-cal"></div></div>

      ${conflictPending
        ? html`<div class="notice notice-warn">${icon('info')}<span>Der ligger allerede en forespørgsel på nogle af datoerne. ${cap(config.adminNames)} vælger, hvem der får huset.</span></div>`
        : ''}

      ${f.kind === 'stay' && adminMode
        ? html`<fieldset class="fieldset">
            <legend class="label">Hvem skal bo der?</legend>
            <div class="choice-grid" id="${ids.who}">
              <label class="choice"><input type="radio" name="who" value="me" ${f.who === 'me' ? 'checked' : ''}><span class="dot"></span>Mig selv</label>
              <label class="choice"><input type="radio" name="who" value="member" ${f.who === 'member' ? 'checked' : ''}><span class="dot"></span>Familie</label>
              <label class="choice"><input type="radio" name="who" value="guest" ${f.who === 'guest' ? 'checked' : ''}><span class="dot"></span>Gæst</label>
            </div>
          </fieldset>
          ${f.who === 'member' && !others.length
            ? html`<div class="notice">${icon('info')}<span>Der er ingen andre familiemedlemmer med en konto endnu. Inviter dem under <strong>Administration → Familie</strong>, eller vælg <strong>Mig selv</strong> eller <strong>Gæst</strong>.</span></div>`
            : f.who === 'member'
              ? html`<div class="field">
                  <label class="label" for="${ids.member}">Familiemedlem</label>
                  <select class="select" id="${ids.member}" name="userId" required>
                    <option value="">Vælg…</option>
                    ${others.map((m) => html`<option value="${m.id}" ${m.id === f.userId ? 'selected' : ''}>${m.full_name}</option>`)}
                  </select>
                </div>`
              : ''}
          ${f.who === 'guest'
            ? html`<div class="field">
                <label class="label" for="${ids.name}">Gæstens navn</label>
                <input class="input" id="${ids.name}" name="personName" value="${f.personName}" maxlength="80" autocomplete="off" required>
              </div>
              <div class="field-row">
                <div class="field">
                  <label class="label" for="${ids.email}">Email <span class="muted">(valgfri)</span></label>
                  <input class="input" id="${ids.email}" name="guestEmail" type="email" value="${f.guestEmail}" maxlength="120" autocomplete="off">
                </div>
                <div class="field">
                  <label class="label" for="${ids.phone}">Telefon <span class="muted">(valgfri)</span></label>
                  <input class="input" id="${ids.phone}" name="guestPhone" type="tel" value="${f.guestPhone}" maxlength="30" autocomplete="off">
                </div>
              </div>`
            : ''}`
        : ''}

      ${f.kind !== 'stay'
        ? html`<div class="field">
            <label class="label" for="${ids.title}">${f.kind === 'blocked' ? 'Årsag' : 'Titel'} <span class="muted">(valgfri)</span></label>
            <input class="input" id="${ids.title}" name="title" value="${f.title}" maxlength="80"
              placeholder="${f.kind === 'blocked' ? 'Fx håndværkere eller udlejning' : 'Fx Vores ferie'}">
            <span class="hint">${f.kind === 'blocked' ? 'Familien ser perioden som optaget.' : 'Familien ser perioden som optaget, ikke titlen.'}</span>
          </div>`
        : ''}

      ${f.kind !== 'blocked'
        ? html`<div class="field field-inline">
            <span class="label">Antal personer</span>
            ${stepper('guests', f.guests, 1, p.max_guests || 8, 'Antal personer')}
          </div>`
        : ''}

      <div class="field">
        <label class="label" for="${ids.comment}">${adminMode ? 'Kommentar' : html`Besked til ${config.adminNames}`} <span class="muted">(valgfri)</span></label>
        <textarea class="textarea" id="${ids.comment}" name="comment" rows="3" maxlength="1000"
          placeholder="${adminMode ? 'Vises for den, der bor der' : 'Fx hvem I er, eller om I har brug for noget'}">${f.comment}</textarea>
      </div>
      <div class="form-error" role="alert"></div>
    </form>`);

    sheet.setFoot(html`<button type="button" class="btn" data-cancel>Fortryd</button>
      <button type="button" class="btn btn-accent" data-submit ${datesValid() ? '' : 'disabled'}>
        ${editing ? 'Gem ændringer' : adminMode ? (f.kind === 'blocked' ? 'Bloker periode' : 'Book nu') : 'Send forespørgsel'}
      </button>`);

    bind();
  }

  function readFields() {
    const form = $('form', sheet.body);
    const fd = new FormData(form);
    if (fd.has('comment')) f.comment = fd.get('comment');
    if (fd.has('title')) f.title = fd.get('title');
    if (fd.has('personName')) f.personName = fd.get('personName');
    if (fd.has('guestEmail')) f.guestEmail = fd.get('guestEmail');
    if (fd.has('guestPhone')) f.guestPhone = fd.get('guestPhone');
    if (fd.has('userId')) f.userId = fd.get('userId');
    const out = $('output[name="guests"]', form);
    if (out) f.guests = Number(out.textContent);
  }

  function bind() {
    const body = sheet.body;
    const kindEl = $('[data-kind]', body);
    if (kindEl) {
      segmented(kindEl, (v) => {
        readFields();
        f.kind = v;
        sheet.setTitle(v === 'blocked' ? 'Bloker periode' : 'Opret ophold');
        render();
      });
    }
    const propEl = $('[data-prop]', body);
    if (propEl) {
      segmented(propEl, (v) => {
        readFields();
        f.propertyId = v;
        if (f.start && f.end && !isRangeFree(takenNights(pickerEntries(), v), f.start, f.end)) {
          f.start = null;
          f.end = null;
          pickerOpen = true;
        }
        render();
      });
    }
    bindStepper(body);
    for (const r of $$('input[name="who"]', body)) {
      r.addEventListener('change', () => {
        readFields();
        f.who = r.value;
        render();
      });
    }
    for (const t of $$('[data-toggle-picker]', body)) {
      t.addEventListener('click', () => {
        pickerOpen = !pickerOpen || !f.start || !f.end;
        $('.picker', body).hidden = !pickerOpen;
        if (pickerOpen) mountPicker();
      });
    }
    if (pickerOpen) mountPicker();

    sheet.foot.querySelector('[data-cancel]').addEventListener('click', () => sheet.close());
    sheet.foot.querySelector('[data-submit]').addEventListener('click', (e) => submit(e.currentTarget));
  }

  function mountPicker() {
    const el = $('.picker-cal', sheet.body);
    cal?.destroy();
    cal = createCalendar(el, {
      mode: 'single',
      propertyId: f.propertyId,
      entries: pickerEntries(),
      selectable: true,
      selection: { start: f.start, end: f.end },
      month: D.startOfMonth(f.start || D.today()),
      minDate: adminMode ? D.addDays(D.today(), -365) : D.today(),
      minMonth: adminMode ? D.addMonths(D.startOfMonth(D.today()), -12) : D.startOfMonth(D.today()),
      maxNights: adminMode ? 120 : 60,
      maxMonths: 1,
      onSelect: (s) => {
        f.start = s.start;
        f.end = s.end;
        if (s.start && s.end) {
          readFields();
          pickerOpen = false;
          render();
        } else {
          updateDateBoxes();
        }
      },
    });
  }

  function updateDateBoxes() {
    const boxes = $$('.date-box', sheet.body);
    boxes[0].querySelector('strong').textContent = f.start ? D.fmtDayMedium(f.start) : 'Vælg dato';
    boxes[1].querySelector('strong').textContent = f.end ? D.fmtDayMedium(f.end) : 'Vælg dato';
    boxes[0].classList.toggle('is-active', !f.start);
    boxes[1].classList.toggle('is-active', Boolean(f.start && !f.end));
    sheet.foot.querySelector('[data-submit]').disabled = !datesValid();
  }

  async function submit(btn) {
    readFields();
    const errEl = $('.form-error', sheet.body);
    errEl.textContent = '';
    if (!datesValid()) {
      errEl.textContent = 'Vælg en ledig ankomst- og afrejsedag.';
      return;
    }
    if (adminMode && f.kind === 'stay' && f.who === 'member' && !f.userId) {
      errEl.textContent = 'Vælg hvilket familiemedlem opholdet er til.';
      return;
    }
    if (adminMode && f.kind === 'stay' && f.who === 'guest' && !f.personName.trim()) {
      errEl.textContent = 'Skriv gæstens navn.';
      return;
    }
    try {
      await busy(btn, async () => {
        if (adminMode) {
          const saved = await admin.save({
            id: b.id,
            propertyId: f.propertyId,
            kind: f.kind,
            start: f.start,
            end: f.end,
            guests: f.kind === 'blocked' ? null : f.guests,
            userId: f.kind === 'stay' ? (f.who === 'me' ? state.me.id : f.who === 'member' ? f.userId : null) : null,
            personName: f.kind === 'stay' && f.who === 'guest' ? f.personName : null,
            guestEmail: f.who === 'guest' ? f.guestEmail : null,
            guestPhone: f.who === 'guest' ? f.guestPhone : null,
            title: f.kind !== 'stay' ? f.title : null,
            comment: f.comment,
          });
          invalidateCalendar();
          sheet.close();
          toast(`${prop().name} · ${D.fmtRange(f.start, f.end)}`, {
            type: 'success',
            title: editing ? 'Ændringer gemt' : f.kind === 'blocked' ? 'Perioden er blokeret' : 'Opholdet er booket',
          });
          opts.onDone?.(saved);
        } else {
          const saved = await api.requestBooking({
            propertyId: f.propertyId,
            start: f.start,
            end: f.end,
            guests: f.guests,
            comment: f.comment,
          });
          invalidateCalendar();
          await showRequestSuccess(saved);
          opts.onDone?.(saved);
        }
        refreshMeQuietly();
      });
    } catch (err) {
      errEl.textContent = err.message;
      errEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function showRequestSuccess(saved) {
    const p = prop();
    const admins = (await adminsPromise) || [];
    const draft = requestDraft(saved, p, admins);
    sheet.setTitle('Forespørgsel sendt');
    sheet.el.classList.add('wide');
    sheet.setBody(html`<div class="success-block success-compact">
        <div class="success-mark">${icon('check')}</div>
        <h3 class="h3">Tak, ${firstName(state.me.full_name)}</h3>
        <p class="muted">Din forespørgsel på <strong>${p.name}</strong> ${D.fmtRange(saved.start_date, saved.end_date)} er registreret. Du kan følge den under Mine ophold.</p>
      </div>
      <div class="mail-step">
        <p class="mail-step-title"><span class="step-num">!</span>Sidste trin: send mailen til ${config.adminNames}, så de ved, at den ligger og venter.</p>
        ${mailDraftBlock(draft)}
      </div>`);
    bindMailDraft(sheet.body, draft);
    sheet.setFoot(html`<button type="button" class="btn" data-mine>Se mine ophold</button>
      <button type="button" class="btn btn-accent" data-send-mail>${icon('mail')}Åbn i mail</button>`);
    sheet.foot.querySelector('[data-mine]').addEventListener('click', () => {
      sheet.close();
      navigate('/mine');
    });
    sheet.foot.querySelector('[data-send-mail]').addEventListener('click', () => sheet.body.querySelector('[data-mail-open]').click());
  }

  render();
  return sheet;
}
