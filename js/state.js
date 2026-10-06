// Small shared app state with change notifications.

import { api } from './api.js';
import { addMonths, startOfMonth, today, min, max, diffDays } from './dates.js';

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

function defaultWindow() {
  const base = startOfMonth(today());
  return { from: addMonths(base, -2), to: addMonths(base, 16) };
}

// Returns calendar entries covering [from, to). Data is cached for a short while
// and refetched after changes (invalidateCalendar) or when stale.
export async function calendarEntries(from, to, { force = false } = {}) {
  const c = state.calendar;
  const covered = c.from && from >= c.from && to <= c.to;
  if (!force && covered && Date.now() - c.at < FRESH_MS) return c.entries;

  const win = defaultWindow();
  let f = min(from, win.from);
  let t = max(to, win.to);
  if (diffDays(f, t) > 790) {
    f = addMonths(startOfMonth(from), -1);
    t = addMonths(startOfMonth(from), 18);
  }
  const entries = await api.calendar(f, t);
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
