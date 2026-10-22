// Crawls the built site in dist/ and reports internal links and anchors that
// don't resolve. Run after `npm run build`: `npm run check:links`.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const htmlFiles = walk(dist).filter((f) => f.endsWith('.html'));
const routeOf = (file) => {
  const r = '/' + relative(dist, file).split(sep).join('/');
  return r.replace(/index\.html$/, '').replace(/\.html$/, '') || '/';
};

// Map every route to the ids present on that page.
const ids = new Map();
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  ids.set(routeOf(file), new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}

// Cloudflare Pages redirects count as valid targets.
const redirects = existsSync(join(dist, '_redirects'))
  ? readFileSync(join(dist, '_redirects'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .map((l) => l.trim().split(/\s+/)[0])
  : [];

const resolves = (path) => {
  const clean = path.replace(/\/$/, '') || '/';
  if (ids.has(clean)) return true;
  if (redirects.includes(path) || redirects.includes(clean)) return true;
  const asset = join(dist, decodeURIComponent(path));
  return existsSync(asset) && statSync(asset).isFile();
};

const broken = [];
let checked = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const from = routeOf(file);
  for (const [, attr, raw] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (!raw || /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(raw)) continue;
    // Relative links resolve against the page's own route (Cloudflare serves /a/b.html at /a/b).
    const target = new URL(raw.replace(/&amp;/g, '&'), `https://x${from}`);
    checked++;
    if (!resolves(target.pathname)) {
      broken.push(`${from}: ${attr}="${raw}" (no such page or file)`);
      continue;
    }
    if (target.hash && attr === 'href') {
      const page = target.pathname.replace(/\/$/, '') || '/';
      const pageIds = ids.get(page);
      const id = decodeURIComponent(target.hash.slice(1));
      if (pageIds && id && id !== '_top' && !pageIds.has(id)) broken.push(`${from}: href="${raw}" (missing #${id})`);
    }
  }
}

if (broken.length) {
  console.error(`Broken internal links (${broken.length}):\n  ` + [...new Set(broken)].join('\n  '));
  process.exit(1);
}
console.log(`OK: ${checked} internal links across ${htmlFiles.length} pages resolve.`);
