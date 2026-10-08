// Photo gallery: the strip on a house's page, the full-screen slideshow, and
// the admin tools for uploading, ordering and deleting photos.
//
// Photos are shrunk in the browser before upload (longest side 1800 px plus a
// 640 px thumbnail, WebP or JPEG), so a phone photo of 4-8 MB ends up around
// 250 KB and the free 1 GB storage lasts for thousands of photos.

import { html, mount, $, $$ } from './html.js';
import { icon } from './icons.js';
import { photos } from './api.js';
import { toast, toastError, confirmDialog } from './ui.js';

const FULL = 1800;
const THUMB = 640;
const MAX_BYTES = 2.8 * 1024 * 1024;

// ---------- loading ----------

// Returns [{ id, thumb, full, width, height }] for a house, in display order.
export async function loadPhotos(propertyId) {
  const list = await photos.list(propertyId);
  if (!list.length) return [];
  const urls = await photos.urls(list.flatMap((p) => [p.thumb_path, p.path]));
  return list
    .map((p) => ({ ...p, thumb: urls[p.thumb_path], full: urls[p.path] }))
    .filter((p) => p.full);
}

// ---------- strip on the house page ----------

export function photoStrip(slides) {
  return html`<div class="photo-strip" data-photo-strip>
    ${slides.map(
      (s, i) => html`<button type="button" class="photo-thumb" data-slide="${i}" aria-label="Vis billede ${i + 1} af ${slides.length}">
        <img src="${s.thumb || s.full}" alt="" loading="lazy" decoding="async" draggable="false">
      </button>`,
    )}
  </div>`;
}

export function bindPhotoStrip(root, slides) {
  const strip = $('[data-photo-strip]', root);
  if (!strip) return;
  const dragged = dragScroll(strip);
  strip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slide]');
    if (!b || dragged()) return;
    openSlideshow(slides, Number(b.dataset.slide));
  });
}

// Mouse drag-to-scroll for horizontal lists (touch screens scroll natively).
// Returns a function telling whether the last pointer gesture was a drag, so a
// drag does not also count as a click.
function dragScroll(el, { onRelease, signal } = {}) {
  let start = null;
  let moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    start = { x: e.clientX, left: el.scrollLeft, at: performance.now() };
    moved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (!moved && Math.abs(dx) < 5) return;
    if (!moved) {
      moved = true;
      el.classList.add('is-dragging');
    }
    el.scrollLeft = start.left - dx;
  }, { signal });
  window.addEventListener('pointerup', (e) => {
    if (!start) return;
    const s = start;
    start = null;
    el.classList.remove('is-dragging');
    if (moved) onRelease?.(e.clientX - s.x, (e.clientX - s.x) / Math.max(1, performance.now() - s.at));
  }, { signal });
  return () => {
    const m = moved;
    moved = false;
    return m;
  };
}

// ---------- full-screen slideshow ----------

export function openSlideshow(slides, start = 0) {
  const dlg = document.createElement('dialog');
  dlg.className = 'slideshow';
  dlg.setAttribute('aria-label', 'Billeder');
  mount(
    dlg,
    html`<div class="slideshow-track" data-track>
        ${slides.map(
          (s, i) => html`<figure class="slide"><img src="${i === start ? s.full : ''}" data-src="${s.full}" alt="${s.alt || ''}" decoding="async" draggable="false"></figure>`,
        )}
      </div>
      <div class="slideshow-top">
        <span class="slideshow-count" data-count></span>
        <button type="button" class="slideshow-btn" data-close aria-label="Luk">${icon('x')}</button>
      </div>
      <button type="button" class="slideshow-btn slideshow-nav prev" data-step="-1" aria-label="Forrige billede">${icon('chevron-left')}</button>
      <button type="button" class="slideshow-btn slideshow-nav next" data-step="1" aria-label="Næste billede">${icon('chevron-right')}</button>
      <div class="slideshow-dots" aria-hidden="true">${slides.map(() => html`<i></i>`)}</div>`,
  );
  document.body.append(dlg);
  const track = $('[data-track]', dlg);
  const life = new AbortController();
  const imgs = $$('img', track);
  const dots = $$('.slideshow-dots i', dlg);
  let index = start;

  const load = (i) => {
    for (const j of [i - 1, i, i + 1]) {
      const img = imgs[j];
      if (img && !img.getAttribute('src')) img.src = img.dataset.src;
    }
  };
  const update = () => {
    index = Math.round(track.scrollLeft / track.clientWidth);
    load(index);
    $('[data-count]', dlg).textContent = `${index + 1} / ${slides.length}`;
    dots.forEach((d, i) => d.classList.toggle('on', i === index));
    $('[data-step="-1"]', dlg).disabled = index <= 0;
    $('[data-step="1"]', dlg).disabled = index >= slides.length - 1;
  };
  const go = (i, smooth = true) => {
    const target = Math.max(0, Math.min(slides.length - 1, i));
    load(target);
    track.scrollTo({ left: target * track.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
  };

  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  });
  // Mouse: drag the photo itself; a short fast flick also turns the page.
  const wasDrag = dragScroll(track, {
    signal: life.signal,
    onRelease: (dx, speed) => {
      const base = Math.round(track.scrollLeft / track.clientWidth);
      const flick = Math.abs(speed) > 0.4 && Math.abs(dx) > 30 ? (dx < 0 ? 1 : -1) : 0;
      go(Math.abs(dx) > track.clientWidth / 2 ? base : index + flick);
    },
  });
  track.addEventListener('click', (e) => {
    if (wasDrag()) return;
    if (e.target === track || e.target.classList.contains('slide')) close();
  });

  const close = () => {
    life.abort();
    dlg.classList.add('is-closing');
    setTimeout(() => {
      dlg.close();
      dlg.remove();
      document.documentElement.style.overflow = '';
    }, 220);
  };
  dlg.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) go(index + Number(step.dataset.step));
    if (e.target.closest('[data-close]')) close();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  window.addEventListener('resize', () => go(index, false), { signal: life.signal });

  document.documentElement.style.overflow = 'hidden';
  dlg.showModal();
  requestAnimationFrame(() => {
    go(start, false);
    update();
  });
}

// ---------- shrinking images before upload ----------

async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> below (e.g. older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(source, maxSide, quality) {
  const w0 = source.width;
  const h0 = source.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) =>
    canvas.toBlob((webp) => {
      // Browsers that cannot write WebP hand back PNG; use JPEG instead.
      if (webp && webp.type === 'image/webp') resolve({ blob: webp, w, h, ext: 'webp' });
      else canvas.toBlob((jpg) => resolve({ blob: jpg, w, h, ext: 'jpg' }), 'image/jpeg', quality);
    }, 'image/webp', quality),
  );
}

async function prepare(file) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error(`${file.name} kunne ikke læses. Brug JPG, PNG eller WebP (iPhone-billeder i HEIC kan gemmes som JPG først).`);
  }
  let full = await encode(source, FULL, 0.82);
  if (full.blob.size > MAX_BYTES) full = await encode(source, FULL, 0.62);
  const thumb = await encode(source, THUMB, 0.74);
  return { full, thumb };
}

// ---------- admin: upload, order, delete ----------

export async function renderPhotoAdmin(host, propertyId) {
  let list = [];
  let usage = null;
  try {
    [list, usage] = await Promise.all([loadPhotos(propertyId), photos.usage()]);
  } catch (err) {
    mount(host, html`<div class="form-error">${err.message}</div>`);
    return;
  }
  const mb = (b) => (b / 1024 / 1024).toLocaleString('da-DK', { maximumFractionDigits: 1 });
  mount(
    host,
    html`<div class="photo-admin">
      <div class="photo-admin-bar">
        <label class="btn btn-accent">
          ${icon('plus')}Tilføj billeder
          <input type="file" accept="image/*" multiple hidden data-upload>
        </label>
        <span class="small muted" data-usage>${list.length} af ${usage.per_property} billeder · ${mb(usage.bytes)} MB af ${mb(usage.limit_bytes)} MB brugt i alt</span>
      </div>
      <div class="upload-progress" data-progress hidden><span></span><i></i></div>
      ${list.length
        ? html`<ol class="photo-admin-grid">
            ${list.map(
              (p, i) => html`<li data-id="${p.id}">
                <img src="${p.thumb}" alt="" loading="lazy">
                <div class="photo-admin-tools">
                  <button type="button" class="icon-btn" data-move="-1" aria-label="Flyt frem" ${i === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button>
                  <button type="button" class="icon-btn" data-move="1" aria-label="Flyt bagud" ${i === list.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
                  <button type="button" class="icon-btn danger" data-del aria-label="Slet billede">${icon('trash')}</button>
                </div>
              </li>`,
            )}
          </ol>`
        : html`<p class="small muted">Ingen billeder endnu. Hovedbilledet øverst på siden er altid med; billederne her vises efter det i galleriet.</p>`}
    </div>`,
  );

  const refresh = () => renderPhotoAdmin(host, propertyId);

  $('[data-upload]', host).addEventListener('change', async (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    e.target.value = '';
    if (!files.length) return;
    const room = usage.per_property - list.length;
    if (room <= 0) return toast(`Der kan højst være ${usage.per_property} billeder pr. bolig. Slet nogle først.`, { type: 'error' });
    const batch = files.slice(0, room);
    const bar = $('[data-progress]', host);
    bar.hidden = false;
    let ok = 0;
    const failed = [];
    for (const [i, file] of batch.entries()) {
      $('span', bar).textContent = `Gør billede ${i + 1} af ${batch.length} klar…`;
      $('i', bar).style.width = `${(i / batch.length) * 100}%`;
      try {
        const { full, thumb } = await prepare(file);
        const id = crypto.randomUUID();
        const path = `${propertyId}/${id}.${full.ext}`;
        const thumbPath = `${propertyId}/${id}-thumb.${thumb.ext}`;
        $('span', bar).textContent = `Uploader billede ${i + 1} af ${batch.length}…`;
        await photos.upload(path, full.blob);
        await photos.upload(thumbPath, thumb.blob);
        try {
          await photos.add({ propertyId, path, thumbPath, width: full.w, height: full.h, bytes: full.blob.size + thumb.blob.size });
        } catch (err) {
          await photos.removeFiles([path, thumbPath]).catch(() => {});
          throw err;
        }
        ok += 1;
      } catch (err) {
        failed.push(err.message);
        if (/fuldt|højst/.test(err.message)) break;
      }
    }
    $('i', bar).style.width = '100%';
    if (ok) toast(`${ok} ${ok === 1 ? 'billede' : 'billeder'} tilføjet.`, { type: 'success' });
    if (failed.length) toast(failed[0], { type: 'error', duration: 8000 });
    if (files.length > batch.length) toast(`Kun ${batch.length} blev tilføjet: der kan højst være ${usage.per_property} billeder pr. bolig.`, { type: 'error' });
    refresh();
  });

  $('.photo-admin', host).addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const move = e.target.closest('[data-move]');
    if (move) {
      const ids = list.map((p) => p.id);
      const i = ids.indexOf(li.dataset.id);
      const j = i + Number(move.dataset.move);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try {
        await photos.order(propertyId, ids);
        refresh();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    if (e.target.closest('[data-del]')) {
      const ok = await confirmDialog({ title: 'Slet billedet?', message: 'Det fjernes fra galleriet for alle.', confirmLabel: 'Slet', danger: true });
      if (!ok) return;
      try {
        const r = await photos.remove(li.dataset.id);
        await photos.removeFiles([r.path, r.thumb_path]).catch(() => {});
        refresh();
      } catch (err) {
        toastError(err);
      }
    }
  });
}
