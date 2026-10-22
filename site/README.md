# getabe.app

The website and documentation for Abe: a fully static [Astro](https://astro.build/) site with
[Starlight](https://starlight.astro.build/) for `/docs`, styled with Tailwind CSS v4. No server, no
cookies, no analytics, no third-party requests.

## Develop

Requires Node.js 22.12 or later.

```sh
cd site
npm install
npm run dev        # http://localhost:4321
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Static build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run check` | Type-check `.astro` and `.ts` files with `astro check` |
| `npm run check:links` | After a build, crawl `dist/` for broken internal links and anchors |

Set `ASTRO_TELEMETRY_DISABLED=1` if you don't want Astro's CLI to send anonymous usage data.

## Where things live

| What | File |
|---|---|
| Site URL, GitHub repo, release asset names, **donate link** (`DONATE_URL`), contact email, nav | `src/config/site.ts` |
| Provider prices and the "prices as of" date (home page, docs table, calculator) | `src/data/pricing.ts` |
| Default hotkeys (home page, docs) | `src/data/hotkeys.ts` |
| FAQ (home page and docs FAQ) | `src/data/faq.ts` |
| Color, type and shadow tokens: the only place colors are defined | `src/styles/tokens.css` |
| Tailwind theme mapping | `src/styles/global.css` |
| Starlight (docs) theme mapping | `src/styles/starlight.css` |
| Docs pages | `src/content/docs/docs/*.mdx` (sidebar order in `astro.config.mjs`) |
| Marketing pages | `src/pages/` |
| Cloudflare redirects and headers | `public/_redirects`, `public/_headers` |
| OG image | `public/og.png`, rendered from `scripts/og/og.html` |

### Updating prices

Edit `src/data/pricing.ts`, change `PRICES_AS_OF`, rebuild. Every price on the site comes from that file.
Use `perMinute: null` for anything you can't verify; it renders as "Check provider pricing".

### Demo video

Drop a screen recording at `public/demo.mp4` and the home page hero shows it instead of the animated mock.
Without the file, no video element is rendered at all.

### Releases, version and changelog

Download buttons link to the permanent URLs
`https://github.com/HardHeadHackerHead/honest-abe/releases/latest/download/<asset>`, using the asset names in
`src/config/site.ts`. The release pipeline must upload assets with exactly those names.

The version number, release date and `/changelog` are fetched from the GitHub API **at build time**. If the
repository is private, missing or rate-limited, the build still succeeds: version labels are hidden and the
changelog shows a link to GitHub instead. Set `GITHUB_TOKEN` in the build environment to raise the rate limit
(or read a private repo), or `ABE_OFFLINE=1` to skip the network entirely.

## Deploy (Railway)

The site runs as the `abe-website` service in the `getabe.app` Railway project. `Dockerfile` builds it with
Node, and Caddy serves `dist/` using `Caddyfile`, which handles clean URLs (no `.html`, no trailing slash),
the old-route redirects and the security headers.

```bash
cd site
railway up --service abe-website   # build and deploy from this folder
```

Redeploy after each app release so the version label and changelog refresh. To preview the exact container
locally: `docker build -t abe-site . && docker run --rm -p 8080:8080 abe-site`.

`public/_redirects` and `public/_headers` mirror the Caddyfile rules, so the site can also be deployed to
Cloudflare Pages unchanged (root `site`, build `npm run build`, output `dist`).

## Design

The palette is the desktop app's Material-3-style tonal system ("Nocturnal Native / Digital Obsidian"): layered
navy surfaces instead of borders, glass for floating elements, a gradient primary CTA, editorial Inter, small
all-caps labels and `#c2c6d6` body text. The site is dark-only; Starlight's theme switcher is removed so the docs
match. All animation respects `prefers-reduced-motion`.
