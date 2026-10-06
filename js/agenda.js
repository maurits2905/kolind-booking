// List of stays in the visible calendar months (below the calendar). On a
// phone the bars are thin, so this is where details and actions live.

import { html } from './html.js';
import { icon } from './icons.js';
import * as D from './dates.js';
import { isAdmin, state } from './state.js';
import { statusChip } from './ui.js';
import { whoLabel } from './booking-detail.js';

export function agenda(entries, { from, to, propertyIds, empty = 'Ingen ophold i perioden. Alt er ledigt.' }) {
  const list = entries
    .filter((e) => propertyIds.includes(e.property_id) && e.end_date > from && e.start_date < to)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.status === 'approved' ? -1 : 1));
  if (!list.length) {
    return html`<p class="agenda-empty">${icon('sun')}<span>${empty}</span></p>`;
  }
  const admin = isAdmin();
  return html`<ul class="agenda">
    ${list.map((e) => {
      const p = state.byId[e.property_id];
      const label = e.masked ? (e.status === 'pending' ? 'Forespurgt' : 'Optaget') : e.is_mine ? (e.status === 'pending' ? 'Din forespørgsel' : 'Dit ophold') : whoLabel({ ...e, person_name: e.label, title: e.label });
      const clickable = admin ? Boolean(e.id) : e.is_mine;
      const chip = e.masked ? (e.status === 'pending' ? statusChip('pending') : '') : statusChip(e.status, e.kind);
      const inner = html`<span class="agenda-bar p-${e.property_id} st-${e.status} ${e.masked ? 'is-masked' : `k-${e.kind}`}"></span>
        <span class="agenda-main">
          <span class="agenda-head"><strong>${label}</strong>${chip}</span>
          <span class="small muted">${D.fmtRange(e.start_date, e.end_date)} · ${D.nightsLabel(D.diffDays(e.start_date, e.end_date))}${propertyIds.length > 1 && p ? ` · ${p.name}` : ''}${e.guests ? ` · ${D.guestsLabel(e.guests)}` : ''}</span>
        </span>
        ${clickable ? html`<span class="agenda-go">${icon('chevron-right')}</span>` : ''}`;
      return clickable
        ? html`<li><button type="button" class="agenda-item" data-entry-id="${e.id || ''}" data-mine="${e.is_mine ? '1' : ''}">${inner}</button></li>`
        : html`<li><div class="agenda-item">${inner}</div></li>`;
    })}
  </ul>`;
}
