// Month calendar with stays drawn as continuous bars.
//
// Each day is split in two halves: a stay runs from the middle of the arrival
// day to the middle of the departure day. That shows at a glance that the
// departure day is free for the next arrival (back-to-back stays meet in the
// middle of the day).
//
// Modes:  single → one house, date range selection
//         both   → both houses in two lanes (overview, no selection)

import { html, mount, raw, $, $$ } from './html.js';
import { icon } from './icons.js';
import * as D from './dates.js';
import { takenNights, nextTaken } from './availability.js';

const WD = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
const WD_LONG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

export function createCalendar(root, options) {
  const autoMonth = !options.month;
  let firstRender = true;
  const o = {
    mode: 'single',
    propertyId: null,
    propertyIds: [],
    entries: [],
    selectable: false,
    selection: { start: null, end: null },
    month: D.startOfMonth(D.today()),
    minDate: D.today(),
    maxNights: 60,
    minMonth: D.addMonths(D.startOfMonth(D.today()), -1),
    maxMonth: D.addMonths(D.startOfMonth(D.today()), 24),
    maxMonths: 2,
    legend: [],
    labelFor: null, // (entry) => text on bar
    onSelect: null,
    onMonthChange: null,
    onEntry: null,
    onDay: null,
    ...options,
  };
  o.maxDate = o.maxDate || D.addDays(D.today(), 730);
  o.month = o.month || D.startOfMonth(D.today());
  let sel = { start: o.selection?.start || null, end: o.selection?.end || null };
  let monthsShown = 1;
  let focusDate = null;
  let hoverDate = null;
  let taken = new Set();
  let hintTimer = null;

  root.classList.add('cal');
  root.dataset.mode = o.mode;
  mount(
    root,
    html`<div class="cal-toolbar">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Forrige måned">${icon('chevron-left')}</button>
        <div class="cal-toolbar-title" aria-hidden="true"></div>
        <button type="button" class="cal-today" data-today>I dag</button>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Næste måned">${icon('chevron-right')}</button>
      </div>
      <div class="cal-months"></div>
      <div class="cal-foot">
        <p class="cal-hint" aria-live="polite"></p>
        <div class="cal-legend"></div>
      </div>`,
  );
  const monthsEl = $('.cal-months', root);
  const hintEl = $('.cal-hint', root);

  // ---------- data ----------

  function derive() {
    taken = o.mode === 'single' ? takenNights(o.entries, o.propertyId) : new Set();
  }

  function maxEnd(start) {
    const next = nextTaken(taken, D.addDays(start, 1), o.maxNights + 1);
    const cap = D.addDays(start, o.maxNights);
    return next && next < cap ? next : cap;
  }

  function canStart(d) {
    return d >= o.minDate && d <= o.maxDate && !taken.has(d);
  }

  function canEnd(d) {
    return sel.start && d > sel.start && d <= maxEnd(sel.start);
  }

  // ---------- rendering ----------

  function monthDates(first) {
    const dim = D.daysInMonth(first);
    const { y, m } = D.parts(first);
    const weeks = [];
    let day = 1 - D.weekday(first);
    while (day <= dim) {
      const cells = [];
      for (let i = 0; i < 7; i++, day++) cells.push(day >= 1 && day <= dim ? D.iso(y, m, day) : null);
      weeks.push(cells);
    }
    return weeks;
  }

  function visibleEntries() {
    if (o.mode === 'single') return o.entries.filter((e) => e.property_id === o.propertyId);
    // Overview: hide pending requests that overlap an approved stay (they cannot be approved).
    const byProp = {};
    for (const pid of o.propertyIds) byProp[pid] = takenNights(o.entries, pid);
    return o.entries.filter((e) => {
      if (!o.propertyIds.includes(e.property_id)) return false;
      if (e.status === 'approved') return true;
      for (let d = e.start_date; d < e.end_date; d = D.addDays(d, 1)) if (byProp[e.property_id].has(d)) return false;
      return true;
    });
  }

  function barsForWeek(cells, entries) {
    const firstIdx = cells.findIndex(Boolean);
    const lastIdx = 6 - [...cells].reverse().findIndex(Boolean);
    const first = cells[firstIdx];
    const last = cells[lastIdx];
    const segs = [];
    for (const e of entries) {
      const s = e.start_date;
      const en = e.end_date;
      if (s > last || en < first || (en === first && s >= first)) continue;
      const flatL = s < first;
      const flatR = en > last;
      const cs = flatL ? 2 * firstIdx + 1 : 2 * D.weekday(s) + 2;
      const ce = flatR ? 2 * lastIdx + 3 : 2 * D.weekday(en) + 2;
      if (ce <= cs) continue;
      segs.push({ e, cs, ce, flatL, flatR });
    }
    // Lanes: approved first so they always sit on the bottom lane.
    segs.sort((a, b) => (a.e.status === b.e.status ? a.cs - b.cs : a.e.status === 'approved' ? -1 : 1));
    const lanes = [];
    for (const sg of segs) {
      if (o.mode === 'both') {
        sg.lane = o.propertyIds.indexOf(sg.e.property_id);
        continue;
      }
      let lane = 0;
      while (lanes[lane]?.some(([a, b]) => sg.cs < b && sg.ce > a)) lane += 1;
      (lanes[lane] ||= []).push([sg.cs, sg.ce]);
      sg.lane = lane;
    }
    return segs.filter((sg) => sg.lane < 3);
  }

  function barClass(e) {
    const c = ['cal-bar', `st-${e.status}`, `p-${e.property_id}`];
    if (e.masked) c.push('is-masked');
    else c.push(`k-${e.kind}`);
    if (e.is_mine) c.push('is-mine');
    return c.join(' ');
  }

  function barLabel(e) {
    if (o.labelFor) return o.labelFor(e);
    if (e.masked) return e.status === 'pending' ? 'Forespurgt' : 'Optaget';
    if (e.is_mine) return e.status === 'pending' ? 'Din forespørgsel' : 'Dit ophold';
    return e.label || '';
  }

  function dayLabel(date) {
    const parts = [D.fmtDayLong(date, { year: true })];
    if (o.mode === 'single') {
      if (date < o.minDate) parts.push('passeret');
      else parts.push(taken.has(date) ? 'optaget' : 'ledig');
    }
    return parts.join(', ');
  }

  function render() {
    derive();
    monthsShown = o.maxMonths > 1 && root.clientWidth >= 700 ? 2 : 1;
    if (firstRender && autoMonth && monthsShown === 1) {
      // Almost at the end of the month: start on the next one (the previous is one tap away).
      const t0 = D.today();
      const next = D.addMonths(D.startOfMonth(t0), 1);
      if (o.month === D.startOfMonth(t0) && D.diffDays(t0, next) <= 5 && next <= o.maxMonth) o.month = next;
    }
    firstRender = false;
    const entries = visibleEntries();
    const firsts = Array.from({ length: monthsShown }, (_, i) => D.addMonths(o.month, i));
    const t = D.today();
    if (!focusDate || focusDate < firsts[0] || focusDate >= D.addMonths(firsts[0], monthsShown)) {
      focusDate = t >= firsts[0] && t < D.addMonths(firsts[0], monthsShown) ? t : firsts[0];
    }

    mount(
      monthsEl,
      firsts.map(
        (first) => html`<section class="cal-month" aria-label="${D.fmtMonth(first)}">
          <h3 class="cal-month-title">${D.fmtMonth(first)}</h3>
          <div class="cal-weekdays" aria-hidden="true">${WD.map((w, i) => html`<span title="${WD_LONG[i]}">${w}</span>`)}</div>
          <div class="cal-grid" role="grid" aria-label="${D.fmtMonth(first)}">
            ${monthDates(first).map((cells) => {
              const segs = barsForWeek(cells, entries);
              return html`<div class="cal-week" role="row">
                ${cells.map((date) =>
                  date
                    ? html`<button type="button" role="gridcell" class="cal-day" data-date="${date}"
                        tabindex="${date === focusDate ? '0' : '-1'}" aria-label="${dayLabel(date)}">
                        <span class="cal-num">${Number(date.slice(8))}</span>
                      </button>`
                    : html`<div class="cal-day is-empty" role="gridcell" aria-hidden="true"></div>`,
                )}
                <div class="cal-bars" aria-hidden="true">
                  ${segs.map((sg) => {
                    const clickable = o.onEntry && (!sg.e.masked || o.mode === 'both');
                    const tag = clickable ? 'button' : 'span';
                    const label = barLabel(sg.e);
                    const title = `${label ? `${label} · ` : ''}${D.fmtRange(sg.e.start_date, sg.e.end_date)}`;
                    return html`<${raw(tag)} ${clickable ? raw('type="button" tabindex="-1"') : ''}
                        class="${barClass(sg.e)}${sg.flatL ? ' flat-l' : ''}${sg.flatR ? ' flat-r' : ''}"
                        style="grid-column:${sg.cs}/${sg.ce};grid-row:${sg.lane + 1}"
                        data-entry="${entries.indexOf(sg.e)}" title="${title}">
                        <span class="cal-bar-label">${sg.flatL && sg.ce - sg.cs < 3 ? '' : label}</span>
                      </${raw(tag)}>`;
                  })}
                </div>
              </div>`;
            })}
          </div>
        </section>`,
      ),
    );
    monthsEl.dataset.count = monthsShown;
    root.dataset.months = monthsShown;
    root.classList.remove(...[...root.classList].filter((c) => c.startsWith('p-')));
    if (o.mode === 'single' && o.propertyId) root.classList.add(`p-${o.propertyId}`);
    root.toggleAttribute('data-selectable', Boolean(o.selectable));
    $('.cal-toolbar-title', root).textContent =
      monthsShown === 1 ? D.fmtMonth(o.month) : `${D.fmtMonth(firsts[0])} – ${D.fmtMonth(firsts[1])}`;
    $('[data-nav="-1"]', root).disabled = o.month <= o.minMonth;
    $('[data-nav="1"]', root).disabled = D.addMonths(o.month, monthsShown - 1) >= o.maxMonth;
    $('[data-today]', root).hidden = t >= o.month && t < D.addMonths(o.month, monthsShown);
    mount(
      $('.cal-legend', root),
      o.legend.map((l) => html`<span class="cal-legend-item"><i class="lg ${l.cls}"></i>${l.label}</span>`),
    );
    paint();
    root._entries = entries;
  }

  // Selection, hover preview and day states, without rebuilding the DOM.
  function paint() {
    const t = D.today();
    const choosingEnd = o.selectable && sel.start && !sel.end;
    const previewEnd = choosingEnd && hoverDate && canEnd(hoverDate) ? hoverDate : null;
    const limit = choosingEnd ? maxEnd(sel.start) : null;
    for (const btn of $$('.cal-day[data-date]', monthsEl)) {
      const d = btn.dataset.date;
      const cl = btn.classList;
      cl.toggle('is-today', d === t);
      cl.toggle('is-past', d < o.minDate);
      cl.toggle('is-history', d < t);
      if (o.mode === 'single') {
        const isTaken = taken.has(d);
        cl.toggle('is-taken', isTaken);
        cl.toggle('is-turnover', isTaken && !taken.has(D.addDays(d, -1)) && d >= o.minDate);
      }
      if (!o.selectable) continue;
      const isStart = d === sel.start;
      const isEnd = d === sel.end;
      const inRange = sel.start && sel.end && d > sel.start && d < sel.end;
      const inPreview = previewEnd && d > sel.start && d < previewEnd;
      let unavailable;
      if (choosingEnd) unavailable = d !== sel.start && !(d > sel.start && d <= limit) && !canStart(d);
      else unavailable = !canStart(d);
      cl.toggle('is-start', isStart);
      cl.toggle('is-end', isEnd || d === previewEnd);
      cl.toggle('is-preview-end', d === previewEnd && !isEnd);
      cl.toggle('in-range', Boolean(inRange || inPreview));
      cl.toggle('has-end', Boolean(isStart && (sel.end || previewEnd)));
      cl.toggle('is-unavailable', Boolean(unavailable));
      cl.toggle('is-endable', Boolean(choosingEnd && d > sel.start && d <= limit));
      btn.setAttribute('aria-selected', String(Boolean(isStart || isEnd || inRange)));
      if (unavailable) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
    }
    updateHint();
  }

  function updateHint(message) {
    clearTimeout(hintTimer);
    hintEl.classList.remove('is-warn');
    if (message) {
      hintEl.textContent = message;
      hintEl.classList.add('is-warn');
      hintTimer = setTimeout(() => updateHint(), 3200);
      return;
    }
    if (!o.selectable) {
      hintEl.textContent = o.hint || '';
      return;
    }
    if (!sel.start) hintEl.textContent = 'Vælg ankomstdag';
    else if (!sel.end) hintEl.textContent = `Ankomst ${D.fmtDayMedium(sel.start)}. Vælg afrejsedag`;
    else hintEl.textContent = `${D.fmtDayMedium(sel.start)} → ${D.fmtDayMedium(sel.end)} · ${D.nightsLabel(D.diffDays(sel.start, sel.end))}`;
  }

  function shake(date) {
    const btn = $(`.cal-day[data-date="${date}"]`, monthsEl);
    if (!btn) return;
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
  }

  // ---------- interaction ----------

  function pick(date) {
    if (o.mode !== 'single' || !o.selectable) {
      o.onDay?.(date);
      return;
    }
    const s = sel.start;
    if (!s || sel.end) {
      if (!canStart(date)) return refuse(date);
      sel = { start: date, end: null };
    } else if (date === s) {
      sel = { start: null, end: null };
    } else if (date < s) {
      if (!canStart(date)) return refuse(date);
      sel = { start: date, end: null };
    } else if (canEnd(date)) {
      sel = { start: s, end: date };
    } else if (canStart(date)) {
      sel = { start: date, end: null };
    } else {
      return refuse(date);
    }
    hoverDate = null;
    paint();
    o.onSelect?.({ ...sel });
  }

  function refuse(date) {
    shake(date);
    if (date < o.minDate) updateHint('Den dag er passeret.');
    else if (date > o.maxDate) updateHint('Der kan kun bookes op til to år frem.');
    else if (sel.start && !sel.end && date > sel.start && D.diffDays(sel.start, date) > o.maxNights)
      updateHint(`Et ophold kan højst vare ${o.maxNights} nætter.`);
    else if (sel.start && !sel.end && date > sel.start) updateHint('Perioden krydser et optaget ophold. Vælg en tidligere afrejse.');
    else updateHint('Den nat er optaget. Vælg en anden ankomstdag.');
  }

  function go(delta) {
    const next = D.addMonths(o.month, delta);
    if (next < o.minMonth || D.addMonths(next, monthsShown - 1) > o.maxMonth) return false;
    o.month = next;
    focusDate = null;
    monthsEl.classList.remove('slide-l', 'slide-r');
    void monthsEl.offsetWidth;
    monthsEl.classList.add(delta > 0 ? 'slide-l' : 'slide-r');
    render();
    o.onMonthChange?.(o.month, api.visibleRange());
    return true;
  }

  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return go(Number(nav.dataset.nav));
    if (e.target.closest('[data-today]')) {
      o.month = D.startOfMonth(D.today());
      focusDate = null;
      render();
      o.onMonthChange?.(o.month, api.visibleRange());
      return;
    }
    const bar = e.target.closest('.cal-bar[data-entry]');
    if (bar && o.onEntry && bar.tagName === 'BUTTON') {
      o.onEntry(root._entries[Number(bar.dataset.entry)]);
      return;
    }
    const day = e.target.closest('.cal-day[data-date]');
    if (day) {
      focusDate = day.dataset.date;
      pick(day.dataset.date);
    }
  });

  monthsEl.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !o.selectable || !sel.start || sel.end) return;
    const day = e.target.closest('.cal-day[data-date]');
    const d = day?.dataset.date || null;
    if (d !== hoverDate) {
      hoverDate = d;
      paint();
    }
  });
  monthsEl.addEventListener('pointerleave', () => {
    if (hoverDate) {
      hoverDate = null;
      paint();
    }
  });

  // Keyboard: arrows move day, PageUp/PageDown month, Home/End week.
  monthsEl.addEventListener('keydown', (e) => {
    const day = e.target.closest('.cal-day[data-date]');
    if (!day) return;
    const d = day.dataset.date;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target = null;
    if (moves[e.key] !== undefined) target = D.addDays(d, moves[e.key]);
    else if (e.key === 'Home') target = D.addDays(d, -D.weekday(d));
    else if (e.key === 'End') target = D.addDays(d, 6 - D.weekday(d));
    else if (e.key === 'PageUp') target = D.addDays(D.addMonths(D.startOfMonth(d), -1), Number(d.slice(8)) - 1);
    else if (e.key === 'PageDown') target = D.addDays(D.addMonths(D.startOfMonth(d), 1), Number(d.slice(8)) - 1);
    if (!target) return;
    e.preventDefault();
    focusDay(target);
  });

  function focusDay(date) {
    const first = o.month;
    const endExcl = D.addMonths(first, monthsShown);
    if (date < first) {
      if (!go(-1)) return;
    } else if (date >= endExcl) {
      if (!go(1)) return;
    }
    focusDate = date;
    for (const b of $$('.cal-day[data-date]', monthsEl)) b.tabIndex = b.dataset.date === date ? 0 : -1;
    $(`.cal-day[data-date="${date}"]`, monthsEl)?.focus();
  }

  // Swipe between months on touch screens.
  let touch = null;
  monthsEl.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    { passive: true },
  );
  monthsEl.addEventListener(
    'touchend',
    (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 45 && Date.now() - touch.at < 600) go(dx < 0 ? 1 : -1);
      touch = null;
    },
    { passive: true },
  );

  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth;
    const wasTwo = lastWidth >= 700;
    if (lastWidth && wasTwo === w >= 700) return;
    lastWidth = w;
    render();
  });
  ro.observe(root);

  const api = {
    update(patch = {}) {
      Object.assign(o, patch);
      if (patch.selection) sel = { start: patch.selection.start || null, end: patch.selection.end || null };
      root.dataset.mode = o.mode;
      render();
    },
    setSelection(s) {
      sel = { start: s?.start || null, end: s?.end || null };
      if (sel.start && (sel.start < o.month || sel.start >= D.addMonths(o.month, monthsShown))) {
        o.month = D.startOfMonth(sel.start);
        render();
        o.onMonthChange?.(o.month, api.visibleRange());
      } else paint();
    },
    getSelection: () => ({ ...sel }),
    clear() {
      sel = { start: null, end: null };
      paint();
      o.onSelect?.({ ...sel });
    },
    visibleRange() {
      return { from: o.month, to: D.addMonths(o.month, Math.max(monthsShown, 1)) };
    },
    month: () => o.month,
    destroy() {
      ro.disconnect();
    },
  };
  render();
  lastWidth = root.clientWidth;
  return api;
}
