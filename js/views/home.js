import config from '../../config.js';
import { html, mount, $, $$ } from '../html.js';
import { icon } from '../icons.js';
import * as D from '../dates.js';
import { api } from '../api.js';
import { state, isAdmin, isMember, firstName, calendarEntries, cap } from '../state.js';
import { style, teaserList } from '../properties.js';
import { nowStatus, nextFreeWeekend, nextFreeWeek } from '../availability.js';
import { overviewStrip } from '../overview.js';
import { footer } from '../shell.js';
import { statusChip, errorState } from '../ui.js';
import { weather, describe } from '../weather.js';
import { openBookingSheet } from '../booking-form.js';

function propertyCard(p, info) {
  const st = style(p.id);
  const href = isMember() ? `#/bolig/${p.id}` : '#/login';
  let status = '';
  if (info) {
    const now = info.now;
    status = now.free
      ? html`<span class="pc-status is-free"><i></i>Ledig nu${now.nextStart ? html`<span class="pc-sub"> · næste ankomst ${D.fmtDay(now.nextStart)}</span>` : ''}</span>`
      : html`<span class="pc-status is-busy"><i></i>Optaget til ${D.fmtDay(now.until)}</span>`;
  }
  return html`<article class="prop-card" data-theme="${st.theme}" data-prop="${p.id}">
    <a class="prop-card-media" href="${href}" aria-label="${p.name}">
      <img src="${st.portrait}" alt="${p.name}, ${p.area}" style="object-position:${st.portraitFocus}" loading="eager" decoding="async">
      <span class="prop-card-weather" data-weather="${p.id}" hidden></span>
    </a>
    <div class="prop-card-body">
      <span class="eyebrow">${p.area}</span>
      <h2 class="prop-card-title"><a href="${href}">${p.name}</a></h2>
      <p class="prop-card-tagline">${p.tagline || ''}</p>
      ${status}
      ${info
        ? html`<div class="prop-card-picks">
            ${info.weekend ? html`<button type="button" class="pick" data-pick="${p.id}" data-start="${info.weekend.start}" data-end="${info.weekend.end}">
                <span class="tiny muted">Næste ledige weekend</span><strong>${D.fmtRange(info.weekend.start, info.weekend.end)}</strong></button>` : ''}
            ${info.week ? html`<button type="button" class="pick" data-pick="${p.id}" data-start="${info.week.start}" data-end="${info.week.end}">
                <span class="tiny muted">Næste ledige uge</span><strong>${D.fmtRange(info.week.start, info.week.end)}</strong></button>` : ''}
          </div>`
        : ''}
      <div class="prop-card-actions">
        <a class="btn btn-accent" href="${href}">${isMember() ? 'Se huset og kalender' : 'Log ind for at booke'}${icon('arrow-right')}</a>
      </div>
    </div>
  </article>`;
}

function myStayCard(b) {
  const st = style(b.property_id);
  const days = D.diffDays(D.today(), b.start_date);
  const ongoing = b.start_date <= D.today() && b.end_date > D.today();
  return html`<a class="stay-card" href="#/mine" data-theme="${st.theme}">
    <img src="${st.imageSm}" alt="" loading="lazy" style="object-position:${st.focus}">
    <div class="stay-card-body">
      <div class="row" style="--gap:8px;justify-content:space-between">
        <span class="eyebrow">${b.property_name}</span>
        ${statusChip(b.status, b.kind)}
      </div>
      <strong class="h4">${D.fmtRange(b.start_date, b.end_date)}</strong>
      <span class="small muted">${D.nightsLabel(b.nights)} · ${D.guestsLabel(b.guests || 1)}</span>
    </div>
    <div class="stay-card-count">
      ${ongoing
        ? html`<strong>Nu</strong><span>i gang</span>`
        : html`<strong>${days}</strong><span>${days === 1 ? 'dag' : 'dage'}</span>`}
    </div>
  </a>`;
}

function heroText(member, next) {
  return html`<div class="hero-text">
    <p class="eyebrow hero-eyebrow">${member ? `${D.greeting()}, ${firstName(state.me.full_name)}` : config.siteTagline}</p>
    <h1 class="display">Sol på <em>Mallorca</em>.<br>Ro på <em>Odden</em>.</h1>
    <p class="lede">${member
      ? html`To huse, én kalender. Se hvornår der er ledigt, og send en forespørgsel på et minut. ${cap(config.adminNames)} godkender.`
      : html`Familiens private side for husene på Mallorca og Sjællands Odde. Log ind for at se ledige datoer og booke.`}</p>
    <div class="btn-row hero-ctas">
      ${member
        ? html`<a class="btn btn-primary btn-lg" href="#/kalender">${icon('calendar')}Se kalender</a>
            <button class="btn btn-lg" type="button" data-request>Forespørg ophold</button>`
        : html`<a class="btn btn-primary btn-lg" href="#/login">Log ind</a>
            <span class="small muted hero-note">Har du fået et invitationslink? Åbn det for at oprette din konto.</span>`}
    </div>
    ${next
      ? html`<a class="next-stay" href="#/mine">
          <span class="next-stay-dot prop-dot ${next.property_id}"></span>
          <span>Dit næste ophold: <strong>${next.property_name}</strong> ${next.start_date <= D.today() ? 'er i gang' : D.relative(next.start_date)}${next.status === 'pending' ? ' (afventer svar)' : ''}</span>
          ${icon('arrow-right')}
        </a>`
      : ''}
  </div>`;
}

export default {
  access: 'public',
  title: () => '',
  async render(el) {
    const member = isMember();
    const props = member ? state.properties : teaserList();

    const paint = (data = {}) => {
      mount(
        el,
        html`<section class="hero">
            <div class="container hero-grid">
              ${heroText(member, data.next)}
              <div class="hero-cards" data-count="${props.length}">
                ${props.map((p) => propertyCard(p, data.info?.[p.id]))}
              </div>
            </div>
          </section>

          ${member
            ? html`${isAdmin() && state.me.pending_count
                ? html`<section class="container section-tight">
                    <a class="admin-teaser" href="#/admin">
                      <span class="admin-teaser-count">${state.me.pending_count}</span>
                      <span><strong>${state.me.pending_count === 1 ? 'En forespørgsel venter' : `${state.me.pending_count} forespørgsler venter`} på svar</strong>
                        <span class="small muted">Godkend eller afslå med ét tryk.</span></span>
                      ${icon('arrow-right')}
                    </a>
                  </section>`
                : ''}
              <section class="container section-tight">
                <div class="section-head">
                  <div>
                    <p class="eyebrow">Overblik</p>
                    <h2 class="h2">De næste tre måneder</h2>
                  </div>
                  <a class="link-arrow" href="#/kalender?vis=begge">Hele kalenderen ${icon('arrow-right')}</a>
                </div>
                <div class="card card-pad overview-card">
                  ${data.error
                    ? errorState(data.error)
                    : data.entries
                      ? html`${overviewStrip(data.entries, props)}
                          <div class="ov-legend">
                            <span><i class="lg lg-mallorca"></i>Mallorca optaget</span>
                            <span><i class="lg lg-odde"></i>Odde optaget</span>
                            <span><i class="lg lg-pending"></i>Forespurgt</span>
                          </div>`
                      : html`<div class="skeleton" style="height:120px"></div>`}
                </div>
              </section>
              <section class="container section">
                <div class="section-head">
                  <div>
                    <p class="eyebrow">Dine ophold</p>
                    <h2 class="h2">Det glæder du dig til</h2>
                  </div>
                  <a class="link-arrow" href="#/mine">Alle mine ophold ${icon('arrow-right')}</a>
                </div>
                ${data.mine
                  ? data.mine.length
                    ? html`<div class="stay-grid">${data.mine.slice(0, 3).map(myStayCard)}</div>`
                    : html`<div class="empty">
                        <div class="empty-icon">${icon('suitcase')}</div>
                        <h3>Ingen planlagte ophold endnu</h3>
                        <p>Find en ledig periode i kalenderen, og send en forespørgsel. Det tager et minut.</p>
                        <a class="btn btn-primary" href="#/kalender">${icon('calendar')}Find ledige datoer</a>
                      </div>`
                  : html`<div class="stay-grid">${[1, 2].map(() => html`<div class="skeleton" style="height:112px;border-radius:22px"></div>`)}</div>`}
              </section>`
            : html`<section class="container section how">
                <p class="eyebrow">Sådan virker det</p>
                <div class="how-grid">
                  <div class="how-step"><span class="how-num">1</span><h3 class="h4">Find ledige datoer</h3><p class="muted">Kalenderen viser, hvornår husene er ledige. Du ser ikke, hvem der bor der.</p></div>
                  <div class="how-step"><span class="how-num">2</span><h3 class="h4">Send en forespørgsel</h3><p class="muted">Vælg ankomst og afrejse, antal personer og skriv en hilsen.</p></div>
                  <div class="how-step"><span class="how-num">3</span><h3 class="h4">${cap(config.adminNames)} svarer</h3><p class="muted">Når opholdet er godkendt, får du adresse, praktisk info og Wi-Fi.</p></div>
                </div>
              </section>`}
          ${footer()}`,
      );
      bind(data);
    };

    const bind = (data) => {
      $('[data-request]', el)?.addEventListener('click', () => openBookingSheet({ onDone: load }));
      for (const b of $$('[data-pick]', el)) {
        b.addEventListener('click', () =>
          openBookingSheet({ propertyId: b.dataset.pick, start: b.dataset.start, end: b.dataset.end, onDone: load }),
        );
      }
      $('[data-retry]', el)?.addEventListener('click', load);
      if (member) {
        for (const p of props) {
          weather(p).then((w) => {
            const slot = el.querySelector(`[data-weather="${p.id}"]`);
            if (!w || !slot) return;
            const d = describe(w.code);
            mount(slot, html`${icon(d.icon)}<span>${w.temp}°</span>`);
            slot.title = `${d.text}, ${w.temp}° i ${p.name} lige nu`;
            slot.hidden = false;
          });
        }
      }
    };

    const load = async () => {
      if (!member) return paint();
      try {
        const from = D.addMonths(D.startOfMonth(D.today()), -2);
        const [entries, mine] = await Promise.all([calendarEntries(from, D.addMonths(from, 18)), api.myBookings()]);
        const upcoming = mine
          .filter((b) => (b.status === 'approved' || b.status === 'pending') && b.end_date > D.today())
          .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
        const info = {};
        for (const p of props) {
          info[p.id] = {
            now: nowStatus(entries, p.id),
            weekend: nextFreeWeekend(entries, p.id),
            week: nextFreeWeek(entries, p.id),
          };
        }
        paint({ entries, mine: upcoming, info, next: upcoming[0] || null });
      } catch (error) {
        paint({ error, mine: [] });
      }
    };

    paint();
    await load();
  },
};
