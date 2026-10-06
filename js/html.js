// Tiny, safe-by-default templating: html`...` escapes every interpolated value
// unless it is itself an html`` result (or wrapped in raw()).

class Safe {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESC[c]);
}

function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Safe(out);
}

export function raw(value) {
  return new Safe(String(value ?? ''));
}

export function mount(el, template) {
  el.innerHTML = render(template);
  return el;
}

export function fragment(template) {
  const t = document.createElement('template');
  t.innerHTML = render(template);
  return t.content;
}

// Plain text with line breaks → paragraphs.
export function paragraphs(text) {
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((p) => html`<p>${lines(p)}</p>`);
}

export function lines(text) {
  if (!text) return '';
  return text.split('\n').map((l, i) => (i ? html`<br>${l}` : html`${l}`));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}
