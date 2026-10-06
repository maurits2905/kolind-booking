// Ready-to-send emails. Nothing is sent by the system: the draft opens in the
// person's own mail app (mailto), can be copied, or shared as a message.
// That keeps the setup free, needs no mail service and nothing can get lost
// in a queue.

import config from '../config.js';
import { html, mount, $ } from './html.js';
import { icon } from './icons.js';
import * as D from './dates.js';
import { state, firstName } from './state.js';
import { api } from './api.js';
import { openSheet, copyText, toast, appUrl, nextId } from './ui.js';

// ---------- building blocks ----------

export function mailtoUrl({ to = [], subject = '', body = '' }) {
  const addresses = to
    .map((r) => (typeof r === 'string' ? r : r.email))
    .filter(Boolean)
    .map((e) => e.replace(/[^\w.+@-]/g, ''))
    .join(',');
  const enc = (s) => encodeURIComponent(s).replace(/%0A/g, '%0D%0A');
  return `mailto:${addresses}?subject=${enc(subject)}&body=${enc(body)}`;
}

export function hostNames(list) {
  const n = list.map((r) => firstName(r.full_name || r.name || '')).filter(Boolean);
  if (!n.length) return config.adminNames || 'administratorerne';
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} og ${n[n.length - 1]}`;
}

function sender() {
  return firstName(state.me?.full_name || '');
}

function stayLines(b, p) {
  const nights = D.diffDays(b.start_date, b.end_date);
  return [
    `Ankomst: ${D.fmtDayLong(b.start_date)}${p?.check_in_time ? ` fra kl. ${p.check_in_time}` : ''}`,
    `Afrejse: ${D.fmtDayLong(b.end_date)}${p?.check_out_time ? ` senest kl. ${p.check_out_time}` : ''}`,
    `${D.nightsLabel(nights)}${b.guests ? ` · ${D.guestsLabel(b.guests)}` : ''}`,
  ].join('\n');
}

const join = (...parts) => parts.filter((x) => x !== null && x !== undefined && x !== '').join('\n\n');

let adminCache = null;
export async function adminContacts() {
  if (!adminCache) {
    try {
      adminCache = await api.adminContacts();
    } catch {
      adminCache = [];
    }
  }
  return adminCache;
}

// ---------- drafts ----------

export function requestDraft(b, p, admins) {
  const name = p?.name || b.property_name;
  return {
    to: admins,
    subject: `Ny forespørgsel: ${name} ${D.fmtRange(b.start_date, b.end_date)}`,
    body: join(
      `Hej ${hostNames(admins)}`,
      `Jeg har sendt en forespørgsel på ${name}:`,
      stayLines(b, p),
      b.comment ? `"${b.comment}"` : '',
      `I kan godkende eller afvise den her:\n${appUrl('/admin')}`,
      `Kærlig hilsen\n${sender()}`,
    ),
  };
}

export function cancelDraft(b, p, admins, reason) {
  const name = p?.name || b.property_name;
  return {
    to: admins,
    subject: `Annulleret: ${name} ${D.fmtRange(b.start_date, b.end_date)}`,
    body: join(
      `Hej ${hostNames(admins)}`,
      `Jeg har annulleret ${b.status === 'pending' ? 'min forespørgsel' : 'mit ophold'} på ${name} ${D.fmtRange(b.start_date, b.end_date)}, så perioden er ledig igen.`,
      reason || '',
      `Kærlig hilsen\n${sender()}`,
    ),
  };
}

export function decisionDraft(b, p, approved) {
  const name = p?.name || b.property_name;
  const person = firstName(b.person_name) || '';
  const email = b.is_guest ? b.guest_email : b.user_email;
  const link = b.is_guest && b.status_token ? appUrl(`/status/${b.status_token}`) : appUrl('/mine');
  return {
    to: email ? [{ full_name: b.person_name, email }] : [],
    subject: approved
      ? `Godkendt: ${name} ${D.fmtRange(b.start_date, b.end_date)}`
      : `Svar på din forespørgsel: ${name} ${D.fmtRange(b.start_date, b.end_date)}`,
    body: approved
      ? join(
          `Hej ${person}`,
          `${b.is_guest ? 'Jeres' : 'Dit'} ophold på ${name} er godkendt.`,
          stayLines(b, p),
          b.decision_note || '',
          `Adresse, praktisk info og Wi-Fi finder ${b.is_guest ? 'I' : 'du'} her:\n${link}`,
          `God tur!\n${sender()}`,
        )
      : join(
          `Hej ${person}`,
          `Desværre kan vi ikke sige ja til ${name} ${D.fmtRange(b.start_date, b.end_date)}.`,
          b.decision_note || '',
          b.is_guest ? '' : `Se hvornår der er ledigt her:\n${appUrl('/kalender')}`,
          `Kærlig hilsen\n${sender()}`,
        ),
  };
}

export function inviteDraft(person, url, { reset = false } = {}) {
  const fn = firstName(person.full_name);
  return {
    to: [person],
    subject: reset ? `Ny adgangskode til ${config.siteName}` : `Din invitation til ${config.siteName}`,
    body: reset
      ? join(`Hej ${fn}`, `Her er et link, hvor du kan vælge en ny adgangskode til ${config.siteName}:`, url, 'Linket virker i 7 dage og kan bruges én gang.', `Kærlig hilsen\n${sender()}`)
      : join(
          `Hej ${fn}`,
          `Her er dit personlige link til ${config.siteName}, familiens side for husene på Mallorca og Sjællands Odde:`,
          url,
          'Åbn linket, og vælg en adgangskode, så er du klar. Linket virker i 30 dage og kan kun bruges af dig.',
          `Kærlig hilsen\n${sender()}`,
        ),
  };
}

// ---------- UI ----------

export function mailDraftBlock(draft, { actions = true } = {}) {
  const ids = { subject: nextId('subj'), body: nextId('body') };
  return html`<div class="mail-draft" data-mail-draft>
    <div class="mail-row">
      <span class="label">Til</span>
      <div class="mail-to">
        ${draft.to.length
          ? draft.to.map((r) => html`<span class="mail-chip" title="${r.email}">${r.full_name ? firstName(r.full_name) : r.email}<span class="tiny muted">${r.email}</span></span>`)
          : html`<span class="small muted">Ingen email registreret. Skriv modtageren i din mail-app.</span>`}
      </div>
    </div>
    <div class="field">
      <label class="label" for="${ids.subject}">Emne</label>
      <input class="input" id="${ids.subject}" name="subject" value="${draft.subject}">
    </div>
    <div class="field">
      <label class="label" for="${ids.body}">Besked</label>
      <textarea class="textarea mail-body" id="${ids.body}" name="body" rows="9">${draft.body}</textarea>
    </div>
    ${actions ? mailActions(draft) : ''}
    <p class="tiny muted mail-hint">Mailen åbner i din egen mail-app, klar til at sende. Har du ingen mail-app på computeren, så brug Kopiér og indsæt i Gmail.</p>
  </div>`;
}

function mailActions(draft) {
  return html`<div class="mail-actions">
    <a class="btn btn-accent" data-mail-open href="${mailtoUrl(draft)}">${icon('mail')}Åbn i mail</a>
    <button type="button" class="btn" data-mail-copy>${icon('copy')}Kopiér</button>
    ${navigator.share ? html`<button type="button" class="btn btn-ghost" data-mail-share>${icon('share')}SMS eller besked</button>` : ''}
  </div>`;
}

export function bindMailDraft(root, draft, actionsRoot = root) {
  const box = $('[data-mail-draft]', root);
  if (!box) return;
  const read = () => ({ to: draft.to, subject: $('[name="subject"]', box).value, body: $('[name="body"]', box).value });
  const link = $('[data-mail-open]', actionsRoot);
  const refresh = () => (link.href = mailtoUrl(read()));
  box.addEventListener('input', refresh);
  link.addEventListener('click', () => {
    refresh();
    setTimeout(() => toast('Mailen er åbnet i din mail-app. Husk at trykke Send.', { type: 'success', duration: 5000 }), 300);
  });
  $('[data-mail-copy]', actionsRoot).addEventListener('click', () => {
    const d = read();
    const to = draft.to.map((r) => r.email).join(', ');
    copyText([to ? `Til: ${to}` : '', `Emne: ${d.subject}`, '', d.body].filter((x, i) => x || i === 2).join('\n'));
  });
  $('[data-mail-share]', actionsRoot)?.addEventListener('click', async () => {
    const d = read();
    try {
      await navigator.share({ title: d.subject, text: d.body });
    } catch {
      /* cancelled */
    }
  });
}

export function openMailDraft(draft, { title = 'Mail klar til afsendelse', intro = '', theme = '' } = {}) {
  const sheet = openSheet({
    title,
    body: html`${intro ? html`<p class="muted mail-intro">${intro}</p>` : ''}${mailDraftBlock(draft, { actions: false })}`,
    foot: mailActions(draft),
    wide: true,
  });
  sheet.foot.classList.add('mail-foot');
  if (theme) sheet.el.dataset.theme = theme;
  bindMailDraft(sheet.body, draft, sheet.foot);
  return sheet;
}
