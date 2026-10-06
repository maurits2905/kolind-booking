// "De næste måneder": both houses on one horizontal timeline.

import { html } from './html.js';
import * as D from './dates.js';
import { segments } from './availability.js';

export function overviewStrip(entries, properties, { days = 92, from = D.today() } = {}) {
  const to = D.addDays(from, days);
  const pct = (n) => `${((n / days) * 100).toFixed(3)}%`;
  const ticks = [];
  let m = D.addMonths(D.startOfMonth(from), 1);
  while (m < to) {
    const at = D.diffDays(from, m);
    ticks.push({ at, label: at < days * 0.07 ? '' : D.MONTHS_SHORT[D.parts(m).m - 1] });
    m = D.addMonths(m, 1);
  }
  const weekends = [];
  for (let d = from; d < to; d = D.addDays(d, 1)) {
    if (D.weekday(d) === 5) weekends.push(D.diffDays(from, d));
  }

  return html`<div class="overview" role="img" aria-label="Belægning de næste ${days} dage">
    <div class="ov-scale" aria-hidden="true">
      <span class="ov-tick ov-today" style="left:0">I dag</span>
      ${ticks.filter((t) => t.label).map((t) => html`<span class="ov-tick" style="left:${pct(t.at)}">${t.label}</span>`)}
    </div>
    ${properties.map((p) => {
      const segs = segments(entries, p.id, from, to);
      return html`<div class="ov-row p-${p.id}">
        <a class="ov-name" href="#/bolig/${p.id}"><span class="prop-dot ${p.id}"></span>${p.name}</a>
        <div class="ov-track">
          ${weekends.map((w) => html`<i class="ov-weekend" style="left:${pct(w)};width:${pct(2)}"></i>`)}
          ${ticks.map((t) => html`<i class="ov-line" style="left:${pct(t.at)}"></i>`)}
          ${segs.map(
            (s) => html`<span class="ov-seg st-${s.status} ${s.entry.is_mine ? 'is-mine' : ''}"
              style="left:${pct(s.offset)};width:${pct(Math.max(s.length, 0.6))}"
              title="${s.status === 'pending' ? 'Forespurgt' : s.entry.is_mine ? 'Dit ophold' : s.entry.masked ? 'Optaget' : s.entry.label || 'Optaget'} · ${D.fmtRange(s.entry.start_date, s.entry.end_date)}"></span>`,
          )}
        </div>
      </div>`;
    })}
  </div>`;
}
