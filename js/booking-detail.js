// Admin: booking details, approve/reject, edit, cancel, delete, notes, history.

import config from '../config.js';
import { html, mount, $ } from './html.js';
import { icon } from './icons.js';
import * as D from './dates.js';
import { admin, api } from './api.js';
import { state, invalidateCalendar, refreshMeQuietly, firstName, cap } from './state.js';
import { style } from './properties.js';
import { openSheet, confirmDialog, toast, toastError, busy, statusChip, propertyTag } from './ui.js';
import { openBookingSheet } from './booking-form.js';
import { openMailDraft, decisionDraft } from './mail.js';

const ACTIONS = {
  requested: 'sendte forespørgslen',
  created: 'oprettede opholdet',
  approved: 'godkendte',
  rejected: 'afviste',
  cancelled: 'annullerede',
  pending: 'genåbnede',
  updated: 'ændrede opholdet',
  deleted: 'slettede opholdet',
};

export function whoLabel(b) {
  if (b.kind === 'blocked') return b.title || 'Lukket periode';
  if (b.kind === 'owner') return b.title || 'Egen ferie';
  return b.person_name || 'Ophold';
}

export function notify(b, approved) {
  const p = state.byId[b.property_id];
  const who = firstName(b.person_name) || 'personen';
  return openMailDraft(decisionDraft(b, p, approved), {
    theme: style(b.property_id).theme,
    title: `Mail til ${who}`,
    intro: approved
      ? `Opholdet er godkendt. Send mailen, så ${who} ved det og har den praktiske info.`
      : `Forespørgslen er afvist. Send mailen, så ${who} får svar.`,
  });
}

// Approve or reject with an optional message. Returns the updated booking or null.
export async function decide(b, approve, { button } = {}) {
  const name = firstName(b.person_name) || 'personen';
  const res = await confirmDialog({
    title: approve ? `Godkend ${name}s ophold?` : `Afslå ${name}s forespørgsel?`,
    message: `${state.byId[b.property_id]?.name || b.property_name} · ${D.fmtRange(b.start_date, b.end_date)} · ${D.guestsLabel(b.guests || 1)}`,
    confirmLabel: approve ? 'Godkend' : 'Afslå',
    danger: !approve,
    input: {
      label: `Besked til ${name} (valgfri)`,
      placeholder: approve ? 'Fx hvor nøglen ligger' : 'Fx hvorfor, eller forslag til andre datoer',
    },
  });
  if (!res) return null;
  try {
    const updated = await busy(button, () => admin.decide(b.id, approve, res.value));
    invalidateCalendar();
    refreshMeQuietly();
    toast(`${name} · ${D.fmtRange(b.start_date, b.end_date)}`, { type: 'success', title: approve ? 'Godkendt' : 'Afslået' });
    notify(updated, approve);
    return updated;
  } catch (err) {
    toastError(err);
    return null;
  }
}

export async function openBookingDetail(id, { onChange } = {}) {
  const sheet = openSheet({ title: 'Ophold', body: html`<div class="skeleton" style="height:260px"></div>`, wide: true });
  let b;
  const changed = () => {
    invalidateCalendar();
    refreshMeQuietly();
    onChange?.();
  };

  async function load() {
    try {
      b = await admin.detail(id);
      render();
    } catch (err) {
      sheet.setBody(html`<div class="form-error">${icon('alert')}${err.message}</div>`);
    }
  }

  function render() {
    const st = style(b.property_id);
    sheet.el.dataset.theme = st.theme;
    sheet.setTitle(whoLabel(b));
    const future = b.end_date >= D.today();
    sheet.setBody(html`<div class="detail">
      <div class="row row-wrap" style="--gap:8px">
        ${statusChip(b.status, b.kind)}
        ${propertyTag(state.byId[b.property_id] || { id: b.property_id, name: b.property_name })}
        ${b.is_guest ? html`<span class="tag">${icon('users')}Gæst${b.sponsor_name ? ` af ${firstName(b.sponsor_name)}` : ''}</span>` : ''}
      </div>

      <div class="detail-dates">
        <div><span class="label">Ankomst</span><strong>${D.fmtDayLong(b.start_date, { year: true })}</strong></div>
        <span aria-hidden="true">${icon('arrow-right')}</span>
        <div><span class="label">Afrejse</span><strong>${D.fmtDayLong(b.end_date, { year: true })}</strong></div>
      </div>
      <p class="muted small">${D.nightsLabel(b.nights)}${b.guests ? ` · ${D.guestsLabel(b.guests)}` : ''}${b.start_date > D.today() ? ` · ankomst ${D.relative(b.start_date)}` : ''}</p>

      ${b.conflict
        ? html`<div class="notice notice-danger">${icon('alert')}<span><strong>Overlapper et godkendt ophold.</strong> Forespørgslen kan ikke godkendes med de datoer. Afslå den, eller ret datoerne.</span></div>`
        : b.competing
          ? html`<div class="notice notice-warn">${icon('info')}<span>Der er ${b.competing === 1 ? 'en anden forespørgsel' : `${b.competing} andre forespørgsler`} på nogle af de samme datoer.</span></div>`
          : ''}

      ${b.is_guest || b.user_email
        ? html`<dl class="kv">
            ${b.user_email ? html`<div><dt>Email</dt><dd><a href="mailto:${b.user_email}">${b.user_email}</a></dd></div>` : ''}
            ${b.guest_email ? html`<div><dt>Email</dt><dd><a href="mailto:${b.guest_email}">${b.guest_email}</a></dd></div>` : ''}
            ${b.guest_phone ? html`<div><dt>Telefon</dt><dd><a href="tel:${b.guest_phone.replace(/\s/g, '')}">${b.guest_phone}</a></dd></div>` : ''}
            ${b.sponsor_name ? html`<div><dt>Kender</dt><dd>${b.sponsor_name}</dd></div>` : ''}
          </dl>`
        : ''}

      ${b.comment ? html`<blockquote class="quote"><cite>${b.kind === 'stay' ? firstName(b.person_name) : 'Kommentar'}</cite>${b.comment}</blockquote>` : ''}
      ${b.decision_note ? html`<blockquote class="quote quote-reply"><cite>${b.decided_by_name || cap(config.adminNames)}</cite>${b.decision_note}</blockquote>` : ''}

      <div class="field">
        <label class="label" for="admin-note">Intern note <span class="muted">(kun for administratorer)</span></label>
        <textarea class="textarea" id="admin-note" rows="2" maxlength="2000" placeholder="Fx aftaler om nøgle eller rengøring">${b.note || ''}</textarea>
        <div class="row" style="--gap:8px;justify-content:flex-end"><span class="hint note-status"></span><button type="button" class="btn btn-sm" data-save-note>Gem note</button></div>
      </div>

      <details class="history">
        <summary>${icon('history')}Historik (${b.events.length})</summary>
        <ol class="timeline">
          ${b.events.map(
            (e) => html`<li><time>${D.fmtTimestamp(e.at)}</time><strong>${e.actor_name}</strong> ${ACTIONS[e.action] || e.action}${
              e.action === 'updated' && e.details?.to
                ? html`: ${D.fmtRange(e.details.from.start_date, e.details.from.end_date)} → ${D.fmtRange(e.details.to.start_date, e.details.to.end_date)}`
                : ''
            }${e.details?.message ? html` <span class="muted">"${e.details.message}"</span>` : ''}</li>`,
          )}
        </ol>
      </details>

      <div class="detail-more">
        ${future || b.status === 'pending' ? html`<button type="button" class="btn btn-sm" data-edit>${icon('edit')}Ret</button>` : ''}
        ${b.kind === 'stay' && (b.status === 'approved' || b.status === 'rejected') ? html`<button type="button" class="btn btn-sm" data-notify>${icon('mail')}Lav mail til ${firstName(b.person_name)}</button>` : ''}
        ${b.status === 'approved' && future && b.kind === 'stay' ? html`<button type="button" class="btn btn-sm btn-danger-quiet" data-cancel>${icon('ban')}Annullér</button>` : ''}
        <button type="button" class="btn btn-sm btn-danger-quiet" data-delete>${icon('trash')}Slet</button>
      </div>
    </div>`);

    sheet.setFoot(
      b.status === 'pending'
        ? html`<button type="button" class="btn btn-danger-quiet" data-reject>Afslå</button>
            <button type="button" class="btn btn-accent" data-approve ${b.conflict ? 'disabled' : ''}>${icon('check')}Godkend</button>`
        : html`<button type="button" class="btn" data-close>Luk</button>`,
    );
    bind();
  }

  function bind() {
    const body = sheet.body;
    const foot = sheet.foot;
    $('[data-close]', foot)?.addEventListener('click', () => sheet.close());
    $('[data-approve]', foot)?.addEventListener('click', async (e) => {
      const u = await decide(b, true, { button: e.currentTarget });
      if (u) {
        changed();
        await load();
      }
    });
    $('[data-reject]', foot)?.addEventListener('click', async (e) => {
      const u = await decide(b, false, { button: e.currentTarget });
      if (u) {
        changed();
        await load();
      }
    });
    $('[data-save-note]', body).addEventListener('click', async (e) => {
      const note = $('#admin-note', body).value;
      try {
        await busy(e.currentTarget, () => admin.setNote(b.id, note));
        b.note = note;
        $('.note-status', body).textContent = 'Gemt';
        onChange?.();
      } catch (err) {
        toastError(err);
      }
    });
    $('[data-notify]', body)?.addEventListener('click', () => notify(b, b.status === 'approved'));
    $('[data-edit]', body)?.addEventListener('click', () => {
      sheet.close();
      openBookingSheet({ booking: b, onDone: changed });
    });
    $('[data-cancel]', body)?.addEventListener('click', async (e) => {
      const res = await confirmDialog({
        title: 'Annullér opholdet?',
        message: `${whoLabel(b)} · ${D.fmtRange(b.start_date, b.end_date)}. Perioden bliver ledig igen.`,
        confirmLabel: 'Annullér ophold',
        cancelLabel: 'Behold',
        danger: true,
        input: { label: 'Besked (valgfri)', placeholder: 'Fx årsagen' },
      });
      if (!res) return;
      try {
        await busy(e.currentTarget, () => api.cancelBooking(b.id, res.value));
        toast('Opholdet er annulleret.', { type: 'success' });
        changed();
        await load();
      } catch (err) {
        toastError(err);
      }
    });
    $('[data-delete]', body).addEventListener('click', async (e) => {
      const ok = await confirmDialog({
        title: 'Slet opholdet helt?',
        message: 'Det forsvinder fra kalenderen og listerne. Historikken gemmes. Vil du bare frigive perioden, så brug "Annullér" i stedet.',
        confirmLabel: 'Slet',
        danger: true,
      });
      if (!ok) return;
      try {
        await busy(e.currentTarget, () => admin.remove(b.id));
        toast('Opholdet er slettet.', { type: 'success' });
        sheet.close();
        changed();
      } catch (err) {
        toastError(err);
      }
    });
  }

  await load();
  return sheet;
}
