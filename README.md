# paulgraham-cn.com

Chinese translations of Paul Graham's essays.

## Translate (local, needs `OPENROUTER_API_KEY` in the environment)

```bash
npm run translate            # all essays (incremental, segment-level)
npm run translate -- --only=earn,greatwork   # subset
npm run translate -- --limit=10              # first N
```

Outputs `content/articles/*.json` + `content/manifest.json`. Commit these.

## Site

```bash
npm run dev       # local dev
npm run build     # -> dist/, no API calls
```

## Fonts

The site ships one shared WOFF2 subset per weight (Chinese: Source Han Serif SC → "PGCN Song"; Latin: Newsreader), covering every code point across all articles plus fixed UI chrome. The subsets and `public/fonts/manifest.json` are committed, so `npm run dev` and CI need no font-generation step.

The Chinese **regular** face carries the whole corpus (~3250 code points, ~1.5MB). The **bold** face is subsetted separately to only the code points that are ever rendered at weight 700 — article titles and `<strong>` spans, about a third of the corpus (~0.5MB). Anything bold outside that set would silently fall back to a system font, so the manifest pins both charset hashes and `scripts/verify-fonts.ts` fails the build if either goes stale.

```bash
npm run fonts     # regenerates public/fonts/zh/*.woff2 + manifest.json — run after content changes
```

`npm run fonts` needs the raw Source Han Serif SC OTFs (2.003R, from the `adobe-fonts/source-han-serif` release) placed in the gitignored `assets/fonts/`; their SHA-256 is pinned in `scripts/font-sources.ts` and checked before subsetting. `npm run build` runs `scripts/verify-fonts.ts` first and **fails** if the committed subset's charset hash is stale relative to `content/articles/*.json` — regenerate with `npm run fonts` and commit the updated `public/fonts/` whenever article content or `scripts/lib/chars.ts` (`SHARED_UI_TEXT`) changes.

Both fonts are SIL Open Font License 1.1; the full license and copyright notices are bundled at `public/OFL.txt` (served at `/OFL.txt`) and linked from the site footer.

## Deploy (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`
- No environment variables or secrets needed (translation is pre-baked into committed JSON).
- Bind custom domain `paulgraham-cn.com`.
