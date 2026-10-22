# Site redesign: progress (2026-10-22, complete apart from owner TODOs)

Branch `site-redesign`, worktree `abe-site`. See `README.md` for dev/build/deploy and where config/data live.

## Done
- Astro 7.3.8 + Starlight 0.42.6 + Tailwind 4.3.3, static, `build.format: 'file'`, `trailingSlash: 'never'` (Cloudflare serves `x.html` at `/x`).
- Tokens in `src/styles/tokens.css`, which feeds Tailwind (`global.css`) and Starlight (`starlight.css`). Dark only: ThemeProvider/ThemeSelect overridden in `src/components/starlight/`.
- Pages: `/`, `/download`, `/changelog` (build-time GitHub, empty state works), `/donate`, `/privacy`, `/terms`, `/404`.
- Animated hero mock (`HeroDemo.astro`, shows `public/demo.mp4` if present at build time), privacy SVG diagram, keycap CTA.
- Docs: 18 pages in `src/content/docs/docs/`, calculator and cost table from `src/data/pricing.ts`.
- SEO: canonical URLs, OG (`public/og.png` from `scripts/og/og.html`), sitemap, robots, JSON-LD SoftwareApplication with price 0. Also `_redirects` and `_headers`.
- Verified: build has 0 warnings, `astro check` has 0 errors, `npm run check:links` passes, no horizontal scroll at 390px.

## Also done (2026-10-22, second pass)
- API key guides: `/docs/api-keys` (overview), `/docs/api-keys/groq` (recommended), `/docs/api-keys/openai`, `/docs/api-keys/custom` (Ollama, OpenRouter, Speaches). Each has a "Last verified 2026-10-22" note, troubleshooting keyed to Abe's error strings and a sources list. Sidebar group "API keys" in `astro.config.mjs`.
- Screenshot slots via `src/components/docs/Screenshot.astro`: render only if `public/docs/img/<name>.png` exists. Slots used: `groq-1..4`, `openai-1..4`, `custom-1`.
- Groq is the recommended cloud option on home (step 2 links the Groq guide), `/download` (new "Then choose how Abe transcribes" card), getting started, choosing an engine, settings, FAQ.
- Relayed facts applied: hero pill (20 `#aec6ff` bars, red dot, purple `#a855f7` Transform dot with `#508eff` label), Linux "Coming soon" everywhere (download cards, button, FAQ, getting started, requirements, JSON-LD, site description), macOS Automation permission, Windows no admin, clipboard restore, Paste Last memory-only, 28 languages, Reset to Center, engine error strings, local model behaviour, voice-selected Transform presets.
- `pricing.ts`: only current models (Groq turbo/v3 cited to console.groq.com/docs/models, OpenAI `gpt-transcribe` cited to developers.openai.com).
- Verified again: build 0 warnings, `astro check` 0 errors, `check:links` passes (28 pages), no horizontal scroll at 390px on `/`, `/download`, the API key pages.

## Model defaults documented
- Groq: `whisper-large-v3-turbo` (dictation), `openai/gpt-oss-120b` (Transform; `openai/gpt-oss-20b` cheaper). Groq retired `llama-3.3-70b-versatile` on 2026-08-16; it is not mentioned on the site.
- OpenAI: `gpt-transcribe` ($0.0045/min, dictation), `gpt-6-luna` ($0.10/$0.50 per 1M, Transform). The deprecated OpenAI models appear once, in a note on `/docs/api-keys/openai`, and are no longer in `pricing.ts`.

## Owner TODOs
- Take the guide screenshots and save them as `public/docs/img/groq-1.png` ... `groq-4.png`, `openai-1.png` ... `openai-4.png`, `custom-1.png` (sign-in page, keys page, new-key dialog, Abe settings with a successful Test). They appear automatically on the next build.
- Check the in-app labels used in the guides once the app UI is final: Settings → Transcription, "Use my own API key", provider names, **Test**, **Remove**, the Transform provider/model fields and the success message.
- Re-verify the guides (and their "Last verified" dates) every few months; provider consoles change.
- `DONATE_URL` placeholder, legacy-data deletion date, governing-law clause (see Gotchas).
- Optional: `public/demo.mp4` for the hero.

## Prices verified (2026-10-22)
- OpenAI, https://developers.openai.com/api/docs/pricing (platform.openai.com/docs/pricing redirects there):
  - `whisper-1` $0.006/min
  - `gpt-4o-mini-transcribe` est. $0.003/min ($1.25/$5 per 1M tokens)
  - `gpt-4o-transcribe` est. $0.006/min ($2.50/$10 per 1M tokens)
- Groq, https://groq.com/pricing:
  - `whisper-large-v3-turbo` $0.04/hr
  - `whisper-large-v3` $0.111/hr
  - 10 s minimum per request

## Gotchas
- `site/postcss.config.mjs` must stay (empty), or Vite picks up the desktop app's PostCSS config in the parent folder.
- The `i18n` collection plus `src/content/i18n/en.json` silences a Starlight warning.
- Scoped Astro styles don't apply to JS-injected nodes; use `:global()` (see HeroDemo).
- On Windows Git Bash, pass Windows paths (`cygpath -m`) and `MSYS_NO_PATHCONV=1` to node scripts.
- Screenshots: playwright-core with `channel: 'chrome'` (system Chrome) in the scratchpad, not a site dependency.
- `DONATE_URL` is still the placeholder. The legacy-data deletion date and the governing-law clause are TODO for the owner.
- An empty stray folder `C:\c\Users\DHack\AppData\Local\Temp` (created accidentally) needs manual removal.
