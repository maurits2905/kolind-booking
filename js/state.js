// Small shared app state with change notifications.

import { api } from './api.js';
import { addMonths, startOfMonth, today, min, max } from './dates.js';

export const state = {
  session: null,
  me: null,
  properties: [],
  byId: {},
  calendar: { from: null, to: null, entries: [], at: 0 },
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  listeners.forEach((fn) => fn(state));
}

export function isAdmin() {
  return state.me?.role === 'admin' && state.me?.active;
}

export function isMember() {
  return Boolean(state.me?.active);
}

export function cap(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

export function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

export async function loadMe() {
  state.me = state.session ? await api.me() : null;
  emit();
  return state.me;
}

export async function loadProperties() {
  const list = await api.properties();
  state.properties = list;
  state.byId = Object.fromEntries(list.map((p) => [p.id, p]));
  emit();
  return list;
}

export function property(id) {
  return state.byId[id];
}

const FRESH_MS = 45_000;

// Covers every month the calendars let you browse to (24 months ahead).
function defaultWindow() {
  const base = startOfMonth(today());
  return { from: addMonths(base, -2), to: addMonths(base, 25) };
}

// get_calendar accepts at most 800 days per call, so longer ranges are fetched
// in pieces. A stay that crosses a seam is kept from the piece it starts in.
async function fetchCalendar(from, to) {
  const seams = [from];
  while (seams[seams.length - 1] < to) seams.push(min(addMonths(seams[seams.length - 1], 24), to));
  const parts = await Promise.all(seams.slice(0, -1).map((a, i) => api.calendar(a, seams[i + 1])));
  return parts.flatMap((part, i) => (i === 0 ? part : part.filter((e) => e.start_date >= seams[i])));
}

// Returns calendar entries covering [from, to). Data is cached for a short while
// and refetched after changes (invalidateCalendar) or when stale.
export async function calendarEntries(from, to, { force = false } = {}) {
  const c = state.calendar;
  const covered = c.from && from >= c.from && to <= c.to;
  if (!force && covered && Date.now() - c.at < FRESH_MS) return c.entries;

  const win = defaultWindow();
  const f = min(from, win.from);
  const t = max(to, win.to);
  const entries = await fetchCalendar(f, t);
  state.calendar = { from: f, to: t, entries, at: Date.now() };
  return entries;
}

export function invalidateCalendar() {
  state.calendar.at = 0;
}

export async function refreshMeQuietly() {
  try {
    await loadMe();
  } catch {
    /* ignored: next navigation retries */
  }
}
