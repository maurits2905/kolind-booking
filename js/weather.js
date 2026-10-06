// Weather from Open-Meteo (free, no API key, non-commercial use).
// Cached for 30 minutes per house. If the service is unavailable the weather
// simply isn't shown.

const TTL = 30 * 60 * 1000;
const memo = new Map();

const CODES = [
  [[0], 'sun', 'Klart'],
  [[1], 'sun', 'Mest klart'],
  [[2], 'sun-cloud', 'Delvist skyet'],
  [[3], 'cloud', 'Overskyet'],
  [[45, 48], 'fog', 'Tåge'],
  [[51, 53, 55, 56, 57], 'rain', 'Støvregn'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'rain', 'Regn'],
  [[71, 73, 75, 77, 85, 86], 'snow', 'Sne'],
  [[95, 96, 99], 'storm', 'Torden'],
];

export function describe(code) {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return hit ? { icon: hit[1], text: hit[2] } : { icon: 'cloud', text: '' };
}

export async function weather(p) {
  if (p?.latitude == null || p?.longitude == null) return null;
  const key = `wx:${p.latitude},${p.longitude}`;
  const cached = memo.get(key) || readSession(key);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
    '&current=temperature_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=5&wind_speed_unit=ms';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    const data = {
      temp: Math.round(j.current.temperature_2m),
      code: j.current.weather_code,
      wind: Math.round(j.current.wind_speed_10m),
      days: j.daily.time.map((d, i) => ({
        date: d,
        code: j.daily.weather_code[i],
        max: Math.round(j.daily.temperature_2m_max[i]),
        min: Math.round(j.daily.temperature_2m_min[i]),
      })),
    };
    const entry = { at: Date.now(), data };
    memo.set(key, entry);
    try {
      sessionStorage.setItem(key, JSON.stringify(entry));
    } catch {
      /* storage unavailable */
    }
    return data;
  } catch {
    return null;
  }
}

function readSession(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
