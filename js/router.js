// Hash router (#/bolig/mallorca). Hash URLs work on GitHub Pages without any
// server configuration, and tokens in links never reach a server log.

const routes = [];
let handler = null;

export function route(pattern, view) {
  const keys = [];
  const re = new RegExp(
    `^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '([^/?]+)';
    })}\\/?$`,
  );
  routes.push({ re, keys, view, pattern });
}

export function parse(hash = location.hash) {
  const full = decodeURIComponent(hash.replace(/^#/, '')) || '/';
  const [path, qs = ''] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = m[i + 1]));
      return { view: r.view, params, query, path, pattern: r.pattern };
    }
  }
  return { view: null, params: {}, query, path, pattern: null };
}

export function currentPath() {
  return parse().path;
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (location.hash === hash) {
    handler?.();
    return;
  }
  if (replace) {
    history.replaceState(null, '', hash);
    handler?.();
  } else {
    location.hash = hash;
  }
}

export function start(onRoute) {
  handler = onRoute;
  window.addEventListener('hashchange', onRoute);
  onRoute();
}
