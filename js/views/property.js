import config from '../../config.js';
import { html, mount, $, $$, paragraphs, lines } from '../html.js';
import { icon } from '../icons.js';
import * as D from '../dates.js';
import { api } from '../api.js';
import { state, isAdmin, property, calendarEntries, cap } from '../state.js';
import { style, mapsUrl } from '../properties.js';
import { createCalendar } from '../calendar.js';
import { nowStatus, nextFreeWeekend, nextFreeWeek } from '../availability.js';
import { agenda } from '../agenda.js';
import { openBookingSheet } from '../booking-form.js';
import { openBookingDetail } from '../booking-detail.js';
import { footer } from '../shell.js';
import { copyText, errorState, emptyState } from '../ui.js';
import { weather, describe } from '../weather.js';
import { navigate } from '../router.js';
import { loadPhotos, photoStrip, bindPhotoStrip, openSlideshow } from '../gallery.js';
import { selectionBar, selectionBarTemplate } from '../selection-bar.js';

export function legendFor(admin) {
  return admin
    ? [
        { cls: 'lg-stay', label: 'Ophold' },
        { cls: 'lg-owner', label: 'Egen ferie' },
        { cls: 'lg-blocked', label: 'Lukket' },
        { cls: 'lg-pending', label: 'Afventer' },
      ]
    : [
        { cls: 'lg-mine', label: 'Dit ophold' },
        { cls: 'lg-busy', label: 'Optaget' },
        { cls: 'lg-pending', label: 'Forespurgt' },
      ];
}

function infoBlock(title, ic, body) {
  if (!body) return '';
  return html`<div class="info-block">
    <div class="info-block-icon">${icon(ic)}</div>
    <div><h3 class="h4">${title}</h3><div class="info-block-body">${body}</div></div>
  </div>`;
}

function rulesList(text) {
  if (!text) return '';
  return html`<ul class="rules">${text.split('\n').filter((l) => l.trim()).map((l) => html`<li>${icon('check')}<span>${l}</span></li>`)}</ul>`;
}

export default {
  access: 'member',
  title: (r) => property(r.params.id)?.name || 'Bolig',
  async render(el, r) {
    const p = property(r.params.id);
    if (!p) {
      mount(el, html`<div class="state-page"><div class="inner">${emptyState({ icon: 'home', title: 'Boligen findes ikke', action: html`<a class="btn btn-primary" href="#/">Til forsiden</a>` })}</div></div>`);
      return;
    }
    const st = style(p.id);
    const admin = isAdmin();
    const other = state.properties.find((x) => x.id !== p.id);
    el.dataset.theme = st.theme;
    let cal = null;
    let entries = [];
    let selection = { start: null, end: null };

    mount(
      el,
      html`<div class="page property-page">
        <div class="container">
          <div class="prop-top">
            <a class="back-link" href="#/">${icon('arrow-left')}Husene</a>
            ${other ? html`<a class="back-link" href="#/bolig/${other.id}">Se ${other.name}${icon('arrow-right')}</a>` : ''}
          </div>
          <header class="prop-head">
            <p class="eyebrow">${p.area}</p>
            <h1 class="display prop-title">${p.name}</h1>
            ${p.tagline ? html`<p class="lede">${p.tagline}</p>` : ''}
          </header>
          <figure class="prop-hero">
            <img src="${st.image}" alt="${p.name}" style="object-position:${st.focus}" fetchpriority="high">
            <figcaption class="prop-hero-chips">
              <span class="hero-chip" data-now></span>
              <span class="hero-chip" data-weather hidden></span>
            </figcaption>
            <button type="button" class="hero-chip hero-photos" data-open-photos hidden>${icon('image')}<span></span></button>
          </figure>
          <div class="prop-gallery" data-gallery></div>

          <div class="prop-layout">
            <div class="prop-main">
              <dl class="facts">
                <div><dt>${icon('door')}Ankomst</dt><dd>fra kl. ${p.check_in_time}</dd></div>
                <div><dt>${icon('clock')}Afrejse</dt><dd>senest kl. ${p.check_out_time}</dd></div>
                <div><dt>${icon('users')}Plads til</dt><dd>${D.guestsLabel(p.max_guests)}</dd></div>
              </dl>

              <section class="prop-section" id="ledighed" aria-labelledby="cal-h">
                <div class="section-head">
                  <div>
                    <p class="eyebrow">Kalender</p>
                    <h2 class="h2" id="cal-h">Hvornår er der ledigt?</h2>
                  </div>
                </div>
                <div class="card cal-card"><div class="cal-host"><div class="skeleton" style="height:420px"></div></div></div>
                <div class="agenda-host"></div>
              </section>

              ${p.description
                ? html`<section class="prop-section">
                    <p class="eyebrow">Om huset</p>
                    <div class="prose prose-lg">${paragraphs(p.description)}</div>
                  </section>`
                : ''}

              <section class="prop-section">
                <p class="eyebrow">Praktisk</p>
                <div class="info-grid">
                  ${infoBlock('Adresse', 'pin', p.address ? html`<p>${lines(p.address)}</p><a class="link-arrow" href="${mapsUrl(p.address)}" target="_blank" rel="noopener">Åbn i Google Maps ${icon('external')}</a>` : '')}
                  ${infoBlock('Ankomst og nøgle', 'key', p.arrival_info ? html`<p>${lines(p.arrival_info)}</p>` : '')}
                  ${infoBlock('Godt at vide', 'info', p.practical_info ? html`<p>${lines(p.practical_info)}</p>` : '')}
                  ${infoBlock('Kontakt', 'phone', p.contact_name || p.contact_phone
                    ? html`<p>${p.contact_name || ''}</p>${p.contact_phone ? html`<a class="link-arrow" href="tel:${p.contact_phone.replace(/\s/g, '')}">${p.contact_phone}</a>` : ''}`
                    : '')}
                </div>
              </section>

              <section class="prop-section access-section" data-access></section>

              ${p.house_rules
                ? html`<section class="prop-section">
                    <p class="eyebrow">Husregler</p>
                    ${rulesList(p.house_rules)}
                  </section>`
                : ''}

              <section class="prop-section" data-weather-section hidden></section>

              ${admin ? html`<p class="small muted"><a class="link-arrow" href="#/admin/boliger?id=${p.id}">${icon('edit')}Ret oplysningerne om ${p.name}</a></p>` : ''}
            </div>

            <aside class="prop-aside">
              <div class="card card-pad aside-card">
                <p class="eyebrow">Book ${p.name}</p>
                <h2 class="h3">Find et ophold</h2>
                <div class="aside-picks" data-picks><div class="skeleton" style="height:120px"></div></div>
                <button type="button" class="btn btn-accent btn-block" data-open-sheet>${icon('calendar')}Vælg datoer</button>
                <p class="tiny muted">${admin ? 'Som administrator booker du direkte.' : `${cap(config.adminNames)} godkender forespørgsler.`}</p>
              </div>
            </aside>
          </div>
        </div>

        ${selectionBarTemplate()}
      </div>
      ${footer()}`,
    );

    const bar = selectionBar($('.selection-bar', el), p);
    const refreshBar = () => bar.update(selection);

    const openSheet = (s = selection) =>
      openBookingSheet({
        propertyId: p.id,
        start: s.start,
        end: s.end,
        onDone: async () => {
          selection = { start: null, end: null };
          cal?.setSelection(selection);
          refreshBar();
          await load(true);
        },
      });

    bar.onClear(() => cal?.clear());
    bar.onContinue(() => openSheet());
    $('[data-open-sheet]', el).addEventListener('click', () => {
      if (selection.start && selection.end) return openSheet();
      $('#ledighed', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const renderAgenda = () => {
      if (!cal) return;
      const range = cal.visibleRange();
      mount($('.agenda-host', el), agenda(entries, { ...range, propertyIds: [p.id] }));
    };

    $('.agenda-host', el).addEventListener('click', (e) => {
      const item = e.target.closest('[data-entry-id]');
      if (!item) return;
      if (admin && item.dataset.entryId) openBookingDetail(item.dataset.entryId, { onChange: () => load(true) });
      else if (item.dataset.mine) navigate('/mine');
    });

    // Gallery: the main photo first, then the uploaded ones (members only).
    loadPhotos(p.id)
      .then((list) => {
        if (!list.length || !el.isConnected) return;
        const slides = [{ full: st.image, thumb: st.imageSm, alt: p.name }, ...list.map((x) => ({ ...x, alt: p.name }))];
        const host = $('[data-gallery]', el);
        mount(host, photoStrip(slides));
        bindPhotoStrip(host, slides);
        const btn = $('[data-open-photos]', el);
        mount($('span', btn), html`<span class="photos-long">Se alle ${slides.length} billeder</span><span class="photos-short">${slides.length}</span>`);
        btn.setAttribute('aria-label', `Se alle ${slides.length} billeder`);
        btn.hidden = false;
        btn.addEventListener('click', () => openSlideshow(slides, 0));
        const hero = $('.prop-hero img', el);
        hero.classList.add('is-clickable');
        hero.addEventListener('click', () => openSlideshow(slides, 0));
      })
      .catch(() => {});

    const load = async (force = false) => {
      try {
        const from = D.addMonths(D.startOfMonth(D.today()), admin ? -12 : -1);
        entries = await calendarEntries(from, D.addMonths(D.startOfMonth(D.today()), 18), { force });
      } catch (err) {
        mount($('.cal-host', el), errorState(err));
        $('[data-retry]', el)?.addEventListener('click', () => load(true));
        return;
      }
      const now = nowStatus(entries, p.id);
      mount(
        $('[data-now]', el),
        now.free ? html`<i class="dot-free"></i>Ledig nu` : html`<i class="dot-busy"></i>Optaget til ${D.fmtDay(now.until)}`,
      );
      const weekend = nextFreeWeekend(entries, p.id);
      const week = nextFreeWeek(entries, p.id);
      mount(
        $('[data-picks]', el),
        html`${weekend ? html`<button type="button" class="pick" data-start="${weekend.start}" data-end="${weekend.end}"><span class="tiny muted">Næste ledige weekend</span><strong>${D.fmtRange(weekend.start, weekend.end)}</strong>${icon('arrow-right')}</button>` : ''}
          ${week ? html`<button type="button" class="pick" data-start="${week.start}" data-end="${week.end}"><span class="tiny muted">Næste ledige uge</span><strong>${D.fmtRange(week.start, week.end)}</strong>${icon('arrow-right')}</button>` : ''}`,
      );
      for (const b of $$('.pick', $('[data-picks]', el))) {
        b.addEventListener('click', () => {
          selection = { start: b.dataset.start, end: b.dataset.end };
          cal?.setSelection(selection);
          refreshBar();
          openSheet(selection);
        });
      }

      const host = $('.cal-host', el);
      if (!cal) {
        host.innerHTML = '';
        cal = createCalendar(host, {
          mode: 'single',
          propertyId: p.id,
          entries,
          selectable: true,
          minDate: admin ? D.addDays(D.today(), -365) : D.today(),
          minMonth: D.addMonths(D.startOfMonth(D.today()), admin ? -12 : 0),
          maxNights: admin ? 120 : 60,
          legend: legendFor(admin),
          onSelect: (s) => {
            selection = s;
            refreshBar();
          },
          onMonthChange: renderAgenda,
          onEntry: (e) => {
            if (admin && e.id) openBookingDetail(e.id, { onChange: () => load(true) });
            else if (e.is_mine) navigate('/mine');
          },
        });
      } else {
        cal.update({ entries });
      }
      renderAgenda();
    };

    const loadAccess = async () => {
      const sec = $('[data-access]', el);
      if (!p.has_access) {
        mount(
          sec,
          html`<p class="eyebrow">Wi-Fi og adgang</p>
            <div class="locked">${icon('lock')}<div><strong>Vises, når du har et godkendt ophold</strong>
              <p class="small muted">Wi-Fi-kode og adgangsoplysninger deles kun med dem, der skal bo i huset.</p></div></div>`,
        );
        return;
      }
      try {
        const a = await api.propertyAccess(p.id);
        if (!a || (!a.wifi_name && !a.wifi_password && !a.access_info)) {
          mount(sec, admin ? html`<p class="eyebrow">Wi-Fi og adgang</p><p class="small muted">Ikke udfyldt endnu. <a href="#/admin/boliger?id=${p.id}">Tilføj Wi-Fi og adgang</a>.</p>` : '');
          return;
        }
        mount(
          sec,
          html`<p class="eyebrow">Wi-Fi og adgang</p>
            <div class="access-card">
              ${a.wifi_name ? html`<div class="access-row"><span class="label">Netværk</span><strong>${a.wifi_name}</strong></div>` : ''}
              ${a.wifi_password
                ? html`<div class="access-row"><span class="label">Kode</span><strong class="mono">${a.wifi_password}</strong>
                    <button type="button" class="btn btn-sm" data-copy="${a.wifi_password}">${icon('copy')}Kopiér</button></div>`
                : ''}
              ${a.access_info ? html`<div class="access-row access-note"><span class="label">Adgang</span><p>${lines(a.access_info)}</p></div>` : ''}
            </div>`,
        );
        $('[data-copy]', sec)?.addEventListener('click', (e) => copyText(e.currentTarget.dataset.copy));
      } catch {
        sec.innerHTML = '';
      }
    };

    const loadWeather = async () => {
      const w = await weather(p);
      if (!w) return;
      const d = describe(w.code);
      const chip = $('[data-weather]', el);
      if (chip) {
        mount(chip, html`${icon(d.icon)}${w.temp}° ${d.text.toLowerCase()}`);
        chip.hidden = false;
      }
      const sec = $('[data-weather-section]', el);
      if (!sec) return;
      mount(
        sec,
        html`<p class="eyebrow">Vejret i ${p.name} de næste dage</p>
          <div class="forecast">
            ${w.days.map((day, i) => {
              const dd = describe(day.code);
              return html`<div class="forecast-day"><span class="small muted">${i === 0 ? 'I dag' : D.WEEKDAYS_SHORT[D.weekday(day.date)]}</span>${icon(dd.icon)}<strong>${day.max}°</strong><span class="small muted">${day.min}°</span></div>`;
            })}
          </div>`,
      );
      sec.hidden = false;
    };

    await load();
    loadAccess();
    loadWeather();
    if (r.query.fra && r.query.til && D.isValid(r.query.fra) && D.isValid(r.query.til)) {
      selection = { start: r.query.fra, end: r.query.til };
      cal?.setSelection(selection);
      refreshBar();
    }

    return () => {
      cal?.destroy();
      bar.destroy();
    };
  },
};
