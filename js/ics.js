// "Tilføj til kalender": .ics download (Apple, Outlook, Android) and a Google
// Calendar link. All-day event from arrival day through departure day.

import * as D from './dates.js';

const compact = (d) => d.replace(/-/g, '');

function escapeIcs(s = '') {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function details(b, p) {
  return [
    p?.check_in_time ? `Ankomst fra kl. ${p.check_in_time}` : '',
    p?.check_out_time ? `Afrejse senest kl. ${p.check_out_time}` : '',
    b.guests ? D.guestsLabel(b.guests) : '',
    location.href.split('#')[0],
  ]
    .filter(Boolean)
    .join('\n');
}

export function downloadIcs(b, p) {
  const title = `${p?.name || b.property_name} · ferie`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kolind Booking//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id || compact(b.start_date)}-${b.property_id}@kolind-booking`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(b.start_date)}`,
    `DTEND;VALUE=DATE:${compact(D.addDays(b.end_date, 1))}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(details(b, p))}`,
    p?.address ? `LOCATION:${escapeIcs(p.address.replace(/\n/g, ', '))}` : '',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(p?.name || 'ferie').toLowerCase().replace(/[^a-z0-9æøå]+/g, '-')}-${b.start_date}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function googleCalendarUrl(b, p) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${p?.name || b.property_name} · ferie`,
    dates: `${compact(b.start_date)}/${compact(D.addDays(b.end_date, 1))}`,
    details: details(b, p),
    location: (p?.address || '').replace(/\n/g, ', '),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
