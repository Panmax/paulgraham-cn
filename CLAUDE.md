# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chinese translations of Paul Graham's essays, served as a static site at `paulgraham-cn.com`. Two halves that meet at committed JSON:

1. **`pipeline/`** — an offline batch job (`npm run translate`) that scrapes paulgraham.com, translates via Gemini on Vertex AI, and writes `content/articles/*.json` + `content/manifest.json`.
2. **`src/`** — an Astro static site that reads those JSON files at build time. The build makes **no API calls**; all translation is pre-baked into the committed JSON.

## Commands

```bash
npm run dev        # Astro dev server
npm run build      # -> dist/ (static, no API calls)
npm run test       # vitest run (all *.test.ts)
npm run test:watch
npx vitest run pipeline/align.test.ts   # single test file
npx vitest run -t "name of test"        # single test by name

# Translation (needs Vertex credentials — see below)
export GOOGLE_APPLICATION_CREDENTIALS=credentials/gemini-vertex.json
npm run translate                       # all essays (incremental)
npm run translate -- --only=earn,greatwork
npm run translate -- --limit=10         # first N from the source list
```

Node **>=22.12.0** required (Astro 7). Translation writes to `content/` — commit those JSON files as the source of truth for the site.

## The translation pipeline (pipeline/index.ts)

Orchestration is `main()` in `pipeline/index.ts`: fetch the article list → per-article (concurrency 4 via `p-limit`) fetch + `parseArticle` + `assembleArticle` + `writeArticle` → rebuild manifest from **all** articles on disk.

The whole design is **segment-level incremental translation**, and several non-obvious invariants keep it correct:

- **Segments, not whole articles.** `parse-article.ts` splits each essay into typed segments (`paragraph`, `heading`, `list`, `quote`, `footnote`, `hr`, `rawUnsupported`). Each carries a `sourceHash` of its English markdown. Only `TRANSLATABLE_TYPES` (see `shared/article-schema.ts`) get translated; `hr`/`rawUnsupported` are structural and must never inflate stats or be sent to the model.

- **Alignment preserves existing translations** (`align.ts`). On re-run, old and new segments are matched by LCS over `sourceHash` (unchanged anchors), then similarity-matched *within each gap between anchors* (Levenshtein ≥ 0.5). Gap-confinement is deliberate: it stops a similar/duplicate paragraph elsewhere from stealing an id and overwriting the wrong segment's translation. Unchanged segments keep their `zhMarkdown`; only `new`/`changed` segments are (re)translated. This is what makes re-runs cheap.

- **Only missing `zhMarkdown` is translated** (`assemble.ts`). The full article is sent as *context* to the model, but only `translateIds` are requested back. The title travels as **id 0** (never collides with body ids ≥ 1).

- **Validation is a hard gate** (`validate.ts` + `translate.ts`). Up to 3 retries. Link URL sets must match the source **exactly** — a mismatch fails the article. `stripAddedLinks` first repairs the common failure where the model hyperlinks a plain-text mention the English left unlinked (flattening `[text](url)` back to `text` only when the English had no link). Number-preservation is a **soft warning**, not a gate (Chinese legitimately rewrites "526 million" → "5.26亿").

- **`rawUnsupported` segments are surfaced, not silently dropped.** The run summary lists them so a human can verify they aren't real body text before publishing.

- **Manifest is always rebuilt from disk**, not from the run's results — so a `--only`/`--limit` run or a run with failures never drops other articles from the homepage index.

## Shared schema (shared/article-schema.ts)

`ArticleSchema` (Zod) is the contract used by **both** halves: the pipeline validates what it writes, and Astro's content collection (`src/content.config.ts`) validates what it reads via `glob({ pattern: "*.json", base: "content/articles" })`. Change a field here and you must update both sides. `isTranslatable()` / `TRANSLATABLE_TYPES` live here and gate behavior across pipeline and site.

## The site (src/)

- `src/pages/[slug].astro` renders each article; `getStaticPaths` reads the `articles` collection. `astro.config.mjs` sets `build.format: "file"` so pages emit as `/earn.html`, not `/earn/index.html`.
- `src/components/ArticleBody.astro` renders each segment as stacked Chinese + English blocks. The **双语对照 (bilingual)** toggle in `[slug].astro` flips `document.body.dataset.read` between `zh` and `bilingual`, persisted to `localStorage`; CSS shows/hides `.seg-en` accordingly.
- `src/lib/markdown.ts` renders segment markdown through unified/remark/rehype **with `rehypeSanitize`** — segment HTML is always sanitized, `allowDangerousHtml: false`.

## Model / credentials

- Model: `gemini-3.5-flash` on **Vertex AI**, project `live-card-491105`, location **`global`** (not a regional endpoint — us-central1 returns 404). See `pipeline/translate.ts`.
- Credentials are a service-account JSON at `credentials/gemini-vertex.json`, pointed to by `GOOGLE_APPLICATION_CREDENTIALS`. `credentials/` is gitignored — never commit it.
- Translation style + the term glossary live in `pipeline/prompt.ts` and `pipeline/glossary.json`. Add domain terms to the glossary to keep translations consistent.

## Deploy

Cloudflare Pages: build `npm run build`, output `dist`, no env vars or secrets (translation is pre-baked into committed JSON).
