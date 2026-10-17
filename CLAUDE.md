# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chinese translations of Paul Graham's essays, served as a static site at `paulgraham-cn.com`. Two halves that meet at committed JSON:

1. **`pipeline/`** — an offline batch job (`npm run translate`) that scrapes paulgraham.com, translates via Gemini on OpenRouter, and writes `content/articles/*.json` + `content/manifest.json`.
2. **`src/`** — an Astro static site that reads those JSON files at build time. The build makes **no API calls**; all translation is pre-baked into the committed JSON.

## Commands

```bash
npm run dev        # Astro dev server
npm run build      # -> dist/ (static, no API calls)
npm run test       # vitest run (all *.test.ts)
npm run test:watch
npx vitest run pipeline/align.test.ts   # single test file
npx vitest run -t "name of test"        # single test by name

# Translation (needs OPENROUTER_API_KEY in the environment — see below)
npm run translate                       # all essays (incremental)
npm run translate -- --only=earn,greatwork
npm run translate -- --limit=10         # first N from the source list

# Tagging (needs OPENROUTER_API_KEY) — see "Tags" below
npm run tag                             # re-tag every article, rewrites content/tags.json

# Summaries (needs OPENROUTER_API_KEY) — see "Summaries" below
npm run summarize                       # rewrite content/summaries.json

# Translation QA (no API calls) — see "Translation QA" below
npx tsx scripts/qa-translations.ts               # sweep all 229 articles
npx tsx scripts/qa-translations.ts --all         # print every finding, not 6
npx tsx scripts/qa-translations.ts --kind=斜体    # one finding kind
npx tsx scripts/qa-translations.ts --blank-emphasis  # clear emphasis-broken segments
npx tsx scripts/qa-translations.ts --blank-terms     # clear glossary-drifted segments
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

- **Writes are idempotent.** `article.translatedAt` is the run date, so writing unconditionally would rewrite every article on any day after the last run and make each look source-revised. `articleContentEqual` (all fields *except* `translatedAt`) gates the write; unchanged articles keep their original date on disk. `manifestArticlesEqual` does the same for `manifest.json`, ignoring `generatedAt`. A run against an unchanged source leaves the working tree clean. The summary reports which articles were `added`/`updated`.

- **Failures make the process exit non-zero.** Per-article errors are caught and counted, not thrown, so `process.exitCode = exitCodeFor(totals.failed)` is what stops a partially failed run from looking successful.

- **Manifest is always rebuilt from disk**, not from the run's results — so a `--only`/`--limit` run or a run with failures never drops other articles from the homepage index.

- **Source HTML is windows-1252, not UTF-8.** paulgraham.com sends no charset in `Content-Type` and no `<meta charset>`, so `resp.text()` would turn every curly quote and em dash into U+FFFD. `fetchHtml` sniffs the way a browser does: strict UTF-8, falling back to windows-1252 (`decodeHtml` in `pipeline/fetch.ts`).

## Translation QA (scripts/qa-translations.ts)

Mechanical sweep over every stored translation — no API calls. It reuses `validateTranslation`, so stored data is held to the same gate the pipeline enforces at write time: blank translations, link-set mismatches, citation/untitled segments, and emphasis drift in both directions (parsed with remark, so `__init__` in a code span is not counted as bold). Emphasis matters visually here: the site renders `<em>` as accent-coloured text, so a dropped one is a visible defect, not a cosmetic one.

`--blank-emphasis` and `--blank-terms` clear `zhMarkdown` on the segments whose only defect is emphasis or glossary drift. That is the pipeline's own "needs translation" signal, so the next `npm run translate` re-translates exactly those and leaves the rest alone. Prompt and glossary changes alone do not re-translate anything — neither is part of `sourceHash`.

`TERM_RULES` encodes one English term → one Chinese term and is what `--blank-terms` acts on. It exists because the glossary is guidance the model follows *most* of the time: `VC` had drifted into three renderings (风投 / 风险投资 / literal `VC`) across ~400 segments. The rules are checked per segment, so only the drifted ones are re-translated. Note `VC → 风投` but `venture capital → 风险投资` — the abbreviation takes the abbreviation, the full term takes the full term. Do not "fix" this by collapsing them into one term: `风投` often refers to the investors themselves, and expanding it to `风险投资` there reads as broken Chinese.

## Tags (shared/tags.ts + content/tags.json + scripts/tag-articles.ts)

Paul Graham's own site has no categories — his index is a flat reverse-chronological list — so the topics are **editorial judgement, not a structure recovered from the source**. Worth saying out loud before anyone treats a tag as a fact about the essay.

The split is deliberate and load-bearing:

- **The vocabulary is code** (`shared/tags.ts`): 11 tags, each with `zh` (display), `en`, and a `hint` that serves as both the prompt's definition and the tag page's one-line description. The tagger, the chip order, and the font subsetting all read from it, so they cannot drift apart.
- **The assignments are data** (`content/tags.json`): `{ articles: { slug: [tagId] } }`, 1-3 tags each.

Tags are **not** in the article JSON and the tagger is **not** part of `npm run translate`. The pipeline's incremental machinery is entirely segment/`sourceHash`-based; an article-level field would force changes to `ArticleSchema`, `articleContentEqual` (the idempotence gate) and the write path, and every tag edit would make a later `npm run translate` report that article as `updated`. A separate file that only `scripts/tag-articles.ts` writes means a translation run can never rewrite a hand-corrected classification.

`npm run tag` regenerates the whole file, so hand corrections are lost on re-run. That is intentional — you only re-run when the vocabulary changes, and then you are redoing the assignments anyway. Git is the undo. Expect to review the diff: the model gets the large majority right, but it over-assigns the biggest bucket (`创业`), so check the members of `startups` first.

The site side is `src/lib/tags.ts` (Zod-parsed at module load, so a malformed file fails the build), `src/components/TagChips.astro` (used three ways: full list on the homepage, full list with the current one marked on a tag page, just the article's own tags on an article page), and `src/pages/tag/[tag].astro`. Tag pages reuse `groupByYear` + `sortArticles` + `ArticleIndex.astro` — the same year-grouped list and title search as the homepage, so `/tag/startups` is browsable and searchable the same way `/` is.

`src/lib/tags.test.ts` is what keeps the map honest: every article on disk is tagged, no entry points at a missing article, no tag is empty (a chip to an empty page is worse than no chip). A rename or a new essay otherwise leaves `content/tags.json` silently stale.

## Summaries (scripts/summarize.ts + content/summaries.json)

`content/summaries.json` holds a 2-3 sentence Chinese standfirst per article, displayed under the title and used as the meta description (`articleDescription` in `src/lib/excerpt.ts` is the fallback). It is editorial metadata in its own file, for the same reason tags are: `npm run translate` must never rewrite it, and hand corrections should survive a translation run.

`npm run summarize` regenerates the whole file from the article's first three translated paragraphs, batched through the same OpenRouter model. Review the diff — a summary must not add anything the translation does not say. `src/lib/summaries.ts` parses the file with Zod at module load, so a malformed file fails the build.

## Shared schema (shared/article-schema.ts)

`ArticleSchema` (Zod) is the contract used by **both** halves: the pipeline validates what it writes, and Astro's content collection (`src/content.config.ts`) validates what it reads via `glob({ pattern: "*.json", base: "content/articles" })`. Change a field here and you must update both sides. `isTranslatable()` / `TRANSLATABLE_TYPES` live here and gate behavior across pipeline and site.

## The site (src/)

- `src/pages/[slug].astro` renders each article; `getStaticPaths` reads the `articles` collection. `astro.config.mjs` sets `build.format: "file"` so pages emit as `dist/earn.html`, not `dist/earn/index.html`.
- **`src/pages/404.astro` is load-bearing.** Cloudflare Pages treats a build with no top-level `404.html` as an SPA and serves `/` with a 200 for every unknown path — soft 404s that put infinite duplicate URLs into the index. Do not delete the 404 page.
- `@astrojs/sitemap` emits `sitemap-index.xml` from `site`; `public/robots.txt` points at it. Article pages carry `Article` JSON-LD and the home page a `WebSite`/`Organization` graph, both built in the page components and rendered by `Base.astro`.
- **Link and canonical to the extensionless form** (`/earn`, not `/earn.html`). Cloudflare Pages serves `dist/earn.html` at `/earn` and 308-redirects the `.html` form to it, so the `.html` spelling costs every click a round trip and makes the canonical name a redirect source. `preferTranslatedArticleUrl` still *matches* `.html` on the incoming paulgraham.com URL, which genuinely has it.
- `src/components/ArticleBody.astro` renders each segment as stacked Chinese + English blocks. The **双语对照 (bilingual)** toggle in `[slug].astro` flips `document.body.dataset.read` between `zh` and `bilingual`, persisted to `localStorage`; CSS shows/hides `.seg-en` accordingly.
- `src/lib/markdown.ts` renders segment markdown through unified/remark/rehype **with `rehypeSanitize`** — segment HTML is always sanitized, `allowDangerousHtml: false`.

## Model / credentials

- Model: `google/gemini-3.8-flash` via **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`), plain `fetch` — no SDK. See `pipeline/translate.ts`.
- Credentials are the `OPENROUTER_API_KEY` environment variable. There is no credentials file.
- Translation style + the term glossary live in `pipeline/prompt.ts` and `pipeline/glossary.json`. Add domain terms to the glossary to keep translations consistent.

## Deploy

Cloudflare Pages: build `npm run build`, output `dist`, no env vars or secrets (translation is pre-baked into committed JSON).
