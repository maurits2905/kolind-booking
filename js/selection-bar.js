// Sticky bar that follows the date selection: "12. okt → 19. okt · 7 nætter  [Fortsæt]".

import { html, mount, $ } from './html.js';
import { icon } from './icons.js';
import * as D from './dates.js';

export function selectionBarTemplate() {
  return html`<div class="selection-bar" hidden>
    <div class="container selection-inner">
      <div class="selection-text" aria-live="polite"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-clear>Ryd</button>
      <button type="button" class="btn btn-accent" data-continue>Fortsæt${icon('arrow-right')}</button>
    </div>
  </div>`;
}

export function selectionBar(el, prop) {
  let property = prop;
  return {
    setProperty(p) {
      property = p;
    },
    update(sel) {
      const has = Boolean(sel.start);
      el.hidden = !has;
      el.classList.toggle('is-complete', Boolean(sel.start && sel.end));
      document.body.classList.toggle('has-selection', has);
      if (!has) return;
      mount(
        $('.selection-text', el),
        sel.end
          ? html`<strong>${D.fmtRange(sel.start, sel.end)}</strong><span class="small muted">${D.nightsLabel(D.diffDays(sel.start, sel.end))}${property ? ` · ${property.name}` : ''}</span>`
          : html`<strong>Ankomst ${D.fmtDayMedium(sel.start)}</strong><span class="small muted">Vælg afrejsedag i kalenderen</span>`,
      );
      $('[data-continue]', el).disabled = !sel.end;
    },
    onClear(fn) {
      $('[data-clear]', el).addEventListener('click', fn);
    },
    onContinue(fn) {
      $('[data-continue]', el).addEventListener('click', fn);
    },
    destroy() {
      document.body.classList.remove('has-selection');
    },
  };
}
