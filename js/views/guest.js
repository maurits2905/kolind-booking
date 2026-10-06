// Pages for friends without an account: a guest link (#/gaest/<token>) and the
// status of a request (#/status/<token>). Everything goes through token-checked
// database functions; guests never see who else is staying.

import config from '../../config.js';
import { cap } from '../state.js';
import { html, mount, $, $$, lines } from '../html.js';
import { icon } from '../icons.js';
import * as D from '../dates.js';
import { links } from '../api.js';
import { style, mapsUrl } from '../properties.js';
import { createCalendar } from '../calendar.js';
import { stepper, bindStepper } from '../booking-form.js';
import { busy, errorState, copyText, appUrl, nextId, confirmDialog, toast, toastError, statusChip } from '../ui.js';
import { downloadIcs, googleCalendarUrl } from '../ics.js';
import { navigate } from '../router.js';

const STORE = 'kolind:guest-requests';

function saved() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]');
  } catch {
    return [];
  }
}
function remember(item) {
  try {
    const list = saved().filter((x) => x.token !== item.token);
    list.unshift(item);
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* storage unavailable */
  }
}

function stateCard(ic, title, text, action = '') {
  return html`<div class="state-page"><div class="inner">
    <div class="empty-icon">${icon(ic)}</div>
    <h1 class="h2">${title}</h1>
    <p class="muted">${text}</p>
    ${action}
  </div></div>`;
}

export const guestRequest = {
  access: 'public',
  chrome: 'guest',
  title: () => 'Forespørg ophold',
  async render(el, r) {
    const token = r.params.token;
    mount(el, html`<div class="page"><div class="container container-narrow"><div class="skeleton sk-title"></div><div class="skeleton" style="height:360px;margin-top:20px"></div></div></div>`);
    let info;
    try {
      info = await links.guestLink(token);
    } catch (err) {
      if (err.unreachable) {
        mount(el, html`<div class="state-page"><div class="inner">${errorState(err)}</div></div>`);
        $('[data-retry]', el)?.addEventListener('click', () => guestRequest.render(el, r));
      } else {
        mount(el, stateCard('link', 'Linket virker ikke', err.message));
      }
      return;
    }

    const props = info.properties;
    let pid = props.length === 1 ? props[0].id : null;
    let sel = { start: null, end: null };
    let entries = [];
    let cal = null;
    const mine = saved().filter((x) => x.link === token);

    mount(
      el,
      html`<div class="page guest-page">
        <div class="container container-narrow">
          <header class="page-head">
            <p class="eyebrow">Invitation fra ${info.inviter_name || 'familien'}</p>
            <h1 class="h1">Hej <em>${info.label}</em></h1>
            <p class="lede">${info.inviter_name || 'Familien'} har sendt jer dette link, så I kan se, hvornår ${props.length > 1 ? 'husene er' : 'huset er'} ledigt, og sende en forespørgsel. ${config.adminNames} ejer husene og svarer hurtigst muligt.</p>
          </header>

          ${mine.length
            ? html`<section class="guest-mine card card-pad">
                <h2 class="h4">Jeres forespørgsler</h2>
                <ul class="mini-list">${mine.map((m) => html`<li><a href="#/status/${m.token}">${m.property} · ${D.fmtRange(m.start, m.end)}</a>${icon('chevron-right')}</li>`)}</ul>
              </section>`
            : ''}

          ${info.remaining === 0
            ? html`<div class="notice notice-warn">${icon('info')}<span>Linket er brugt det maksimale antal gange. Bed ${info.inviter_name || 'familien'} om et nyt, hvis I vil forespørge igen.</span></div>`
            : html`<section class="guest-step">
                <h2 class="h3"><span class="step-num">1</span>${props.length > 1 ? 'Vælg hus' : props[0].name}</h2>
                <div class="guest-props" data-count="${props.length}">
                  ${props.map((p) => {
                    const st = style(p.id);
                    return html`<button type="button" class="guest-prop" data-theme="${st.theme}" data-pick-prop="${p.id}" aria-pressed="${p.id === pid}">
                      <img src="${st.imageSm}" alt="" style="object-position:${st.focus}">
                      <span class="guest-prop-text"><span class="eyebrow">${p.area}</span><strong class="h4">${p.name}</strong><span class="small muted">${p.tagline || ''}</span>
                      <span class="tiny muted">Plads til ${p.max_guests} · ankomst fra ${p.check_in_time} · afrejse inden ${p.check_out_time}</span></span>
                    </button>`;
                  })}
                </div>
              </section>
              <section class="guest-step" data-step-dates ${pid ? '' : 'hidden'}>
                <h2 class="h3"><span class="step-num">2</span>Vælg datoer</h2>
                <p class="small muted">Grå felter er optaget. Afrejsedagen kan godt være en andens ankomstdag.</p>
                <div class="card cal-card"><div class="cal-host"></div></div>
              </section>
              <section class="guest-step" data-step-form hidden>
                <h2 class="h3"><span class="step-num">3</span>Om jer</h2>
                <form class="card card-pad guest-form" novalidate></form>
              </section>`}
        </div>
      </div>`,
    );

    const form = $('.guest-form', el);

    const renderForm = () => {
      if (!form) return;
      const p = props.find((x) => x.id === pid);
      const ids = { name: nextId('n'), email: nextId('e'), phone: nextId('p'), comment: nextId('c') };
      const prev = {
        name: form.elements.name?.value || '',
        email: form.elements.email?.value || '',
        phone: form.elements.phone?.value || '',
        comment: form.elements.comment?.value || '',
      };
      mount(
        form,
        html`<div class="guest-summary">
            <strong>${p.name}</strong>
            <span>${D.fmtDayMedium(sel.start)} → ${D.fmtDayMedium(sel.end)} · ${D.nightsLabel(D.diffDays(sel.start, sel.end))}</span>
          </div>
          <div class="field"><label class="label" for="${ids.name}">Jeres navn</label><input class="input" id="${ids.name}" name="name" value="${prev.name}" autocomplete="name" maxlength="80" required></div>
          <div class="field-row">
            <div class="field"><label class="label" for="${ids.email}">Email</label><input class="input" id="${ids.email}" name="email" type="email" value="${prev.email}" autocomplete="email" maxlength="120" required><span class="hint">Så ${config.adminNames} kan svare jer.</span></div>
            <div class="field"><label class="label" for="${ids.phone}">Telefon <span class="muted">(valgfri)</span></label><input class="input" id="${ids.phone}" name="phone" type="tel" value="${prev.phone}" autocomplete="tel" maxlength="30"></div>
          </div>
          <div class="field field-inline"><span class="label">Antal personer</span>${stepper('guests', Math.min(2, p.max_guests), 1, p.max_guests, 'Antal personer')}</div>
          <div class="field"><label class="label" for="${ids.comment}">Hilsen <span class="muted">(valgfri)</span></label><textarea class="textarea" id="${ids.comment}" name="comment" rows="3" maxlength="1000" placeholder="Fx hvem I er, og hvad I glæder jer til">${prev.comment}</textarea></div>
          <div class="form-error" role="alert"></div>
          <button type="submit" class="btn btn-accent btn-lg btn-block">Send forespørgsel</button>
          <p class="tiny muted" style="text-align:center">Jeres oplysninger ses kun af ${config.adminNames}.</p>`,
      );
      bindStepper(form);
    };

    const showDates = async () => {
      const section = $('[data-step-dates]', el);
      section.hidden = false;
      el.dataset.theme = style(pid).theme;
      const host = $('.cal-host', el);
      if (!entries.length) {
        mount(host, html`<div class="skeleton" style="height:380px"></div>`);
        try {
          const from = D.startOfMonth(D.today());
          entries = await links.guestCalendar(token, from, D.addMonths(from, 18));
        } catch (err) {
          mount(host, errorState(err));
          $('[data-retry]', host)?.addEventListener('click', showDates);
          return;
        }
      }
      host.innerHTML = '';
      cal?.destroy();
      sel = { start: null, end: null };
      $('[data-step-form]', el).hidden = true;
      cal = createCalendar(host, {
        mode: 'single',
        propertyId: pid,
        entries,
        selectable: true,
        minMonth: D.startOfMonth(D.today()),
        maxMonth: D.addMonths(D.startOfMonth(D.today()), 17),
        legend: [
          { cls: 'lg-busy', label: 'Optaget' },
          { cls: 'lg-pending', label: 'Forespurgt' },
        ],
        onSelect: (s) => {
          sel = s;
          const step = $('[data-step-form]', el);
          if (s.start && s.end) {
            step.hidden = false;
            renderForm();
            step.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            step.hidden = true;
          }
        },
      });
    };

    for (const b of $$('[data-pick-prop]', el)) {
      b.addEventListener('click', () => {
        pid = b.dataset.pickProp;
        $$('[data-pick-prop]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        showDates();
        $('[data-step-dates]', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (pid && info.remaining > 0) showDates();

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      const name = form.elements.name.value.trim();
      const email = form.elements.email.value.trim();
      if (!name || !email) {
        err.textContent = 'Skriv jeres navn og email.';
        return;
      }
      try {
        const res = await busy(form.querySelector('[type="submit"]'), () =>
          links.guestRequest(token, {
            propertyId: pid,
            start: sel.start,
            end: sel.end,
            guests: Number(form.querySelector('output[name="guests"]').textContent),
            name,
            email,
            phone: form.elements.phone.value,
            comment: form.elements.comment.value,
          }),
        );
        const p = props.find((x) => x.id === pid);
        remember({ token: res.status_token, link: token, property: p.name, start: sel.start, end: sel.end });
        navigate(`/status/${res.status_token}?ny=1`);
      } catch (ex) {
        err.textContent = ex.message;
      }
    });

    return () => cal?.destroy();
  },
};

export const guestStatus = {
  access: 'public',
  chrome: 'guest',
  title: () => 'Jeres forespørgsel',
  async render(el, r) {
    const token = r.params.token;
    mount(el, html`<div class="page"><div class="container container-narrow"><div class="skeleton" style="height:420px;border-radius:26px"></div></div></div>`);
    let s;
    try {
      s = await links.guestStatus(token);
    } catch (err) {
      mount(el, html`<div class="state-page"><div class="inner">${errorState(err)}</div></div>`);
      $('[data-retry]', el)?.addEventListener('click', () => guestStatus.render(el, r));
      return;
    }
    if (!s) {
      mount(el, stateCard('link', 'Forespørgslen findes ikke', 'Linket er forkert, eller forespørgslen er slettet.'));
      return;
    }
    const st = style(s.property_id);
    el.dataset.theme = st.theme;
    const statusLink = appUrl(`/status/${token}`);
    const d = s.details;
    const headline = {
      pending: 'Forespørgslen er sendt',
      approved: 'Godkendt. God tur!',
      rejected: 'Desværre ikke denne gang',
      cancelled: 'Forespørgslen er annulleret',
    }[s.status];
    const booking = { id: token.slice(0, 12), property_id: s.property_id, property_name: s.property_name, start_date: s.start_date, end_date: s.end_date, guests: s.guests };
    const propForIcs = { name: s.property_name, address: d?.address, check_in_time: s.check_in_time, check_out_time: s.check_out_time };

    mount(
      el,
      html`<div class="page guest-page">
        <div class="container container-narrow">
          ${r.query.ny
            ? html`<div class="notice notice-ok guest-saved">${icon('check')}<span><strong>Tak! Forespørgslen er sendt.</strong> Gem linket til denne side, så kan I følge svaret. Det er også gemt i denne browser.</span></div>`
            : ''}
          <article class="status-card card">
            <div class="status-media"><img src="${st.image}" alt="" style="object-position:${st.focus}"></div>
            <div class="card-pad">
              <div class="row row-wrap" style="--gap:10px;justify-content:space-between">
                <span class="eyebrow">${s.area}</span>
                ${statusChip(s.status)}
              </div>
              <h1 class="h1">${headline}</h1>
              <p class="lede">${s.person_name}, ${s.property_name} · ${D.fmtRange(s.start_date, s.end_date)} · ${D.nightsLabel(s.nights)} · ${D.guestsLabel(s.guests)}</p>
              ${s.status === 'pending' ? html`<p class="muted" style="margin-top:12px">${cap(config.adminNames)} har fået jeres forespørgsel og svarer her. Kig forbi igen senere.</p>` : ''}
              ${s.decision_note ? html`<blockquote class="quote quote-reply" style="margin-top:16px"><cite>${cap(config.adminNames)}</cite>${s.decision_note}</blockquote>` : ''}
              <div class="copy-field" style="margin-top:20px"><code>${statusLink}</code><button type="button" class="btn btn-sm" data-copy>${icon('copy')}Kopiér link</button></div>
            </div>
          </article>

          ${d
            ? html`<section class="prop-section">
                <p class="eyebrow">Det praktiske</p>
                <div class="info-grid">
                  ${d.address ? html`<div class="info-block"><div class="info-block-icon">${icon('pin')}</div><div><h3 class="h4">Adresse</h3><div class="info-block-body"><p>${lines(d.address)}</p><a class="link-arrow" href="${mapsUrl(d.address)}" target="_blank" rel="noopener">Åbn i Google Maps ${icon('external')}</a></div></div></div>` : ''}
                  <div class="info-block"><div class="info-block-icon">${icon('door')}</div><div><h3 class="h4">Tider</h3><div class="info-block-body"><p>Ankomst ${D.fmtDayMedium(s.start_date)} fra kl. ${s.check_in_time}<br>Afrejse ${D.fmtDayMedium(s.end_date)} senest kl. ${s.check_out_time}</p></div></div></div>
                  ${d.arrival_info ? html`<div class="info-block"><div class="info-block-icon">${icon('key')}</div><div><h3 class="h4">Ankomst og nøgle</h3><div class="info-block-body"><p>${lines(d.arrival_info)}</p></div></div></div>` : ''}
                  ${d.wifi_name || d.wifi_password ? html`<div class="info-block"><div class="info-block-icon">${icon('wifi')}</div><div><h3 class="h4">Wi-Fi</h3><div class="info-block-body"><p>${d.wifi_name || ''}<br><strong class="mono">${d.wifi_password || ''}</strong></p></div></div></div>` : ''}
                  ${d.access_info ? html`<div class="info-block"><div class="info-block-icon">${icon('lock')}</div><div><h3 class="h4">Adgang</h3><div class="info-block-body"><p>${lines(d.access_info)}</p></div></div></div>` : ''}
                  ${d.practical_info ? html`<div class="info-block"><div class="info-block-icon">${icon('info')}</div><div><h3 class="h4">Godt at vide</h3><div class="info-block-body"><p>${lines(d.practical_info)}</p></div></div></div>` : ''}
                  ${d.contact_name || d.contact_phone ? html`<div class="info-block"><div class="info-block-icon">${icon('phone')}</div><div><h3 class="h4">Kontakt</h3><div class="info-block-body"><p>${d.contact_name || ''}</p>${d.contact_phone ? html`<a class="link-arrow" href="tel:${d.contact_phone.replace(/\s/g, '')}">${d.contact_phone}</a>` : ''}</div></div></div>` : ''}
                </div>
                ${d.house_rules ? html`<h3 class="h4" style="margin-top:28px">Husregler</h3><ul class="rules">${d.house_rules.split('\n').filter((l) => l.trim()).map((l) => html`<li>${icon('check')}<span>${l}</span></li>`)}</ul>` : ''}
                <div class="btn-row" style="margin-top:24px">
                  <button type="button" class="btn" data-ics>${icon('download')}Tilføj til kalender</button>
                  <a class="btn" href="${googleCalendarUrl(booking, propForIcs)}" target="_blank" rel="noopener">${icon('external')}Google Kalender</a>
                </div>
              </section>`
            : ''}

          ${(s.status === 'pending' || s.status === 'approved') && s.start_date > D.today()
            ? html`<p class="small muted guest-cancel">Kan I alligevel ikke? <button type="button" class="link-btn" data-cancel>Annullér forespørgslen</button></p>`
            : ''}
        </div>
      </div>`,
    );

    $('[data-copy]', el).addEventListener('click', () => copyText(statusLink));
    $('[data-ics]', el)?.addEventListener('click', () => downloadIcs(booking, propForIcs));
    $('[data-cancel]', el)?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Annullér forespørgslen?', message: 'Perioden bliver ledig for andre.', confirmLabel: 'Annullér', cancelLabel: 'Behold', danger: true });
      if (!ok) return;
      try {
        await links.guestCancel(token);
        toast('Forespørgslen er annulleret.', { type: 'success' });
        guestStatus.render(el, { ...r, query: {} });
      } catch (err) {
        toastError(err);
      }
    });
  },
};
