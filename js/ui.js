// Shared UI building blocks: toasts, sheets/dialogs, busy buttons, sharing.

import { html, mount, $ } from './html.js';
import { icon } from './icons.js';

let uid = 0;
export const nextId = (prefix = 'id') => `${prefix}-${++uid}`;

// ---------- Toasts ----------

export function toast(message, { type = 'info', title = '', action = null, duration = 4200 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const ic = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  mount(
    el,
    html`<span class="toast-icon">${icon(ic)}</span>
      <span class="toast-text">${title ? html`<strong>${title}</strong>` : ''}${message}</span>
      ${action ? html`<button class="toast-action" type="button">${action.label}</button>` : ''}`,
  );
  host.append(el);
  let timer;
  const remove = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      action.onClick();
      remove();
    });
  }
  timer = setTimeout(remove, action ? duration + 3000 : duration);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => (timer = setTimeout(remove, 1800)));
  return remove;
}

export function toastError(err) {
  toast(err?.message || 'Noget gik galt. Prøv igen.', { type: 'error', duration: 6000 });
}

// ---------- Sheets (dialog: bottom sheet on phones, centered modal on larger screens) ----------

let openCount = 0;

// Phone sheets can be dragged down to close, from the grip/title or from the
// content when it is scrolled to the top.
function swipeToClose(dlg, bodyEl, close) {
  const phone = matchMedia('(max-width: 699px)');
  let drag = null;
  const reset = () => {
    dlg.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    dlg.style.transform = '';
    drag = null;
  };
  dlg.addEventListener(
    'touchstart',
    (e) => {
      if (!phone.matches || e.touches.length !== 1) return;
      const t = e.target;
      if (t.closest('input, textarea, select, .cal-months')) return;
      const fromHead = Boolean(t.closest('.sheet-grip, .sheet-head'));
      if (!fromHead && !(t.closest('.sheet-body') && bodyEl.scrollTop <= 0)) return;
      drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: performance.now(), dy: 0, fromHead, active: false };
    },
    { passive: true },
  );
  dlg.addEventListener(
    'touchmove',
    (e) => {
      if (!drag) return;
      const dx = e.touches[0].clientX - drag.x;
      const dy = e.touches[0].clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy <= 0 || Math.abs(dx) > dy || (!drag.fromHead && bodyEl.scrollTop > 0)) {
          drag = null;
          return;
        }
        drag.active = true;
        dlg.style.transition = 'none';
      }
      drag.dy = Math.max(0, dy);
      dlg.style.transform = `translateY(${drag.dy}px)`;
      e.preventDefault();
    },
    { passive: false },
  );
  const end = () => {
    if (!drag) return;
    if (!drag.active) {
      drag = null;
      return;
    }
    const speed = drag.dy / Math.max(1, performance.now() - drag.at);
    if (drag.dy > Math.min(160, dlg.offsetHeight * 0.3) || (drag.dy > 50 && speed > 0.5)) {
      drag = null;
      dlg.style.transition = '';
      close();
    } else reset();
  };
  dlg.addEventListener('touchend', end);
  dlg.addEventListener('touchcancel', end);
}

export function openSheet({ title, body = '', foot = null, wide = false, onClose = null, className = '' }) {
  const dlg = document.createElement('dialog');
  const titleId = nextId('sheet-title');
  dlg.className = `sheet ${wide ? 'wide' : ''} ${className}`;
  dlg.setAttribute('aria-labelledby', titleId);
  mount(
    dlg,
    html`<div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="${titleId}">${title}</h2>
        <button class="sheet-close" type="button" aria-label="Luk">${icon('x')}</button>
      </div>
      <div class="sheet-body"></div>
      <div class="sheet-foot" hidden></div>`,
  );
  document.body.append(dlg);
  const opener = document.activeElement;
  const bodyEl = $('.sheet-body', dlg);
  const footEl = $('.sheet-foot', dlg);
  if (body) mount(bodyEl, body);
  if (foot) {
    mount(footEl, foot);
    footEl.hidden = false;
  }

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.classList.add('is-closing');
    const done = () => {
      dlg.close();
      dlg.remove();
      openCount = Math.max(0, openCount - 1);
      if (!openCount) document.documentElement.style.overflow = '';
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      onClose?.(result);
    };
    dlg.addEventListener('animationend', done, { once: true });
    setTimeout(() => dlg.isConnected && done(), 400);
  };

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  $('.sheet-close', dlg).addEventListener('click', () => close());

  openCount += 1;
  document.documentElement.style.overflow = 'hidden';
  // On touch screens a focused field opens the keyboard and scrolls the sheet,
  // so fields only get focus when tapped there.
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (touch) for (const f of dlg.querySelectorAll('[autofocus]')) f.removeAttribute('autofocus');
  dlg.tabIndex = -1;
  dlg.showModal();
  const first = bodyEl.querySelector('[autofocus]');
  if (first) first.focus();
  else if (touch) dlg.focus({ preventScroll: true });
  else $('.sheet-close', dlg).focus();
  swipeToClose(dlg, bodyEl, () => close());

  return {
    el: dlg,
    body: bodyEl,
    foot: footEl,
    close,
    setBody(tpl) {
      mount(bodyEl, tpl);
    },
    setFoot(tpl) {
      if (tpl) {
        mount(footEl, tpl);
        footEl.hidden = false;
      } else {
        footEl.hidden = true;
        footEl.innerHTML = '';
      }
    },
    setTitle(t) {
      $('.sheet-head h2', dlg).textContent = t;
    },
  };
}

// Confirmation with optional text input. Resolves to false (cancelled) or
// { value } (confirmed).
export function confirmDialog({
  title,
  message = '',
  confirmLabel = 'Bekræft',
  cancelLabel = 'Fortryd',
  danger = false,
  input = null,
}) {
  return new Promise((resolve) => {
    let result = false;
    const inputId = nextId('confirm-input');
    const sheet = openSheet({
      title,
      body: html`<div class="stack">
        ${message ? html`<p class="muted">${message}</p>` : ''}
        ${input
          ? html`<div class="field">
              <label class="label" for="${inputId}">${input.label}</label>
              <textarea class="textarea" id="${inputId}" rows="3" placeholder="${input.placeholder || ''}" maxlength="1000">${input.value || ''}</textarea>
              ${input.hint ? html`<span class="hint">${input.hint}</span>` : ''}
            </div>`
          : ''}
      </div>`,
      foot: html`<button class="btn" type="button" data-cancel>${cancelLabel}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${confirmLabel}</button>`,
      onClose: () => resolve(result),
    });
    sheet.foot.querySelector('[data-cancel]').addEventListener('click', () => sheet.close());
    sheet.foot.querySelector('[data-ok]').addEventListener('click', () => {
      result = { value: input ? sheet.body.querySelector('textarea').value.trim() : null };
      sheet.close();
    });
    if (input && !matchMedia('(hover: none) and (pointer: coarse)').matches) sheet.body.querySelector('textarea').focus();
    else if (input) sheet.el.focus({ preventScroll: true });
    else sheet.foot.querySelector('[data-ok]').focus();
  });
}

// ---------- Busy buttons ----------

export async function busy(button, fn) {
  if (!button) return fn();
  if (button.classList.contains('is-busy')) return undefined;
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

// ---------- Copy & share ----------

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Kopieret. Indsæt det i en besked.', { type: 'success', duration: 2600 });
}

export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  await copyText([text, url].filter(Boolean).join('\n'));
}

export function appUrl(hash = '') {
  const base = `${location.origin}${location.pathname}`;
  return hash ? `${base}#${hash.replace(/^#/, '')}` : base;
}

// ---------- Small templates ----------

const STATUS = {
  pending: 'Afventer',
  approved: 'Godkendt',
  rejected: 'Afvist',
  cancelled: 'Annulleret',
};

export function statusChip(status, kind = 'stay') {
  if (kind === 'owner' && status === 'approved') return html`<span class="status status-owner">Egen ferie</span>`;
  if (kind === 'blocked' && status === 'approved') return html`<span class="status status-blocked">Lukket</span>`;
  return html`<span class="status status-${status}">${STATUS[status] || status}</span>`;
}

export function propertyTag(p) {
  if (!p) return '';
  return html`<span class="tag tag-${p.id}"><span class="prop-dot ${p.id}"></span>${p.name}</span>`;
}

export function emptyState({ icon: ic = 'calendar', title, text = '', action = '' }) {
  return html`<div class="empty">
    <div class="empty-icon">${icon(ic)}</div>
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}
    ${action}
  </div>`;
}

export function errorState(err, { retry = true } = {}) {
  return html`<div class="empty" role="alert">
    <div class="empty-icon">${icon(err?.unreachable ? 'refresh' : 'alert')}</div>
    <h3>${err?.unreachable ? 'Ingen forbindelse' : 'Det gik ikke helt'}</h3>
    <p>${err?.message || 'Noget gik galt.'}</p>
    ${retry ? html`<button class="btn btn-primary" type="button" data-retry>${icon('refresh')}Prøv igen</button>` : ''}
  </div>`;
}

export function skeletonCards(n = 2, height = 180) {
  return Array.from({ length: n }, () => html`<div class="skeleton" style="height:${height}px;border-radius:24px"></div>`);
}

export function skeletonList(n = 3) {
  return html`<div class="stack" style="--stack:12px" aria-busy="true" aria-label="Indlæser">
    ${Array.from({ length: n }, () => html`<div class="skeleton" style="height:92px;border-radius:18px"></div>`)}
  </div>`;
}

export function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function segmented(el, onChange) {
  // Animates the indicator under the pressed button of a .segmented control.
  let indicator = el.querySelector('.seg-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'seg-indicator';
    el.prepend(indicator);
  }
  const place = (instant = false) => {
    const active = el.querySelector('[aria-pressed="true"]');
    if (!active) return;
    if (instant) indicator.style.transition = 'none';
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    if (instant) requestAnimationFrame(() => (indicator.style.transition = ''));
  };
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    el.querySelectorAll('button[data-value]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    place();
    onChange(btn.dataset.value);
  });
  requestAnimationFrame(() => place(true));
  new ResizeObserver(() => place(true)).observe(el);
  return { place };
}
