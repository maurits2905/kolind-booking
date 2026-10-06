// All dates are plain calendar dates as 'YYYY-MM-DD' strings (no time, no
// timezone). Arithmetic happens in UTC so daylight saving can never shift a day.
// A stay is [start, end): start = ankomst (check-in), end = afrejse (check-out).

export const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
export const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const WEEKDAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
export const WEEKDAYS_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

const pad = (n) => String(n).padStart(2, '0');

export function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function utc(s) {
  const { y, m, d } = parts(s);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  const dt = new Date(ms);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const todayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });

export function today() {
  return todayFmt.format(new Date());
}

export function addDays(s, n) {
  return fromUtc(utc(s) + n * 86400000);
}

export function diffDays(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

// 0 = mandag … 6 = søndag
export function weekday(s) {
  return (new Date(utc(s)).getUTCDay() + 6) % 7;
}

export function startOfMonth(s) {
  const { y, m } = parts(s);
  return iso(y, m, 1);
}

export function addMonths(s, n) {
  const { y, m } = parts(s);
  const total = y * 12 + (m - 1) + n;
  return iso(Math.floor(total / 12), (total % 12) + 1, 1);
}

export function daysInMonth(s) {
  const { y, m } = parts(s);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isValid(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  return fromUtc(utc(s)) === s;
}

export function min(a, b) {
  return a < b ? a : b;
}
export function max(a, b) {
  return a > b ? a : b;
}

// ---------- Danish formatting ----------

export function fmtDay(s, { year = 'auto' } = {}) {
  const { y, m, d } = parts(s);
  const showYear = year === true || (year === 'auto' && y !== parts(today()).y);
  return `${d}. ${MONTHS_SHORT[m - 1]}${showYear ? ` ${y}` : ''}`;
}

export function fmtDayLong(s, { year = 'auto' } = {}) {
  const { y, m, d } = parts(s);
  const showYear = year === true || (year === 'auto' && y !== parts(today()).y);
  return `${WEEKDAYS[weekday(s)]} ${d}. ${MONTHS[m - 1]}${showYear ? ` ${y}` : ''}`;
}

export function fmtDayMedium(s) {
  const { m, d } = parts(s);
  return `${WEEKDAYS_SHORT[weekday(s)]} ${d}. ${MONTHS_SHORT[m - 1]}`;
}

export function fmtRange(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const thisYear = parts(today()).y;
  const yearSuffix = pb.y !== thisYear || pa.y !== pb.y ? ` ${pb.y}` : '';
  if (pa.y === pb.y && pa.m === pb.m) {
    return `${pa.d}.–${pb.d}. ${MONTHS_SHORT[pb.m - 1]}${yearSuffix}`;
  }
  const aYear = pa.y !== pb.y ? ` ${pa.y}` : '';
  return `${pa.d}. ${MONTHS_SHORT[pa.m - 1]}${aYear} – ${pb.d}. ${MONTHS_SHORT[pb.m - 1]}${yearSuffix}`;
}

export function fmtMonth(s) {
  const { y, m } = parts(s);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}

export function nightsLabel(n) {
  return `${n} ${n === 1 ? 'nat' : 'nætter'}`;
}

export function guestsLabel(n) {
  return `${n} ${n === 1 ? 'person' : 'personer'}`;
}

export function relative(s) {
  const n = diffDays(today(), s);
  if (n === 0) return 'i dag';
  if (n === 1) return 'i morgen';
  if (n === -1) return 'i går';
  if (n > 1 && n < 14) return `om ${n} dage`;
  if (n >= 14 && n < 60) return `om ${Math.round(n / 7)} uger`;
  if (n >= 60) return `om ${Math.round(n / 30)} måneder`;
  if (n < -1 && n > -14) return `for ${-n} dage siden`;
  return `for ${Math.round(-n / 7)} uger siden`;
}

export function fmtTimestamp(ts) {
  const d = new Date(ts);
  const date = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' }).format(d);
  const time = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' }).format(d);
  return `${date} kl. ${time}`;
}

export function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Copenhagen' }).format(new Date()));
  if (h < 5) return 'God nat';
  if (h < 10) return 'Godmorgen';
  if (h < 12) return 'God formiddag';
  if (h < 18) return 'God eftermiddag';
  return 'God aften';
}
