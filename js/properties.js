// Visual identity per house. Texts, addresses and practical info live in the
// database (editable by the admins); this file only holds what belongs to
// the design: images, colours and the short teaser shown before login.

export const STYLE = {
  mallorca: {
    theme: 'mallorca',
    image: 'assets/img/mallorca.webp',
    imageSm: 'assets/img/mallorca-sm.webp',
    portrait: 'assets/img/mallorca-portrait.webp',
    focus: '55% 40%',
    portraitFocus: '52% 50%',
    teaser: {
      name: 'Mallorca',
      area: 'Mallorca · Spanien',
      tagline: 'Middelhavssol, appelsinlunde og bjergene lige uden for døren.',
    },
    mood: 'Middelhavet',
  },
  odde: {
    theme: 'odde',
    image: 'assets/img/odde.webp',
    imageSm: 'assets/img/odde-sm.webp',
    portrait: 'assets/img/odde-portrait.webp',
    focus: '48% 52%',
    portraitFocus: '50% 50%',
    teaser: {
      name: 'Sjællands Odde',
      area: 'Sjællands Odde · Danmark',
      tagline: 'Nyt træhus mellem fyrretræer, lyng og Kattegat.',
    },
    mood: 'Kattegat',
  },
};

const FALLBACK = {
  theme: '',
  image: 'assets/img/odde.webp',
  imageSm: 'assets/img/odde-sm.webp',
  portrait: 'assets/img/odde-portrait.webp',
  focus: '50% 50%',
  portraitFocus: '50% 50%',
  teaser: { name: 'Feriebolig', area: '', tagline: '' },
};

export function style(id) {
  return STYLE[id] || FALLBACK;
}

export const PROPERTY_ORDER = Object.keys(STYLE);

export function teaserList() {
  return PROPERTY_ORDER.map((id) => ({ id, ...STYLE[id].teaser }));
}

export function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((address || '').replace(/\n/g, ', '))}`;
}
