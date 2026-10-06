// Availability helpers on top of calendar entries from get_calendar().
// A night d is taken when an approved entry has start <= d < end.

import { addDays, today, weekday, diffDays, max, min } from './dates.js';

export function forProperty(entries, propertyId) {
  return entries.filter((e) => e.property_id === propertyId);
}

export function approved(entries) {
  return entries.filter((e) => e.status === 'approved');
}

export function takenNights(entries, propertyId) {
  const set = new Set();
  for (const e of entries) {
    if (e.property_id !== propertyId || e.status !== 'approved') continue;
    for (let d = e.start_date; d < e.end_date; d = addDays(d, 1)) set.add(d);
  }
  return set;
}

export function isRangeFree(taken, start, end) {
  for (let d = start; d < end; d = addDays(d, 1)) if (taken.has(d)) return false;
  return true;
}

// First taken night on/after `from`, or null.
export function nextTaken(taken, from, limit = 800) {
  let d = from;
  for (let i = 0; i < limit; i++, d = addDays(d, 1)) if (taken.has(d)) return d;
  return null;
}

export function overlapsPending(entries, propertyId, start, end, ignoreMine = true) {
  return entries.some(
    (e) =>
      e.property_id === propertyId &&
      e.status === 'pending' &&
      !(ignoreMine && e.is_mine) &&
      e.start_date < end &&
      e.end_date > start,
  );
}

// "Ledig nu" / "Optaget til …" for tonight.
export function nowStatus(entries, propertyId) {
  const t = today();
  const cur = entries.find(
    (e) => e.property_id === propertyId && e.status === 'approved' && e.start_date <= t && e.end_date > t,
  );
  if (!cur) {
    const next = entries
      .filter((e) => e.property_id === propertyId && e.status === 'approved' && e.start_date > t)
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
    return { free: true, nextStart: next?.start_date || null };
  }
  // Follow back-to-back stays to find the real free day.
  const taken = takenNights(entries, propertyId);
  let d = cur.end_date;
  while (taken.has(d)) d = addDays(d, 1);
  return { free: false, until: d, entry: cur };
}

export function nextFreeWeekend(entries, propertyId, from = today()) {
  const taken = takenNights(entries, propertyId);
  // Friday → Sunday (2 nights). This weekend counts until Friday itself.
  let d = addDays(from, (4 - weekday(from) + 7) % 7);
  for (let i = 0; i < 60; i++, d = addDays(d, 7)) {
    if (!taken.has(d) && !taken.has(addDays(d, 1))) return { start: d, end: addDays(d, 2) };
  }
  return null;
}

export function nextFreeWeek(entries, propertyId, from = today()) {
  const taken = takenNights(entries, propertyId);
  let run = 0;
  let d = from;
  for (let i = 0; i < 540; i++, d = addDays(d, 1)) {
    run = taken.has(d) ? 0 : run + 1;
    if (run === 7) return { start: addDays(d, -6), end: addDays(d, 1) };
  }
  return null;
}

// Merged occupied/pending segments clipped to [from, to) for the overview strip.
export function segments(entries, propertyId, from, to) {
  const out = [];
  for (const e of entries) {
    if (e.property_id !== propertyId) continue;
    if (e.end_date <= from || e.start_date >= to) continue;
    out.push({
      start: max(e.start_date, from),
      end: min(e.end_date, to),
      status: e.status,
      entry: e,
      offset: diffDays(from, max(e.start_date, from)),
      length: diffDays(max(e.start_date, from), min(e.end_date, to)),
    });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function freeNightsCount(entries, propertyId, from, to) {
  const taken = takenNights(entries, propertyId);
  let n = 0;
  for (let d = from; d < to; d = addDays(d, 1)) if (!taken.has(d)) n += 1;
  return n;
}
