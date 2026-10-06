import { html, mount, $ } from '../html.js';
import { icon } from '../icons.js';
import * as D from '../dates.js';
import { state, isAdmin, calendarEntries } from '../state.js';
import { style } from '../properties.js';
import { createCalendar } from '../calendar.js';
import { takenNights } from '../availability.js';
import { agenda } from '../agenda.js';
import { openBookingSheet } from '../booking-form.js';
import { openBookingDetail } from '../booking-detail.js';
import { selectionBar, selectionBarTemplate } from '../selection-bar.js';
import { legendFor } from './property.js';
import { errorState, segmented, openSheet } from '../ui.js';
import { navigate } from '../router.js';

const KEY = 'kolind:calendar-view';

function readMode(query) {
  if (query.vis === 'begge') return 'both';
  if (query.bolig && state.byId[query.bolig]) return query.bolig;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'both' || state.byId[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  return state.properties[0]?.id || 'both';
}

export default {
  access: 'member',
  title: () => 'Kalender',
  async render(el, r) {
    const admin = isAdmin();
    let mode = readMode(r.query);
    let entries = [];
    let cal = null;
    let selection = { start: null, end: null };

    mount(
      el,
      html`<div class="page calendar-page">
        <div class="container">
          <header class="page-head cal-page-head">
            <div>
              <p class="eyebrow">Kalender</p>
              <h1 class="h1">Hvornår er der <em>ledigt</em>?</h1>
            </div>
            <div class="segmented" data-mode-switch role="group" aria-label="Vælg bolig">
              ${state.properties.map(
                (p) => html`<button type="button" data-value="${p.id}" aria-pressed="${mode === p.id}"><span class="seg-dot prop-dot ${p.id}"></span>${p.name}</button>`,
              )}
              <button type="button" data-value="both" aria-pressed="${mode === 'both'}">Begge</button>
            </div>
          </header>
          <p class="cal-intro muted"></p>
          <div class="card cal-card"><div class="cal-host"><div class="skeleton" style="height:440px"></div></div></div>
          <div class="agenda-host"></div>
        </div>
        ${selectionBarTemplate()}
      </div>`,
    );

    const bar = selectionBar($('.selection-bar', el), state.byId[mode]);
    const intro = $('.cal-intro', el);

    const applyTheme = () => {
      if (mode === 'both') el.removeAttribute('data-theme');
      else el.dataset.theme = style(mode).theme;
      intro.textContent =
        mode === 'both'
          ? 'Begge huse i samme kalender. Tryk på en dag for at se, hvad der er ledigt.'
          : admin
            ? 'Vælg ankomst og afrejse for at booke eller blokere. Tryk på et ophold for detaljer.'
            : 'Vælg ankomst og afrejse. Afrejsedagen kan være en andens ankomstdag.';
    };

    const renderAgenda = () => {
      if (!cal) return;
      const range = cal.visibleRange();
      mount(
        $('.agenda-host', el),
        html`<h2 class="h4 agenda-title">I ${D.MONTHS[D.parts(range.from).m - 1]}${D.diffDays(range.from, range.to) > 31 ? ` og ${D.MONTHS[D.parts(D.addMonths(range.from, 1)).m - 1]}` : ''}</h2>
          ${agenda(entries, { ...range, propertyIds: mode === 'both' ? state.properties.map((p) => p.id) : [mode] })}`,
      );
    };

    const dayInfo = (date) => {
      const rows = state.properties.map((p) => {
        const taken = takenNights(entries, p.id);
        const pending = entries.some((e) => e.property_id === p.id && e.status === 'pending' && e.start_date <= date && e.end_date > date);
        return { p, free: !taken.has(date) && date >= D.today(), past: date < D.today(), taken: taken.has(date), pending };
      });
      const sheet = openSheet({
        title: D.fmtDayLong(date, { year: true }).replace(/^./, (c) => c.toUpperCase()),
        body: html`<ul class="day-info">
          ${rows.map(
            (x) => html`<li class="p-${x.p.id}">
              <span class="prop-dot ${x.p.id}"></span>
              <span class="day-info-name"><strong>${x.p.name}</strong><span class="small muted">${x.past ? 'Passeret' : x.taken ? 'Optaget denne nat' : x.pending ? 'Ledig, men der er en forespørgsel' : 'Ledig'}</span></span>
              ${x.free ? html`<button type="button" class="btn btn-sm btn-accent" data-book="${x.p.id}" style="--accent:var(--prop);--accent-2:var(--prop-2)">Book</button>` : ''}
            </li>`,
          )}
        </ul>`,
      });
      sheet.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-book]');
        if (!b) return;
        sheet.close();
        switchMode(b.dataset.book);
        selection = { start: date, end: null };
        cal.setSelection(selection);
        bar.update(selection);
      });
    };

    const mountCalendar = () => {
      const host = $('.cal-host', el);
      const month = cal?.month();
      cal?.destroy();
      host.innerHTML = '';
      cal = createCalendar(host, {
        mode: mode === 'both' ? 'both' : 'single',
        propertyId: mode === 'both' ? null : mode,
        propertyIds: state.properties.map((p) => p.id),
        entries,
        month,
        selectable: mode !== 'both',
        selection,
        minDate: admin ? D.addDays(D.today(), -365) : D.today(),
        minMonth: D.addMonths(D.startOfMonth(D.today()), admin ? -12 : -1),
        maxNights: admin ? 120 : 60,
        legend:
          mode === 'both'
            ? [...state.properties.map((p) => ({ cls: `lg-${p.id}`, label: p.name })), { cls: 'lg-pending', label: 'Forespurgt' }]
            : legendFor(admin),
        onSelect: (s) => {
          selection = s;
          bar.update(selection);
        },
        onMonthChange: renderAgenda,
        onDay: dayInfo,
        onEntry: (e) => {
          if (admin && e.id) openBookingDetail(e.id, { onChange: () => load(true) });
          else if (e.is_mine) navigate('/mine');
        },
      });
      renderAgenda();
    };

    const switchMode = (m) => {
      mode = m;
      try {
        localStorage.setItem(KEY, m);
      } catch {
        /* storage unavailable */
      }
      selection = { start: null, end: null };
      bar.update(selection);
      bar.setProperty(state.byId[m]);
      $$pressed(m);
      applyTheme();
      mountCalendar();
    };

    const $$pressed = (m) => {
      for (const b of el.querySelectorAll('[data-mode-switch] button')) b.setAttribute('aria-pressed', String(b.dataset.value === m));
      seg.place();
    };

    const seg = segmented($('[data-mode-switch]', el), switchMode);
    bar.onClear(() => cal?.clear());
    bar.onContinue(() =>
      openBookingSheet({
        propertyId: mode,
        start: selection.start,
        end: selection.end,
        onDone: async () => {
          selection = { start: null, end: null };
          bar.update(selection);
          await load(true);
        },
      }),
    );

    $('.agenda-host', el).addEventListener('click', (e) => {
      const item = e.target.closest('[data-entry-id]');
      if (!item) return;
      if (admin && item.dataset.entryId) openBookingDetail(item.dataset.entryId, { onChange: () => load(true) });
      else if (item.dataset.mine) navigate('/mine');
    });

    const load = async (force = false) => {
      try {
        const from = D.addMonths(D.startOfMonth(D.today()), admin ? -12 : -1);
        entries = await calendarEntries(from, D.addMonths(D.startOfMonth(D.today()), 18), { force });
      } catch (err) {
        mount($('.cal-host', el), errorState(err));
        $('[data-retry]', el)?.addEventListener('click', () => load(true));
        return;
      }
      if (!cal) mountCalendar();
      else {
        cal.update({ entries });
        renderAgenda();
      }
    };

    applyTheme();
    await load();
    return () => {
      cal?.destroy();
      bar.destroy();
    };
  },
};
