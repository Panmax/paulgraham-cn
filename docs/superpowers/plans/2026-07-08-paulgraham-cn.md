# paulgraham-cn.com Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a decoupled translation pipeline + Astro static site that renders Chinese translations of every Paul Graham essay, deployed to Cloudflare Pages.

**Architecture:** A local Node/TypeScript pipeline scrapes paulgraham.com, translates whole essays (with full-article context) via Gemini on Vertex AI, and writes structured per-article JSON into `content/articles/`. An Astro static site reads that JSON (never calling any API at build time) and generates one `.html` page per essay matching the original URL path. The two sides share one Zod schema module that defines the JSON contract.

**Tech Stack:** TypeScript, Astro 7, `@google/genai` 2.x (Vertex mode), Zod 4, cheerio (HTML parsing), unified/remark/rehype + rehype-sanitize (safe Markdown rendering), fastest-levenshtein (segment alignment), vitest (tests), tsx (running pipeline scripts).

## Global Constraints

- **Runtime:** Node.js ≥ 20 (native `fetch`, `crypto.subtle`/`node:crypto`). ESM only (`"type": "module"`).
- **Language:** TypeScript throughout. Pipeline runs via `tsx`. Tests via `vitest`.
- **Build calls no API:** The Astro build MUST NOT import `@google/genai` or hit the network. Translation happens only in `npm run translate`.
- **Model ID:** `gemini-3.5-flash` (exact string).
- **SDK:** `@google/genai` initialized in Vertex AI mode. Never `@google-cloud/vertexai`.
- **Credentials:** Service account at `credentials/gemini-vertex.json`, project `live-card-491105`, referenced via `GOOGLE_APPLICATION_CREDENTIALS`. `credentials/` is git-ignored — never commit it.
- **URL parity:** Article pages are emitted as `/<slug>.html` (e.g. `/earn.html`), matching paulgraham.com exactly. No redirects.
- **Single source of truth:** `content/articles/*.json`. `content/manifest.json` is a derived index written by the pipeline and committed; the Astro build only reads it.
- **Translatable segment types:** `paragraph | heading | list | quote | footnote`. Non-translatable: `hr | rawUnsupported` (no `zhMarkdown`, excluded from translation requests and validation).
- **Segment `id`s are stable:** never reassigned or reused across updates; new segments get `max(existingId) + 1`.
- **Homepage sort:** `publishedAt` descending, `sourceOrder` ascending as tie-break.

---

## File Structure

**Shared contract:**
- `shared/article-schema.ts` — Zod schemas + inferred TS types for Article, Segment, Manifest; `TRANSLATABLE_TYPES` constant.

**Pipeline (`pipeline/`):**
- `pipeline/fetch.ts` — `fetchHtml(url)` with retry/backoff.
- `pipeline/hash.ts` — `hashText(text)` → SHA-256 hex.
- `pipeline/date.ts` — `parsePublishedAt(dateText)` → ISO date string | null.
- `pipeline/parse-list.ts` — `parseArticleList(html)` → `ArticleListEntry[]`.
- `pipeline/parse-article.ts` — `parseArticle(html)` → `ParsedArticle`.
- `pipeline/align.ts` — `alignSegments(oldSegments, parsedSegments)` → `AlignedSegment[]`.
- `pipeline/translate.ts` — `translateSegments(...)` via `@google/genai`.
- `pipeline/validate.ts` — `validateTranslation(...)` quality gate.
- `pipeline/manifest.ts` — `buildManifest(articles)`.
- `pipeline/glossary.json` — term glossary.
- `pipeline/index.ts` — orchestrator (`npm run translate`).

**Astro site (`src/`):**
- `src/content.config.ts` — content collection using `glob()` + shared schema.
- `src/lib/markdown.ts` — `renderMarkdown(md)` safe HTML.
- `src/lib/sort.ts` — `sortArticles(entries)`.
- `src/layouts/Base.astro` — HTML shell, theme, fonts.
- `src/components/ArticleBody.astro` — renders segments + reading-mode markup.
- `src/pages/index.astro` — homepage list.
- `src/pages/[slug].html.astro` — article page.
- `src/styles/global.css` — minimal reading theme, light/dark.

**Config/root:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `astro.config.mjs`, `.gitignore`, `public/_headers` (optional caching), `README.md`.

---

## Phase 0 — Project Scaffolding

### Task 0: Repo scaffolding, tooling, and dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`
- Create: `content/articles/.gitkeep`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (vitest) and `npm run translate` (tsx) scripts; ESM+TS project other tasks build on.

- [ ] **Step 1: Create `.gitignore`**

```
credentials/
node_modules/
dist/
.astro/
.DS_Store
*.log
```

- [ ] **Step 2: Create `.nvmrc`**

```
20
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "paulgraham-cn",
  "type": "module",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "translate": "tsx pipeline/index.ts",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google/genai": "^2.10.0",
    "astro": "^7.0.6",
    "cheerio": "^1.2.0",
    "domhandler": "^5.0.3",
    "fastest-levenshtein": "^1.0.16",
    "p-limit": "^7.3.0",
    "rehype-sanitize": "^6.0.0",
    "rehype-stringify": "^10.0.1",
    "remark-parse": "^11.0.0",
    "remark-rehype": "^11.1.2",
    "unified": "^11.0.5",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "tsx": "^4.23.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["shared", "pipeline", "src"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Create placeholder `content/articles/.gitkeep`**

Empty file so the directory exists in git.

- [ ] **Step 7: Install and verify**

Run: `npm install && npx tsc --noEmit && npx vitest run --passWithNoTests`
Expected: install succeeds; `tsc` prints nothing (no source yet); vitest reports "No test files found" and exits 0 (thanks to `--passWithNoTests`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold TS project with vitest, tsx, and dependencies"
```

---

## Phase 1 — Shared Schema (the JSON contract)

### Task 1: Zod schema and types for Article, Segment, Manifest

**Files:**
- Create: `shared/article-schema.ts`
- Test: `shared/article-schema.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `SEGMENT_TYPES = ["paragraph","heading","hr","list","quote","footnote","rawUnsupported"] as const`
  - `TRANSLATABLE_TYPES: ReadonlySet<SegmentType>` = {paragraph, heading, list, quote, footnote}
  - `isTranslatable(type: SegmentType): boolean`
  - `SegmentSchema` (Zod), type `Segment = { id: number; type: SegmentType; sourceHash: string; enMarkdown?: string; zhMarkdown?: string }`
  - `ArticleSchema` (Zod), type `Article = { slug; titleEn; titleZh; dateText; publishedAt: string | null; sourceOrder: number; sourceUrl; translatedAt; model; segments: Segment[] }`
  - `ManifestEntrySchema`, type `ManifestEntry = { slug; titleZh; dateText; publishedAt: string | null; sourceOrder: number; translatedAt }`
  - `ManifestSchema` = `{ generatedAt: string; articles: ManifestEntry[] }`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/article-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  ArticleSchema,
  SegmentSchema,
  isTranslatable,
  TRANSLATABLE_TYPES,
} from "./article-schema.js";

describe("segment schema", () => {
  it("accepts a paragraph with both texts", () => {
    const seg = { id: 1, type: "paragraph", sourceHash: "abc", enMarkdown: "Hi", zhMarkdown: "你好" };
    expect(SegmentSchema.parse(seg)).toEqual(seg);
  });

  it("accepts an hr with no text fields", () => {
    const seg = { id: 3, type: "hr", sourceHash: "def" };
    expect(SegmentSchema.parse(seg).type).toBe("hr");
  });

  it("rejects an unknown segment type", () => {
    expect(() => SegmentSchema.parse({ id: 1, type: "table", sourceHash: "x" })).toThrow();
  });
});

describe("translatable helpers", () => {
  it("treats paragraph/heading/list/quote/footnote as translatable", () => {
    for (const t of ["paragraph", "heading", "list", "quote", "footnote"]) {
      expect(isTranslatable(t as any)).toBe(true);
    }
  });
  it("treats hr and rawUnsupported as non-translatable", () => {
    expect(isTranslatable("hr")).toBe(false);
    expect(isTranslatable("rawUnsupported")).toBe(false);
    expect(TRANSLATABLE_TYPES.has("hr")).toBe(false);
  });
});

describe("article schema", () => {
  it("parses a full article with null publishedAt", () => {
    const art = {
      slug: "earn", titleEn: "How to Earn", titleZh: "如何赚",
      dateText: "June 2026", publishedAt: null, sourceOrder: 214,
      sourceUrl: "https://paulgraham.com/earn.html",
      translatedAt: "2026-07-08", model: "gemini-3.5-flash",
      segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "a", zhMarkdown: "啊" }],
    };
    expect(ArticleSchema.parse(art).slug).toBe("earn");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/article-schema.test.ts`
Expected: FAIL — cannot resolve `./article-schema.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/article-schema.ts
import { z } from "zod";

export const SEGMENT_TYPES = [
  "paragraph", "heading", "hr", "list", "quote", "footnote", "rawUnsupported",
] as const;

export const SegmentTypeSchema = z.enum(SEGMENT_TYPES);
export type SegmentType = z.infer<typeof SegmentTypeSchema>;

export const TRANSLATABLE_TYPES: ReadonlySet<SegmentType> = new Set([
  "paragraph", "heading", "list", "quote", "footnote",
]);

export function isTranslatable(type: SegmentType): boolean {
  return TRANSLATABLE_TYPES.has(type);
}

export const SegmentSchema = z.object({
  id: z.number().int().positive(),
  type: SegmentTypeSchema,
  sourceHash: z.string().min(1),
  enMarkdown: z.string().optional(),
  zhMarkdown: z.string().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ArticleSchema = z.object({
  slug: z.string().min(1),
  titleEn: z.string(),
  titleZh: z.string(),
  dateText: z.string(),
  publishedAt: z.string().nullable(),
  sourceOrder: z.number().int().nonnegative(),
  sourceUrl: z.string().url(),
  translatedAt: z.string(),
  model: z.string(),
  segments: z.array(SegmentSchema),
});
export type Article = z.infer<typeof ArticleSchema>;

export const ManifestEntrySchema = z.object({
  slug: z.string(),
  titleZh: z.string(),
  dateText: z.string(),
  publishedAt: z.string().nullable(),
  sourceOrder: z.number().int().nonnegative(),
  translatedAt: z.string(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  generatedAt: z.string(),
  articles: z.array(ManifestEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/article-schema.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add shared/article-schema.ts shared/article-schema.test.ts
git commit -m "feat: shared Zod schema for article/segment/manifest contract"
```

---

## Phase 2 — Pipeline: fetch, hash, date, parsing

### Task 2: HTTP fetch with retry/backoff

**Files:**
- Create: `pipeline/fetch.ts`
- Test: `pipeline/fetch.test.ts`

**Interfaces:**
- Consumes: global `fetch`.
- Produces: `fetchHtml(url: string, opts?: { retries?: number; baseDelayMs?: number; fetchImpl?: typeof fetch }): Promise<string>` — returns response body text; throws after exhausting retries. `fetchImpl` is injectable for tests.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/fetch.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchHtml } from "./fetch.js";

function res(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body } as unknown as Response;
}

describe("fetchHtml", () => {
  it("returns body text on success", async () => {
    const impl = vi.fn().mockResolvedValue(res("<html>hi</html>"));
    const out = await fetchHtml("https://x.test", { fetchImpl: impl });
    expect(out).toBe("<html>hi</html>");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    const impl = vi.fn()
      .mockResolvedValueOnce(res("", false, 503))
      .mockResolvedValueOnce(res("ok"));
    const out = await fetchHtml("https://x.test", { fetchImpl: impl, retries: 2, baseDelayMs: 0 });
    expect(out).toBe("ok");
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const impl = vi.fn().mockResolvedValue(res("", false, 500));
    await expect(fetchHtml("https://x.test", { fetchImpl: impl, retries: 2, baseDelayMs: 0 }))
      .rejects.toThrow(/failed/i);
    expect(impl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/fetch.test.ts`
Expected: FAIL — cannot resolve `./fetch.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/fetch.ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(
  url: string,
  opts: { retries?: number; baseDelayMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const { retries = 3, baseDelayMs = 500, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchImpl(url);
      if (resp.ok) return await resp.text();
      lastErr = new Error(`fetch failed: ${resp.status} for ${url}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
  }
  throw new Error(`fetchHtml failed for ${url}: ${String(lastErr)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/fetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/fetch.ts pipeline/fetch.test.ts
git commit -m "feat: fetchHtml with exponential backoff"
```

---

### Task 3: Segment hashing

**Files:**
- Create: `pipeline/hash.ts`
- Test: `pipeline/hash.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `hashText(text: string): string` — SHA-256 hex of the input's normalized form (trim + collapse internal whitespace runs to single spaces) so cosmetic whitespace changes don't trigger re-translation.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/hash.test.ts
import { describe, it, expect } from "vitest";
import { hashText } from "./hash.js";

describe("hashText", () => {
  it("is deterministic and 64 hex chars", () => {
    const h = hashText("Hello world");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashText("Hello world")).toBe(h);
  });

  it("ignores leading/trailing and collapsed whitespace", () => {
    expect(hashText("  Hello   world ")).toBe(hashText("Hello world"));
  });

  it("differs for different content", () => {
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/hash.test.ts`
Expected: FAIL — cannot resolve `./hash.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/hash.ts
import { createHash } from "node:crypto";

export function hashText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/hash.ts pipeline/hash.test.ts
git commit -m "feat: whitespace-normalized SHA-256 segment hashing"
```

---

### Task 4: Date parsing

**Files:**
- Create: `pipeline/date.ts`
- Test: `pipeline/date.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parsePublishedAt(dateText: string): string | null` — parses PG date strings like `"July 2023"`, `"June 2026"`, `"January 2004"`, or `"March 2024"` into an ISO date `YYYY-MM-01`; returns `null` when no `Month YYYY` can be found.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/date.test.ts
import { describe, it, expect } from "vitest";
import { parsePublishedAt } from "./date.js";

describe("parsePublishedAt", () => {
  it("parses 'July 2023'", () => {
    expect(parsePublishedAt("July 2023")).toBe("2023-07-01");
  });
  it("parses when date is embedded in a longer string", () => {
    expect(parsePublishedAt("June 2026\n\nWhen I was young")).toBe("2026-06-01");
  });
  it("parses single-digit month zero-padded", () => {
    expect(parsePublishedAt("March 2024")).toBe("2024-03-01");
  });
  it("returns null when no month/year present", () => {
    expect(parsePublishedAt("Some intro text")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/date.test.ts`
Expected: FAIL — cannot resolve `./date.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/date.ts
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

export function parsePublishedAt(dateText: string): string | null {
  const m = dateText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return `${m[2]}-${month}-01`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/date.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/date.ts pipeline/date.test.ts
git commit -m "feat: parse PG 'Month YYYY' dates to ISO"
```

---

### Task 5: Parse the articles list page

**Files:**
- Create: `pipeline/parse-list.ts`
- Test: `pipeline/parse-list.test.ts`

**Interfaces:**
- Consumes: `cheerio`.
- Produces:
  - type `ArticleListEntry = { slug: string; titleEn: string; sourceUrl: string; sourceOrder: number }`
  - `parseArticleList(html: string): ArticleListEntry[]` — extracts links matching a bare `<slug>.html` (relative, lowercase-ish essay slugs), skipping navigation/external/known non-essay links. `sourceOrder` is the index in document order (0-based). Dedupes by slug (first occurrence wins).

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/parse-list.test.ts
import { describe, it, expect } from "vitest";
import { parseArticleList } from "./parse-list.js";

const SAMPLE = `
<html><body>
<a href="index.html">home</a>
<a href="earn.html">How to Earn a Billion Dollars</a>
<a href="greatwork.html">How to Do Great Work</a>
<a href="https://twitter.com/paulg">twitter</a>
<a href="earn.html">dup should be ignored</a>
<a href="rss.html">RSS</a>
</body></html>`;

describe("parseArticleList", () => {
  it("extracts essay entries in order with sourceOrder", () => {
    const out = parseArticleList(SAMPLE);
    const slugs = out.map((e) => e.slug);
    expect(slugs).toContain("earn");
    expect(slugs).toContain("greatwork");
    expect(out.find((e) => e.slug === "earn")).toMatchObject({
      slug: "earn",
      titleEn: "How to Earn a Billion Dollars",
      sourceUrl: "https://paulgraham.com/earn.html",
      sourceOrder: 0,
    });
  });

  it("excludes navigation and external links", () => {
    const slugs = parseArticleList(SAMPLE).map((e) => e.slug);
    expect(slugs).not.toContain("index");
    expect(slugs).not.toContain("rss");
  });

  it("dedupes repeated slugs keeping the first", () => {
    const earn = parseArticleList(SAMPLE).filter((e) => e.slug === "earn");
    expect(earn).toHaveLength(1);
    expect(earn[0].titleEn).toBe("How to Earn a Billion Dollars");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/parse-list.test.ts`
Expected: FAIL — cannot resolve `./parse-list.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/parse-list.ts
import * as cheerio from "cheerio";

export type ArticleListEntry = {
  slug: string;
  titleEn: string;
  sourceUrl: string;
  sourceOrder: number;
};

// Navigation / non-essay pages that live at bare *.html but are not essays.
const EXCLUDED_SLUGS = new Set([
  "index", "articles", "books", "arc", "bel", "lisp", "antispam",
  "kedrosky", "faq", "raq", "quo", "rss", "bio",
]);

export function parseArticleList(html: string): ArticleListEntry[] {
  const $ = cheerio.load(html);
  const entries: ArticleListEntry[] = [];
  const seen = new Set<string>();
  let order = 0;

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const m = href.match(/^([a-z][a-z0-9]*)\.html$/i);
    if (!m) return; // skip external, absolute, and non-.html links
    const slug = m[1].toLowerCase();
    if (EXCLUDED_SLUGS.has(slug) || seen.has(slug)) return;
    const titleEn = $(el).text().trim();
    if (!titleEn) return;
    seen.add(slug);
    entries.push({
      slug,
      titleEn,
      sourceUrl: `https://paulgraham.com/${slug}.html`,
      sourceOrder: order++,
    });
  });

  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/parse-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/parse-list.ts pipeline/parse-list.test.ts
git commit -m "feat: parse PG articles.html into ordered essay list"
```

---

### Task 6: Parse a single article page into segments

**Files:**
- Create: `pipeline/parse-article.ts`
- Test: `pipeline/parse-article.test.ts`

**Interfaces:**
- Consumes: `cheerio`, `domhandler` (for the `AnyNode` type — pinned to `^5.0.3` in Task 0 to match cheerio 1.2's transitive version, so there's only one `AnyNode` type in the tree; never rely on the package manager hoisting it), `pipeline/hash.ts` (`hashText`), `pipeline/date.ts` (`parsePublishedAt`), `shared/article-schema.ts` (`SegmentType`).
- Produces:
  - type `ParsedSegment = { type: SegmentType; enMarkdown?: string; sourceHash: string }`
  - type `ParsedArticle = { titleEn: string; dateText: string; publishedAt: string | null; segments: ParsedSegment[] }`
  - `parseArticle(html: string, fallbackTitle: string): ParsedArticle` — finds the essay body (the `<font size="2">` block), splits on `<br><br>` into blocks, and classifies each block into a segment:
    - `<hr>` → `hr` (no text).
    - a block whose sole element is `<blockquote>` → `quote` (`enMarkdown` is the quote text prefixed with `> ` per line).
    - a block whose sole element is `<ul>`/`<ol>` → `list` (`enMarkdown` is Markdown list lines, `-`/`1.`).
    - a block whose sole element is `<table>`/`<pre>` (things we can't faithfully convert) → `rawUnsupported` (`enMarkdown` is the block's plain text, preserved untranslated and surfaced in the run summary).
    - everything else → `paragraph`, converting inline `<a href>`/`<i>`/`<b>` to Markdown.
  - Title comes from the title `.gif`'s `alt` (falling back to `<title>` then `fallbackTitle`); `dateText`/`publishedAt` from the leading date line.
  - Footnote blocks (PG's `Notes` section and `[1]`-style references) are ordinary prose and remain `paragraph` — they translate fine and need no special type.

**Notes for implementer (verified against live HTML):**
- Title is an `<img ... alt="How to Do Great Work" ...>` gif; `<title>` tag also holds it.
- Body is inside `<font size="2" face="verdana">`; the first text run is the date (e.g. `July 2023`), then `<br><br>`-separated paragraphs.
- Inline links look like `<a href="foo.html">text</a>`; relative hrefs must be absolutized to `https://paulgraham.com/foo.html`.
- Real PG essays contain `<blockquote>`, occasional `<ul>/<li>`, `<table>` (layout/figures), and a footnotes section — verified live. The block classifier above is why the `quote`/`list`/`rawUnsupported` types are exercised rather than dead.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/parse-article.test.ts
import { describe, it, expect } from "vitest";
import { parseArticle } from "./parse-article.js";

const SAMPLE = `<html><head><title>How to Do Great Work</title></head>
<body><table><tr><td>
<img src="x/how-to-do-great-work-2.gif" alt="How to Do Great Work" />
<font size="2" face="verdana">July 2023<br /><br />First paragraph with a <a href="foo.html">link</a> inside.<br /><br />Second paragraph is <i>emphasized</i> here.<br /><br /><hr /><br /><br />After the rule.</font>
</td></tr></table></body></html>`;

describe("parseArticle", () => {
  it("extracts title from alt/title", () => {
    expect(parseArticle(SAMPLE, "fallback").titleEn).toBe("How to Do Great Work");
  });

  it("extracts dateText and publishedAt", () => {
    const a = parseArticle(SAMPLE, "fallback");
    expect(a.dateText).toBe("July 2023");
    expect(a.publishedAt).toBe("2023-07-01");
  });

  it("splits paragraphs and converts inline links to markdown", () => {
    const a = parseArticle(SAMPLE, "fallback");
    const paras = a.segments.filter((s) => s.type === "paragraph");
    expect(paras[0].enMarkdown).toBe(
      "First paragraph with a [link](https://paulgraham.com/foo.html) inside."
    );
    expect(paras.some((p) => p.enMarkdown?.includes("*emphasized*"))).toBe(true);
  });

  it("emits an hr segment", () => {
    const a = parseArticle(SAMPLE, "fallback");
    expect(a.segments.some((s) => s.type === "hr")).toBe(true);
  });

  it("gives every segment a non-empty sourceHash", () => {
    const a = parseArticle(SAMPLE, "fallback");
    expect(a.segments.every((s) => /^[0-9a-f]{64}$/.test(s.sourceHash))).toBe(true);
  });

  it("does not include the date line as a body paragraph", () => {
    const a = parseArticle(SAMPLE, "fallback");
    const paras = a.segments.filter((s) => s.type === "paragraph");
    expect(paras[0].enMarkdown?.startsWith("July 2023")).toBe(false);
  });
});

const STRUCTURED = `<html><head><title>T</title></head><body>
<font size="2" face="verdana">May 2020<br /><br />Intro paragraph.<br /><br /><blockquote>The best lack all conviction.</blockquote><br /><br /><ul><li>first item</li><li>second item</li></ul><br /><br /><table><tr><td>col a</td><td>col b</td></tr></table><br /><br />Closing paragraph.</font>
</body></html>`;

describe("parseArticle block types", () => {
  it("maps blockquote to a quote segment", () => {
    const q = parseArticle(STRUCTURED, "T").segments.find((s) => s.type === "quote");
    expect(q?.enMarkdown).toBe("> The best lack all conviction.");
  });

  it("maps ul to a list segment with markdown bullets", () => {
    const l = parseArticle(STRUCTURED, "T").segments.find((s) => s.type === "list");
    expect(l?.enMarkdown).toBe("- first item\n- second item");
  });

  it("maps an unconvertible table to rawUnsupported preserving its text", () => {
    const r = parseArticle(STRUCTURED, "T").segments.find((s) => s.type === "rawUnsupported");
    expect(r).toBeDefined();
    expect(r?.enMarkdown).toContain("col a");
  });

  it("still classifies ordinary blocks as paragraphs", () => {
    const paras = parseArticle(STRUCTURED, "T").segments.filter((s) => s.type === "paragraph");
    expect(paras.some((p) => p.enMarkdown === "Intro paragraph.")).toBe(true);
    expect(paras.some((p) => p.enMarkdown === "Closing paragraph.")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/parse-article.test.ts`
Expected: FAIL — cannot resolve `./parse-article.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/parse-article.ts
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { hashText } from "./hash.js";
import { parsePublishedAt } from "./date.js";
import type { SegmentType } from "../shared/article-schema.js";

export type ParsedSegment = {
  type: SegmentType;
  enMarkdown?: string;
  sourceHash: string;
};

export type ParsedArticle = {
  titleEn: string;
  dateText: string;
  publishedAt: string | null;
  segments: ParsedSegment[];
};

function absolutize(href: string): string {
  if (/^[a-z][a-z0-9]*\.html$/i.test(href)) return `https://paulgraham.com/${href}`;
  return href;
}

// Convert an inline HTML fragment (children of the body font block, within one
// paragraph) into Markdown text.
function inlineToMarkdown($: cheerio.CheerioAPI, nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += (node.data ?? "").replace(/\s+/g, " ");
    } else if (node.type === "tag") {
      const el = $(node);
      if (node.name === "a") {
        out += `[${el.text().trim()}](${absolutize(el.attr("href") ?? "")})`;
      } else if (node.name === "i" || node.name === "em") {
        out += `*${el.text().trim()}*`;
      } else if (node.name === "b" || node.name === "strong") {
        out += `**${el.text().trim()}**`;
      } else {
        out += el.text();
      }
    }
  }
  return out.trim();
}

export function parseArticle(html: string, fallbackTitle: string): ParsedArticle {
  const $ = cheerio.load(html);

  const titleEn =
    ($("img[alt]").filter((_, el) => ($(el).attr("alt") ?? "").length > 3).first().attr("alt")
      ?? $("title").text().trim()
      ?? fallbackTitle).trim() || fallbackTitle;

  const font = $('font[size="2"]').first();
  const container = font.length ? font : $("body");

  // Serialize inner HTML and split on <br><br> boundaries.
  const inner = container.html() ?? "";
  const blocks = inner
    .split(/<br\s*\/?>\s*<br\s*\/?>/i)
    .map((b) => b.trim())
    .filter(Boolean);

  const segments: ParsedSegment[] = [];
  let dateText = "";
  let publishedAt: string | null = null;

  // Convert an <ul>/<ol> element into Markdown list text.
  function listToMarkdown(frag: cheerio.CheerioAPI, listEl: AnyNode): string {
    const ordered = (listEl as { name?: string }).name === "ol";
    const lines: string[] = [];
    frag(listEl).children("li").each((i, li) => {
      const text = inlineToMarkdown(frag, li.children as AnyNode[]);
      lines.push(`${ordered ? `${i + 1}.` : "-"} ${text}`);
    });
    return lines.join("\n");
  }

  blocks.forEach((block, idx) => {
    if (/^<hr\s*\/?>$/i.test(block)) {
      segments.push({ type: "hr", sourceHash: hashText("hr:" + idx) });
      return;
    }

    const frag = cheerio.load(`<div>${block}</div>`);
    const root = frag("div")[0];
    const nodes = root.children as AnyNode[];

    // A block whose sole meaningful element is a structural tag gets that type.
    const tagChildren = nodes.filter((n) => n.type === "tag") as Array<AnyNode & { name: string }>;
    const soleTag = tagChildren.length === 1 && !nodes.some(
      (n) => n.type === "text" && (n.data ?? "").trim(),
    ) ? tagChildren[0] : null;

    if (soleTag && soleTag.name === "blockquote") {
      const md = inlineToMarkdown(frag, soleTag.children as AnyNode[])
        .split("\n").map((l) => `> ${l.trim()}`).join("\n");
      if (md.trim()) segments.push({ type: "quote", enMarkdown: md, sourceHash: hashText(md) });
      return;
    }
    if (soleTag && (soleTag.name === "ul" || soleTag.name === "ol")) {
      const md = listToMarkdown(frag, soleTag);
      if (md.trim()) segments.push({ type: "list", enMarkdown: md, sourceHash: hashText(md) });
      return;
    }
    // Blocks built from tags we cannot faithfully convert (e.g. tables) are
    // preserved verbatim as rawUnsupported so they surface in the run summary
    // instead of being silently flattened into prose.
    if (soleTag && (soleTag.name === "table" || soleTag.name === "pre")) {
      const raw = frag(soleTag).text().trim();
      segments.push({ type: "rawUnsupported", enMarkdown: raw, sourceHash: hashText("raw:" + idx + raw) });
      return;
    }

    const md = inlineToMarkdown(frag, nodes);
    if (!md) return;

    if (idx === 0) {
      // First block leads with the date line.
      const parsed = parsePublishedAt(md);
      if (parsed) {
        publishedAt = parsed;
        const dm = md.match(/\b[A-Z][a-z]+\s+\d{4}\b/);
        dateText = dm ? dm[0] : "";
        const rest = md.replace(/^.*?\d{4}\s*/, "").trim();
        if (rest) segments.push({ type: "paragraph", enMarkdown: rest, sourceHash: hashText(rest) });
        return;
      }
    }
    segments.push({ type: "paragraph", enMarkdown: md, sourceHash: hashText(md) });
  });

  return { titleEn, dateText, publishedAt, segments };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/parse-article.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor check**

Confirm no unused imports; run `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add pipeline/parse-article.ts pipeline/parse-article.test.ts
git commit -m "feat: parse PG article HTML into markdown segments"
```

---

## Phase 3 — Pipeline: segment alignment

### Task 7: Segment alignment algorithm

**Files:**
- Create: `pipeline/align.ts`
- Test: `pipeline/align.test.ts`

**Interfaces:**
- Consumes: `fastest-levenshtein` (`distance`), `shared/article-schema.ts` (`Segment`), `pipeline/parse-article.ts` (`ParsedSegment`).
- Produces:
  - type `Disposition = "unchanged" | "changed" | "new"`
  - type `AlignedSegment = { segment: Segment; disposition: Disposition }` where `segment` carries the resolved `id`, `type`, `sourceHash`, `enMarkdown`, and (for unchanged) the preserved `zhMarkdown`; `changed`/`new` carry `zhMarkdown: undefined` pending translation.
  - `alignSegments(oldSegments: Segment[], parsed: ParsedSegment[]): { aligned: AlignedSegment[]; nextId: number }`
  - Algorithm: (1) LCS on `sourceHash` to anchor unchanged segments (preserve their `id` + `zhMarkdown`); (2) the anchors partition both sequences into aligned gaps — for each gap, match unanchored parsed segments **only against the old segments in that same gap** by normalized Levenshtein similarity ≥ 0.5 on `enMarkdown` → `changed` (inherit that old `id`); else `new` (fresh id from a counter starting at `max(oldId)+1`). Gap-confinement is required: a global best-match would let a similar/duplicate segment in another region steal an id and overwrite the wrong segment's human translation. (3) old segments in a gap that go unclaimed are dropped (deletion). Output preserves parsed order.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/align.test.ts
import { describe, it, expect } from "vitest";
import { alignSegments } from "./align.js";
import type { Segment } from "../shared/article-schema.js";

const old: Segment[] = [
  { id: 1, type: "paragraph", sourceHash: "h1", enMarkdown: "Alpha one two three", zhMarkdown: "甲" },
  { id: 2, type: "paragraph", sourceHash: "h2", enMarkdown: "Beta four five six", zhMarkdown: "乙" },
  { id: 3, type: "paragraph", sourceHash: "h3", enMarkdown: "Gamma seven eight", zhMarkdown: "丙" },
];

describe("alignSegments", () => {
  it("keeps unchanged segments with id and zh preserved", () => {
    const parsed = old.map((s) => ({ type: s.type, enMarkdown: s.enMarkdown, sourceHash: s.sourceHash }));
    const { aligned } = alignSegments(old, parsed);
    expect(aligned.map((a) => a.disposition)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(aligned[0].segment.zhMarkdown).toBe("甲");
    expect(aligned[0].segment.id).toBe(1);
  });

  it("detects a changed segment and inherits its id, clears zh", () => {
    const parsed = [
      { type: "paragraph" as const, enMarkdown: "Alpha one two three", sourceHash: "h1" },
      { type: "paragraph" as const, enMarkdown: "Beta four five six EDITED", sourceHash: "h2new" },
      { type: "paragraph" as const, enMarkdown: "Gamma seven eight", sourceHash: "h3" },
    ];
    const { aligned } = alignSegments(old, parsed);
    expect(aligned[1].disposition).toBe("changed");
    expect(aligned[1].segment.id).toBe(2);
    expect(aligned[1].segment.zhMarkdown).toBeUndefined();
    expect(aligned[1].segment.sourceHash).toBe("h2new");
  });

  it("assigns a fresh id to an inserted new segment without shifting others", () => {
    const parsed = [
      { type: "paragraph" as const, enMarkdown: "Alpha one two three", sourceHash: "h1" },
      { type: "paragraph" as const, enMarkdown: "Totally brand new content here", sourceHash: "hNew" },
      { type: "paragraph" as const, enMarkdown: "Beta four five six", sourceHash: "h2" },
      { type: "paragraph" as const, enMarkdown: "Gamma seven eight", sourceHash: "h3" },
    ];
    const { aligned, nextId } = alignSegments(old, parsed);
    expect(aligned[1].disposition).toBe("new");
    expect(aligned[1].segment.id).toBe(4);
    expect(aligned[0].segment.id).toBe(1);
    expect(aligned[2].segment.id).toBe(2);
    expect(nextId).toBe(5);
  });

  it("treats everything as new when there is no old article", () => {
    const parsed = [{ type: "paragraph" as const, enMarkdown: "x", sourceHash: "hx" }];
    const { aligned } = alignSegments([], parsed);
    expect(aligned[0].disposition).toBe("new");
    expect(aligned[0].segment.id).toBe(1);
  });

  it("confines similarity matching to the gap between anchors (no cross-region id theft)", () => {
    // old: A X B Y C ; new: A B Y' C. Anchors A,B,C match by hash. Y' is a light
    // edit of Y and sits in the B..C gap — it must inherit Y's id (40), NOT steal
    // X's id (20) even though X is also unclaimed. X is deleted.
    const oldSegs: Segment[] = [
      { id: 10, type: "paragraph", sourceHash: "hA", enMarkdown: "A anchor alpha", zhMarkdown: "甲" },
      { id: 20, type: "paragraph", sourceHash: "hX", enMarkdown: "Yankee zulu common words here", zhMarkdown: "X译" },
      { id: 30, type: "paragraph", sourceHash: "hB", enMarkdown: "B anchor bravo", zhMarkdown: "乙" },
      { id: 40, type: "paragraph", sourceHash: "hY", enMarkdown: "Yankee zulu common words there", zhMarkdown: "Y译" },
      { id: 50, type: "paragraph", sourceHash: "hC", enMarkdown: "C anchor charlie", zhMarkdown: "丙" },
    ];
    const parsed = [
      { type: "paragraph" as const, enMarkdown: "A anchor alpha", sourceHash: "hA" },
      { type: "paragraph" as const, enMarkdown: "B anchor bravo", sourceHash: "hB" },
      { type: "paragraph" as const, enMarkdown: "Yankee zulu common words there EDITED", sourceHash: "hYnew" },
      { type: "paragraph" as const, enMarkdown: "C anchor charlie", sourceHash: "hC" },
    ];
    const { aligned } = alignSegments(oldSegs, parsed);
    const yPrime = aligned[2];
    expect(yPrime.disposition).toBe("changed");
    expect(yPrime.segment.id).toBe(40); // inherited Y, not X's 20
    // X (id 20) is unmatched → deleted → never appears in output.
    expect(aligned.some((a) => a.segment.id === 20)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/align.test.ts`
Expected: FAIL — cannot resolve `./align.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/align.ts
import { distance } from "fastest-levenshtein";
import type { Segment } from "../shared/article-schema.js";
import type { ParsedSegment } from "./parse-article.js";

export type Disposition = "unchanged" | "changed" | "new";
export type AlignedSegment = { segment: Segment; disposition: Disposition };

const SIMILARITY_THRESHOLD = 0.5;

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const d = distance(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

// Longest common subsequence over sourceHash, returning matched index pairs.
function lcsPairs(oldHashes: string[], newHashes: string[]): Array<[number, number]> {
  const m = oldHashes.length, n = newHashes.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldHashes[i] === newHashes[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (oldHashes[i] === newHashes[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

export function alignSegments(
  oldSegments: Segment[],
  parsed: ParsedSegment[],
): { aligned: AlignedSegment[]; nextId: number } {
  let nextId = oldSegments.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  const oldHashes = oldSegments.map((s) => s.sourceHash);
  const newHashes = parsed.map((s) => s.sourceHash);

  const anchors = lcsPairs(oldHashes, newHashes); // increasing in both indices
  const aligned: AlignedSegment[] = new Array(parsed.length);

  // Fill anchored (unchanged) positions.
  for (const [oi, nj] of anchors) {
    const old = oldSegments[oi];
    const p = parsed[nj];
    aligned[nj] = {
      segment: { ...old, type: p.type, enMarkdown: p.enMarkdown, sourceHash: p.sourceHash },
      disposition: "unchanged",
    };
  }

  // Walk the gaps between consecutive anchors (with sentinels at both ends).
  // Similarity matching is confined to each gap so a similar/duplicate segment
  // in a different region can never steal an id and overwrite the wrong
  // segment's human translation.
  const bounded: Array<[number, number]> = [
    [-1, -1], ...anchors, [oldSegments.length, parsed.length],
  ];
  for (let k = 0; k < bounded.length - 1; k++) {
    const [oiA, njA] = bounded[k];
    const [oiB, njB] = bounded[k + 1];
    const gapOld: number[] = [];
    for (let oi = oiA + 1; oi < oiB; oi++) gapOld.push(oi);
    const claimed = new Set<number>();

    for (let nj = njA + 1; nj < njB; nj++) {
      const p = parsed[nj];
      let best = -1, bestScore = 0;
      for (const oi of gapOld) {
        if (claimed.has(oi)) continue;
        const score = similarity(p.enMarkdown ?? "", oldSegments[oi].enMarkdown ?? "");
        if (score > bestScore) { bestScore = score; best = oi; }
      }
      if (best >= 0 && bestScore >= SIMILARITY_THRESHOLD) {
        claimed.add(best);
        aligned[nj] = {
          segment: {
            id: oldSegments[best].id,
            type: p.type,
            sourceHash: p.sourceHash,
            enMarkdown: p.enMarkdown,
            zhMarkdown: undefined,
          },
          disposition: "changed",
        };
      } else {
        aligned[nj] = {
          segment: { id: nextId++, type: p.type, sourceHash: p.sourceHash, enMarkdown: p.enMarkdown, zhMarkdown: undefined },
          disposition: "new",
        };
      }
    }
  }
  // gapOld indices left unclaimed correspond to deleted old segments (omitted).

  return { aligned, nextId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/align.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add pipeline/align.ts pipeline/align.test.ts
git commit -m "feat: LCS + similarity segment alignment preserving ids and translations"
```

---

## Phase 4 — Pipeline: translation + quality gate

### Task 8: Translation quality gate (validation)

**Files:**
- Create: `pipeline/validate.ts`
- Test: `pipeline/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `extractLinkUrls(md: string): string[]` — all URLs from Markdown `[text](url)` links, sorted.
  - `extractNumbers(md: string): string[]` — all numeric tokens, sorted.
  - type `TranslationCheck = { ok: boolean; errors: string[] }`
  - `validateTranslation(requested: Array<{ id: number; enMarkdown: string }>, returned: Array<{ id: number; zhMarkdown: string }>): TranslationCheck` — verifies (a) returned id set === requested id set; (b) per segment the link-URL set matches between en and zh; (c) per segment every number in en also appears in zh.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/validate.test.ts
import { describe, it, expect } from "vitest";
import { extractLinkUrls, extractNumbers, validateTranslation } from "./validate.js";

describe("extractors", () => {
  it("extracts link urls", () => {
    expect(extractLinkUrls("see [a](https://x.com/1) and [b](https://y.com)")).toEqual([
      "https://x.com/1", "https://y.com",
    ]);
  });
  it("extracts numbers", () => {
    expect(extractNumbers("in 1995 there were 3 things")).toEqual(["1995", "3"]);
  });
});

describe("validateTranslation", () => {
  const req = [{ id: 1, enMarkdown: "In 2005 see [YC](https://ycombinator.com)." }];

  it("passes when ids, links, numbers all preserved", () => {
    const ret = [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }];
    expect(validateTranslation(req, ret).ok).toBe(true);
  });
  it("fails when an id is missing", () => {
    expect(validateTranslation(req, []).ok).toBe(false);
  });
  it("fails when a link is dropped", () => {
    const ret = [{ id: 1, zhMarkdown: "2005 年参见 YC。" }];
    const r = validateTranslation(req, ret);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/link/i);
  });
  it("fails when a number is dropped", () => {
    const ret = [{ id: 1, zhMarkdown: "某年参见 [YC](https://ycombinator.com)。" }];
    expect(validateTranslation(req, ret).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/validate.test.ts`
Expected: FAIL — cannot resolve `./validate.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/validate.ts
export function extractLinkUrls(md: string): string[] {
  const urls: string[] = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) urls.push(m[1].trim());
  return urls.sort();
}

export function extractNumbers(md: string): string[] {
  return (md.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "")).sort();
}

export type TranslationCheck = { ok: boolean; errors: string[] };

export function validateTranslation(
  requested: Array<{ id: number; enMarkdown: string }>,
  returned: Array<{ id: number; zhMarkdown: string }>,
): TranslationCheck {
  const errors: string[] = [];
  const reqIds = new Set(requested.map((r) => r.id));
  const retIds = new Set(returned.map((r) => r.id));
  for (const id of reqIds) if (!retIds.has(id)) errors.push(`missing translation for id ${id}`);
  for (const id of retIds) if (!reqIds.has(id)) errors.push(`unexpected id ${id} in output`);

  const retById = new Map(returned.map((r) => [r.id, r.zhMarkdown]));
  for (const r of requested) {
    const zh = retById.get(r.id);
    if (zh === undefined) continue;
    const enLinks = extractLinkUrls(r.enMarkdown);
    const zhLinks = extractLinkUrls(zh);
    if (JSON.stringify(enLinks) !== JSON.stringify(zhLinks)) {
      errors.push(`link mismatch in id ${r.id}: [${enLinks}] vs [${zhLinks}]`);
    }
    const enNums = extractNumbers(r.enMarkdown);
    for (const n of enNums) if (!zh.includes(n)) errors.push(`number ${n} missing in id ${r.id}`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/validate.ts pipeline/validate.test.ts
git commit -m "feat: translation quality gate (id/link/number checks)"
```

---

### Task 9: Glossary + system prompt builder

**Files:**
- Create: `pipeline/glossary.json`
- Create: `pipeline/prompt.ts`
- Test: `pipeline/prompt.test.ts`

**Interfaces:**
- Consumes: `pipeline/glossary.json`.
- Produces:
  - `buildSystemPrompt(): string` — the 信达雅 translator persona + glossary + few-shot, embedding the glossary terms and instructing the model to return only `{ segments: [{ id, zhMarkdown }] }` for the requested ids, preserving Markdown links verbatim.
  - `buildUserPayload(context: Array<{ id: number; enMarkdown: string }>, toTranslateIds: number[]): string` — JSON string giving the full-article context plus the explicit list of ids to translate.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPayload } from "./prompt.js";

describe("prompt builders", () => {
  it("system prompt mentions 信达雅 and a glossary term", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/信达雅|信、达、雅/);
    expect(p).toMatch(/创业公司|黑客/); // at least one glossary term rendered
    expect(p).toMatch(/zhMarkdown/); // output contract stated
  });

  it("user payload includes full context and the ids to translate", () => {
    const payload = buildUserPayload(
      [{ id: 1, enMarkdown: "A" }, { id: 2, enMarkdown: "B" }],
      [2],
    );
    const parsed = JSON.parse(payload);
    expect(parsed.context).toHaveLength(2);
    expect(parsed.translateIds).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/prompt.test.ts`
Expected: FAIL — cannot resolve `./prompt.js`.

- [ ] **Step 3: Create `pipeline/glossary.json`**

```json
{
  "startup": "创业公司",
  "hacker": "黑客",
  "founder": "创始人",
  "essay": "文章",
  "programmer": "程序员",
  "venture capital": "风险投资",
  "angel investor": "天使投资人"
}
```

- [ ] **Step 4: Write minimal implementation**

```typescript
// pipeline/prompt.ts
import glossary from "./glossary.json" with { type: "json" };

export function buildSystemPrompt(): string {
  const terms = Object.entries(glossary as Record<string, string>)
    .map(([en, zh]) => `- ${en} → ${zh}`)
    .join("\n");

  return `你是一位深谙中英双语、熟悉 Paul Graham 思想与创业/技术语境的资深译者。
你的目标是让中文读者读起来像 Paul Graham 本人用中文写作，追求信达雅：
- 信：准确传达原意与逻辑，不漏译、不曲解、不自行发挥。
- 达：符合中文表达习惯，破除英文长句的从句嵌套，重组为地道流畅的中文，而非逐词硬译。
- 雅：保留 PG 简洁、平实、犀利又不失幽默的文风。

术语表（务必统一使用）：
${terms}

规则：
- 保留 Markdown 行内链接，URL 原样不动，例如 [text](https://paulgraham.com/foo.html)。
- 保留所有数字与专有名词。
- 你会收到整篇文章作为上下文（context），但只需翻译 translateIds 指定的段落。
- 只返回 JSON：{ "segments": [{ "id": <number>, "zhMarkdown": "<译文>" }] }，
  且仅包含 translateIds 中的 id，数量与之完全一致。`;
}

export function buildUserPayload(
  context: Array<{ id: number; enMarkdown: string }>,
  toTranslateIds: number[],
): string {
  return JSON.stringify({ context, translateIds: toTranslateIds });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run pipeline/prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pipeline/glossary.json pipeline/prompt.ts pipeline/prompt.test.ts
git commit -m "feat: glossary and 信达雅 prompt builders"
```

---

### Task 10: Gemini translation client (Vertex)

**Files:**
- Create: `pipeline/translate.ts`
- Test: `pipeline/translate.test.ts`

**Interfaces:**
- Consumes: `@google/genai`, `pipeline/prompt.ts`, `pipeline/validate.ts`.
- Produces:
  - type `TranslatorDeps = { generate: (system: string, user: string) => Promise<string> }` — injectable model call returning raw JSON text (real impl wraps `@google/genai`).
  - `createVertexTranslator(): TranslatorDeps` — builds the real client from env (`GOOGLE_APPLICATION_CREDENTIALS`, project `live-card-491105`, model `gemini-3.5-flash`, `responseMimeType: "application/json"`).
  - `translateSegments(deps: TranslatorDeps, context: Array<{id;enMarkdown}>, toTranslateIds: number[], opts?: { retries?: number }): Promise<Array<{ id: number; zhMarkdown: string }>>` — calls the model, parses JSON, runs `validateTranslation`, retries on invalid output, throws after retries.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/translate.test.ts
import { describe, it, expect, vi } from "vitest";
import { translateSegments } from "./translate.js";

const context = [{ id: 1, enMarkdown: "In 2005 see [YC](https://ycombinator.com)." }];

describe("translateSegments", () => {
  it("returns validated translations", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({ segments: [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }] }),
    );
    const out = await translateSegments({ generate }, context, [1]);
    expect(out).toEqual([{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries when validation fails then succeeds", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "参见 YC。" }] })) // drops link
      .mockResolvedValueOnce(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }] }));
    const out = await translateSegments({ generate }, context, [1], { retries: 2 });
    expect(out[0].zhMarkdown).toContain("ycombinator.com");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "参见 YC。" }] }));
    await expect(translateSegments({ generate }, context, [1], { retries: 1 })).rejects.toThrow(/validation/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/translate.test.ts`
Expected: FAIL — cannot resolve `./translate.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/translate.ts
import { GoogleGenAI } from "@google/genai";
import { buildSystemPrompt, buildUserPayload } from "./prompt.js";
import { validateTranslation } from "./validate.js";

export type TranslatorDeps = {
  generate: (system: string, user: string) => Promise<string>;
};

const MODEL = "gemini-3.5-flash";

export function createVertexTranslator(): TranslatorDeps {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: "live-card-491105",
    location: "us-central1",
  });
  return {
    async generate(system, user) {
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      });
      return resp.text ?? "";
    },
  };
}

export async function translateSegments(
  deps: TranslatorDeps,
  context: Array<{ id: number; enMarkdown: string }>,
  toTranslateIds: number[],
  opts: { retries?: number } = {},
): Promise<Array<{ id: number; zhMarkdown: string }>> {
  const { retries = 3 } = opts;
  const system = buildSystemPrompt();
  const user = buildUserPayload(context, toTranslateIds);
  const requested = context.filter((c) => toTranslateIds.includes(c.id));

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await deps.generate(system, user);
    let parsed: { segments?: Array<{ id: number; zhMarkdown: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      lastErrors = ["model did not return valid JSON"];
      continue;
    }
    const returned = parsed.segments ?? [];
    const check = validateTranslation(requested, returned);
    if (check.ok) return returned;
    lastErrors = check.errors;
  }
  throw new Error(`translation validation failed after ${retries} retries: ${lastErrors.join("; ")}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/translate.test.ts`
Expected: PASS. (Tests inject `generate`; the real `@google/genai` client is never constructed in tests.)

- [ ] **Step 5: Commit**

```bash
git add pipeline/translate.ts pipeline/translate.test.ts
git commit -m "feat: Gemini/Vertex translator with validate-and-retry"
```

---

## Phase 5 — Pipeline: manifest + orchestrator

### Task 11: Manifest builder

**Files:**
- Create: `pipeline/manifest.ts`
- Test: `pipeline/manifest.test.ts`

**Interfaces:**
- Consumes: `shared/article-schema.ts` (`Article`, `Manifest`, `ManifestSchema`).
- Produces: `buildManifest(articles: Article[], generatedAt: string): Manifest` — maps each article to a `ManifestEntry` (slug, titleZh, dateText, publishedAt, sourceOrder, translatedAt); result validates against `ManifestSchema`. Does not sort (site sorts at render).

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/manifest.test.ts
import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.js";
import { ManifestSchema, type Article } from "../shared/article-schema.js";

const article: Article = {
  slug: "earn", titleEn: "E", titleZh: "赚", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
  translatedAt: "2026-07-08", model: "gemini-3.5-flash",
  segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "a", zhMarkdown: "啊" }],
};

describe("buildManifest", () => {
  it("produces a schema-valid manifest with one entry per article", () => {
    const m = buildManifest([article], "2026-07-08T00:00:00Z");
    expect(() => ManifestSchema.parse(m)).not.toThrow();
    expect(m.articles[0]).toMatchObject({ slug: "earn", titleZh: "赚", sourceOrder: 2 });
    expect(m.generatedAt).toBe("2026-07-08T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/manifest.test.ts`
Expected: FAIL — cannot resolve `./manifest.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/manifest.ts
import type { Article, Manifest } from "../shared/article-schema.js";

export function buildManifest(articles: Article[], generatedAt: string): Manifest {
  return {
    generatedAt,
    articles: articles.map((a) => ({
      slug: a.slug,
      titleZh: a.titleZh,
      dateText: a.dateText,
      publishedAt: a.publishedAt,
      sourceOrder: a.sourceOrder,
      translatedAt: a.translatedAt,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/manifest.ts pipeline/manifest.test.ts
git commit -m "feat: derive manifest index from articles"
```

---

### Task 12: Article assembler (pure orchestration core)

**Files:**
- Create: `pipeline/assemble.ts`
- Test: `pipeline/assemble.test.ts`

**Interfaces:**
- Consumes: `pipeline/align.ts`, `pipeline/translate.ts` (`TranslatorDeps`), `shared/article-schema.ts` (`Article`, `Segment`, `isTranslatable`).
- Produces: `assembleArticle(params: { listEntry: { slug; titleEn; sourceUrl; sourceOrder }; parsed: ParsedArticle; existing: Article | null; translator: TranslatorDeps; translatedAt: string; model: string; titleZhOverride?: string }): Promise<{ article: Article; stats: { new: number; changed: number; unchanged: number; deleted: number; rawUnsupported: number[] } }>` — runs alignment, gathers `changed`+`new` translatable ids, calls `translateSegments` with full translatable context, merges returned `zhMarkdown` back, translates the title (reuse existing `titleZh` if title unchanged), and returns a schema-valid `Article` plus stats. **`new`/`changed`/`unchanged`/`deleted` count translatable segments only** (`hr`/`rawUnsupported` are structural and excluded, so they never inflate the counts); `deleted` = old translatable count − (unchanged + changed). `rawUnsupported` = ids of segments with type `rawUnsupported`.

This is the heart of the pipeline; `index.ts` (next task) only adds I/O, fetching, and concurrency around it.

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/assemble.test.ts
import { describe, it, expect, vi } from "vitest";
import { assembleArticle } from "./assemble.js";
import type { ParsedArticle } from "./parse-article.js";
import { ArticleSchema, type Article } from "../shared/article-schema.js";

const parsed: ParsedArticle = {
  titleEn: "How to Earn",
  dateText: "June 2026",
  publishedAt: "2026-06-01",
  segments: [
    { type: "paragraph", enMarkdown: "First para.", sourceHash: "h1" },
    { type: "hr", sourceHash: "hr1" },
    { type: "paragraph", enMarkdown: "Second para.", sourceHash: "h2" },
  ],
};

const listEntry = { slug: "earn", titleEn: "How to Earn", sourceUrl: "https://paulgraham.com/earn.html", sourceOrder: 2 };

function translatorReturning(map: Record<number, string>) {
  return {
    generate: vi.fn(async (_s: string, user: string) => {
      const { translateIds } = JSON.parse(user) as { translateIds: number[] };
      return JSON.stringify({ segments: translateIds.map((id) => ({ id, zhMarkdown: map[id] ?? "译" })) });
    }),
  };
}

describe("assembleArticle", () => {
  it("produces a schema-valid fully-translated new article", async () => {
    const translator = translatorReturning({ 1: "第一段。", 2: "第二段。" });
    const { article, stats } = await assembleArticle({
      listEntry, parsed, existing: null, translator,
      translatedAt: "2026-07-08", model: "gemini-3.5-flash",
    });
    expect(() => ArticleSchema.parse(article)).not.toThrow();
    expect(article.segments.find((s) => s.type === "hr")?.zhMarkdown).toBeUndefined();
    expect(article.segments.filter((s) => s.type === "paragraph").every((s) => s.zhMarkdown)).toBe(true);
    expect(stats.new).toBe(2);
    expect(stats.unchanged).toBe(0);
  });

  it("preserves unchanged zh and only re-translates changed segments", async () => {
    const existing: Article = {
      slug: "earn", titleEn: "How to Earn", titleZh: "如何赚钱", dateText: "June 2026",
      publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
      translatedAt: "2026-06-01", model: "gemini-3.5-flash",
      segments: [
        { id: 1, type: "paragraph", sourceHash: "h1", enMarkdown: "First para.", zhMarkdown: "手工润色的第一段。" },
        { id: 2, type: "hr", sourceHash: "hr1" },
        { id: 3, type: "paragraph", sourceHash: "h2old", enMarkdown: "Second para OLD.", zhMarkdown: "旧第二段。" },
      ],
    };
    const translator = translatorReturning({ 3: "新的第二段。" });
    const { article, stats } = await assembleArticle({
      listEntry, parsed, existing, translator,
      translatedAt: "2026-07-08", model: "gemini-3.5-flash",
    });
    const p1 = article.segments.find((s) => s.id === 1)!;
    expect(p1.zhMarkdown).toBe("手工润色的第一段。"); // preserved
    const changed = article.segments.find((s) => s.enMarkdown === "Second para.")!;
    expect(changed.zhMarkdown).toBe("新的第二段。");
    expect(stats.unchanged).toBe(1);
    expect(stats.changed).toBe(1);
    // title unchanged -> reused, translator not asked for title
    expect(article.titleZh).toBe("如何赚钱");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/assemble.test.ts`
Expected: FAIL — cannot resolve `./assemble.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// pipeline/assemble.ts
import { alignSegments } from "./align.js";
import { translateSegments, type TranslatorDeps } from "./translate.js";
import type { ParsedArticle } from "./parse-article.js";
import { isTranslatable, type Article, type Segment } from "../shared/article-schema.js";

type ListEntry = { slug: string; titleEn: string; sourceUrl: string; sourceOrder: number };

export type AssembleStats = {
  new: number; changed: number; unchanged: number; deleted: number; rawUnsupported: number[];
};

// Title carries id 0 in the translation context (never collides with body ids ≥ 1).
const TITLE_ID = 0;

export async function assembleArticle(params: {
  listEntry: ListEntry;
  parsed: ParsedArticle;
  existing: Article | null;
  translator: TranslatorDeps;
  translatedAt: string;
  model: string;
}): Promise<{ article: Article; stats: AssembleStats }> {
  const { listEntry, parsed, existing, translator, translatedAt, model } = params;

  const { aligned } = alignSegments(existing?.segments ?? [], parsed.segments);
  const segments: Segment[] = aligned.map((a) => a.segment);

  // Full translatable context (body).
  const context = segments
    .filter((s) => isTranslatable(s.type) && s.enMarkdown)
    .map((s) => ({ id: s.id, enMarkdown: s.enMarkdown as string }));

  // Ids needing translation: changed + new (i.e. missing zhMarkdown among translatable).
  const toTranslate = segments
    .filter((s) => isTranslatable(s.type) && s.enMarkdown && s.zhMarkdown === undefined)
    .map((s) => s.id);

  // Title: reuse if unchanged, else translate via id 0.
  const titleUnchanged = existing && existing.titleEn === parsed.titleEn && existing.titleZh;
  let titleZh = titleUnchanged ? existing!.titleZh : "";

  const titleContext = { id: TITLE_ID, enMarkdown: parsed.titleEn };
  const fullContext = [titleContext, ...context];
  const requestIds = [...toTranslate];
  if (!titleUnchanged) requestIds.unshift(TITLE_ID);

  if (requestIds.length > 0) {
    const results = await translateSegments(translator, fullContext, requestIds);
    const byId = new Map(results.map((r) => [r.id, r.zhMarkdown]));
    if (!titleUnchanged && byId.has(TITLE_ID)) titleZh = byId.get(TITLE_ID)!;
    for (const s of segments) {
      if (byId.has(s.id)) s.zhMarkdown = byId.get(s.id);
    }
  }

  // Stats count only translatable segments (hr/rawUnsupported are structural,
  // never translated, and must not inflate new/changed/unchanged/deleted).
  const translatableAligned = aligned.filter((a) => isTranslatable(a.segment.type));
  const oldTranslatable = (existing?.segments ?? []).filter((s) => isTranslatable(s.type)).length;
  const stats: AssembleStats = {
    new: translatableAligned.filter((a) => a.disposition === "new").length,
    changed: translatableAligned.filter((a) => a.disposition === "changed").length,
    unchanged: translatableAligned.filter((a) => a.disposition === "unchanged").length,
    deleted: oldTranslatable
      - translatableAligned.filter((a) => a.disposition === "unchanged" || a.disposition === "changed").length,
    rawUnsupported: segments.filter((s) => s.type === "rawUnsupported").map((s) => s.id),
  };

  const article: Article = {
    slug: listEntry.slug,
    titleEn: parsed.titleEn,
    titleZh,
    dateText: parsed.dateText,
    publishedAt: parsed.publishedAt,
    sourceOrder: listEntry.sourceOrder,
    sourceUrl: listEntry.sourceUrl,
    translatedAt,
    model,
    segments,
  };

  return { article, stats };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/assemble.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add pipeline/assemble.ts pipeline/assemble.test.ts
git commit -m "feat: assemble article (align + translate + merge) with stats"
```

---

### Task 13: Pipeline orchestrator + I/O + summary

**Files:**
- Create: `pipeline/store.ts` (read/write article JSON + manifest)
- Create: `pipeline/index.ts`
- Test: `pipeline/store.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`, all prior pipeline modules, `shared/article-schema.ts`.
- Produces:
  - `store.ts`: `readArticle(dir, slug): Promise<Article | null>`, `readAllArticles(dir): Promise<Article[]>` (reads every `*.json` in the dir, sorted by slug for deterministic output; returns `[]` if the dir is missing), `writeArticle(dir, article): Promise<void>`, `writeManifest(contentDir, manifest): Promise<void>` — all validating with Zod and writing pretty JSON (2-space, trailing newline).
  - `index.ts`: `main()` orchestration — fetch list, for each entry (concurrency-limited via `p-limit`, default 4) fetch + parse + assemble, write JSON, collect stats; then **rebuild the manifest from ALL articles on disk via `readAllArticles`** (never only this run's results — a `--only`/`--limit` run must not drop other articles, and a failed article must not vanish from the manifest); print summary including any `rawUnsupported` findings and a non-zero-count warning. Accepts optional `--limit N` and `--only slug1,slug2` args. `main()` is only invoked when run as the entry module (guarded), so `store.ts` can be unit-tested without side effects.

Only `store.ts` gets unit tests (pure I/O); `index.ts` is verified by the manual integration run in Task 14 (it needs live network + credentials).

- [ ] **Step 1: Write the failing test**

```typescript
// pipeline/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArticle, readAllArticles, writeArticle, writeManifest } from "./store.js";
import type { Article, Manifest } from "../shared/article-schema.js";

const article: Article = {
  slug: "earn", titleEn: "E", titleZh: "赚", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
  translatedAt: "2026-07-08", model: "gemini-3.5-flash",
  segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "a", zhMarkdown: "啊" }],
};

let base: string;
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), "pgcn-")); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe("store", () => {
  it("round-trips an article", async () => {
    const dir = join(base, "articles");
    await writeArticle(dir, article);
    const back = await readArticle(dir, "earn");
    expect(back).toEqual(article);
  });

  it("returns null for a missing article", async () => {
    expect(await readArticle(join(base, "articles"), "nope")).toBeNull();
  });

  it("readAllArticles reads every article sorted by slug", async () => {
    const dir = join(base, "articles");
    await writeArticle(dir, { ...article, slug: "winc" });
    await writeArticle(dir, { ...article, slug: "earn" });
    const all = await readAllArticles(dir);
    expect(all.map((a) => a.slug)).toEqual(["earn", "winc"]);
  });

  it("readAllArticles returns [] when the dir is missing", async () => {
    expect(await readAllArticles(join(base, "nope"))).toEqual([]);
  });

  it("writes a manifest with trailing newline", async () => {
    const manifest: Manifest = { generatedAt: "t", articles: [] };
    await writeManifest(base, manifest);
    const raw = await readFile(join(base, "manifest.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(manifest);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pipeline/store.test.ts`
Expected: FAIL — cannot resolve `./store.js`.

- [ ] **Step 3: Write `pipeline/store.ts`**

```typescript
// pipeline/store.ts
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArticleSchema, ManifestSchema, type Article, type Manifest } from "../shared/article-schema.js";

function pretty(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

export async function readArticle(dir: string, slug: string): Promise<Article | null> {
  try {
    const raw = await readFile(join(dir, `${slug}.json`), "utf8");
    return ArticleSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readAllArticles(dir: string): Promise<Article[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const slugs = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  const articles: Article[] = [];
  for (const slug of slugs) {
    const article = await readArticle(dir, slug);
    if (article) articles.push(article);
  }
  return articles;
}

export async function writeArticle(dir: string, article: Article): Promise<void> {
  ArticleSchema.parse(article);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${article.slug}.json`), pretty(article), "utf8");
}

export async function writeManifest(contentDir: string, manifest: Manifest): Promise<void> {
  ManifestSchema.parse(manifest);
  await mkdir(contentDir, { recursive: true });
  await writeFile(join(contentDir, "manifest.json"), pretty(manifest), "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pipeline/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `pipeline/index.ts` (orchestrator)**

```typescript
// pipeline/index.ts
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pLimit from "p-limit";
import { fetchHtml } from "./fetch.js";
import { parseArticleList } from "./parse-list.js";
import { parseArticle } from "./parse-article.js";
import { assembleArticle, type AssembleStats } from "./assemble.js";
import { createVertexTranslator } from "./translate.js";
import { readArticle, readAllArticles, writeArticle, writeManifest } from "./store.js";
import { buildManifest } from "./manifest.js";
import type { Article } from "../shared/article-schema.js";

const CONTENT_DIR = join(process.cwd(), "content");
const ARTICLES_DIR = join(CONTENT_DIR, "articles");
const MODEL = "gemini-3.5-flash";

function parseArgs(argv: string[]) {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const limitArg = argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length);
  return {
    only: only ? new Set(only.split(",")) : null,
    limit: limitArg ? Number(limitArg) : null,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { only, limit } = parseArgs(argv);
  const translator = createVertexTranslator();
  const translatedAt = new Date().toISOString().slice(0, 10);

  const listHtml = await fetchHtml("https://paulgraham.com/articles.html");
  let entries = parseArticleList(listHtml);
  if (only) entries = entries.filter((e) => only.has(e.slug));
  if (limit) entries = entries.slice(0, limit);

  const limiter = pLimit(4);
  const results: Article[] = [];
  const rawFindings: Array<{ slug: string; ids: number[] }> = [];
  const totals = { new: 0, changed: 0, unchanged: 0, deleted: 0, failed: 0, skipped: 0 };

  await Promise.all(entries.map((entry) => limiter(async () => {
    try {
      const html = await fetchHtml(entry.sourceUrl);
      const parsed = parseArticle(html, entry.titleEn);
      const existing = await readArticle(ARTICLES_DIR, entry.slug);
      const { article, stats } = await assembleArticle({
        listEntry: entry, parsed, existing, translator, translatedAt, model: MODEL,
      });
      await writeArticle(ARTICLES_DIR, article);
      results.push(article);
      totals.new += stats.new; totals.changed += stats.changed; totals.unchanged += stats.unchanged;
      totals.deleted += stats.deleted;
      if (stats.new === 0 && stats.changed === 0) totals.skipped++;
      if (stats.rawUnsupported.length) rawFindings.push({ slug: entry.slug, ids: stats.rawUnsupported });
    } catch (err) {
      totals.failed++;
      console.error(`✗ ${entry.slug}: ${String(err)}`);
    }
  })));

  // Rebuild manifest from ALL articles on disk — not just this run's results.
  // A --only/--limit run, or a run with failures, must never drop other
  // articles from the manifest (which drives the homepage/index).
  const allArticles = await readAllArticles(ARTICLES_DIR);
  const manifest = buildManifest(allArticles, new Date().toISOString());
  await writeManifest(CONTENT_DIR, manifest);

  console.log("\n=== translate summary ===");
  console.log(`articles processed: ${results.length}  failed: ${totals.failed}`);
  console.log(`segments  new:${totals.new} changed:${totals.changed} unchanged:${totals.unchanged} deleted:${totals.deleted}`);
  if (rawFindings.length) {
    console.log("\n⚠ rawUnsupported segments (verify these are not real body text):");
    for (const f of rawFindings) console.log(`  ${f.slug}: ids ${f.ids.join(", ")}`);
    console.log("Review the above before publishing.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add pipeline/store.ts pipeline/store.test.ts pipeline/index.ts
git commit -m "feat: pipeline orchestrator, JSON store, and run summary"
```

---

### Task 14: Live pipeline smoke test (2 articles)

**Files:**
- Modify: none (manual verification task)
- Create: `content/articles/*.json` for two real essays (committed as first real content)

**Interfaces:**
- Consumes: everything in Phases 2–5, live network, and `credentials/gemini-vertex.json`.
- Produces: verified real content JSON for two slugs; confidence the full run will work.

- [ ] **Step 1: Confirm credentials present**

Run: `test -f credentials/gemini-vertex.json && echo OK`
Expected: `OK`. If missing, stop and ask the user for the credentials file.

- [ ] **Step 2: Run the pipeline for two articles**

Run: `GOOGLE_APPLICATION_CREDENTIALS=credentials/gemini-vertex.json npm run translate -- --only=earn,greatwork`
Expected: two files written; summary prints `articles processed: 2 failed: 0`.

- [ ] **Step 3: Inspect output quality**

Run: `cat content/articles/earn.json | head -60`
Verify: `titleZh` is a real Chinese title; each paragraph segment has both `enMarkdown` and `zhMarkdown`; links preserved in both; `publishedAt`/`dateText` populated; any `rawUnsupported` findings from the summary are genuinely non-prose.

- [ ] **Step 4: Validate against schema via a one-off check**

Run: `npx tsx -e "import {ArticleSchema} from './shared/article-schema.ts'; import {readFileSync} from 'fs'; ArticleSchema.parse(JSON.parse(readFileSync('content/articles/earn.json','utf8'))); console.log('valid')"`
Expected: `valid`.

- [ ] **Step 5: Commit the first real content**

```bash
git add content/articles/earn.json content/articles/greatwork.json content/manifest.json
git commit -m "content: translate first two essays (earn, greatwork)"
```

---

## Phase 6 — Astro site

### Task 15: Astro project config + content collection

**Files:**
- Create: `astro.config.mjs`
- Create: `src/content.config.ts`
- Test: `npx tsc --noEmit` + `npx astro sync` — content config is declarative; behavior is verified when pages render in Task 18.

**Interfaces:**
- Consumes: `astro`, `astro/loaders` (`glob`), `shared/article-schema.ts` (`ArticleSchema`).
- Produces: an `articles` content collection loading `content/articles/*.json`, whose entry `data` conforms to the shared schema.

- [ ] **Step 1: Create `astro.config.mjs`**

```javascript
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://paulgraham-cn.com",
  build: { format: "file" }, // emit /earn.html not /earn/index.html
});
```

- [ ] **Step 2: Create `src/content.config.ts`**

```typescript
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { ArticleSchema } from "../shared/article-schema.js";

const articles = defineCollection({
  loader: glob({ pattern: "*.json", base: "content/articles" }),
  schema: ArticleSchema,
});

export const collections = { articles };
```

- [ ] **Step 3: Verify Astro recognizes the collection**

Run: `npx astro sync`
Expected: completes without schema errors; generates `.astro/` types.

- [ ] **Step 4: Commit**

```bash
git add astro.config.mjs src/content.config.ts
git commit -m "feat: astro config and articles content collection"
```

---

### Task 16: Safe Markdown rendering + article sort

**Files:**
- Create: `src/lib/markdown.ts`
- Create: `src/lib/sort.ts`
- Test: `src/lib/markdown.test.ts`, `src/lib/sort.test.ts`

**Interfaces:**
- Consumes: `unified`, `remark-parse`, `remark-rehype`, `rehype-sanitize`, `rehype-stringify`; `shared/article-schema.ts` (`ManifestEntry`).
- Produces:
  - `renderMarkdown(md: string): Promise<string>` — Markdown → sanitized HTML: no raw HTML passthrough, links restricted to http/https/mailto (rehype-sanitize default).
  - `sortArticles<T extends { publishedAt: string | null; sourceOrder: number }>(entries: T[]): T[]` — publishedAt desc, sourceOrder asc tie-break; null publishedAt sorts after dated ones (then by sourceOrder).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/markdown.test.ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("renders links and emphasis", async () => {
    const html = await renderMarkdown("see [YC](https://ycombinator.com) and *this*");
    expect(html).toContain('href="https://ycombinator.com"');
    expect(html).toContain("<em>this</em>");
  });
  it("strips raw HTML", async () => {
    const html = await renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script>");
  });
  it("strips javascript: links", async () => {
    const html = await renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});
```

```typescript
// src/lib/sort.test.ts
import { describe, it, expect } from "vitest";
import { sortArticles } from "./sort.js";

describe("sortArticles", () => {
  it("sorts by publishedAt desc then sourceOrder asc", () => {
    const input = [
      { publishedAt: "2020-01-01", sourceOrder: 5 },
      { publishedAt: "2026-06-01", sourceOrder: 3 },
      { publishedAt: "2026-06-01", sourceOrder: 1 },
      { publishedAt: null, sourceOrder: 2 },
    ];
    expect(sortArticles(input)).toEqual([
      { publishedAt: "2026-06-01", sourceOrder: 1 },
      { publishedAt: "2026-06-01", sourceOrder: 3 },
      { publishedAt: "2020-01-01", sourceOrder: 5 },
      { publishedAt: null, sourceOrder: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/markdown.test.ts src/lib/sort.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write implementations**

```typescript
// src/lib/markdown.ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize)
  .use(rehypeStringify);

export async function renderMarkdown(md: string): Promise<string> {
  const file = await processor.process(md);
  return String(file);
}
```

```typescript
// src/lib/sort.ts
export function sortArticles<T extends { publishedAt: string | null; sourceOrder: number }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
      return a.sourceOrder - b.sourceOrder;
    }
    if (a.publishedAt && !b.publishedAt) return -1;
    if (!a.publishedAt && b.publishedAt) return 1;
    return a.sourceOrder - b.sourceOrder;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/markdown.test.ts src/lib/sort.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown.ts src/lib/markdown.test.ts src/lib/sort.ts src/lib/sort.test.ts
git commit -m "feat: safe markdown rendering and article sort"
```

---

### Task 17: Base layout + global styles (light/dark, reading typography)

**Files:**
- Create: `src/layouts/Base.astro`
- Create: `src/styles/global.css`

**Interfaces:**
- Consumes: nothing (pure presentation).
- Produces: `Base.astro` — accepts props `{ title: string; description?: string; canonical?: string }`, renders `<html lang="zh-CN">` shell, imports `global.css`, includes an inline theme-init script (reads `localStorage.theme`, falls back to `prefers-color-scheme`) and a theme toggle button `#theme-toggle`.

- [ ] **Step 1: Create `src/styles/global.css`**

```css
:root {
  --bg: #fbfaf7;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --link: #14548c;
  --rule: #e4e0d8;
  --max: 40rem;
  --serif: Georgia, "Times New Roman", serif;
  --zh: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
}
:root[data-theme="dark"] {
  --bg: #16171a;
  --fg: #e7e5e0;
  --muted: #9a9a9a;
  --link: #7fb2e0;
  --rule: #2c2e33;
}
* { box-sizing: border-box; }
html { font-size: 18px; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: var(--zh); line-height: 1.85;
  -webkit-font-smoothing: antialiased;
}
main { max-width: var(--max); margin: 0 auto; padding: 3rem 1.25rem 6rem; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 1.9rem; line-height: 1.3; margin: 0 0 .25rem; }
.site-header { display: flex; justify-content: space-between; align-items: center;
  max-width: var(--max); margin: 0 auto; padding: 1rem 1.25rem; }
.article-meta { color: var(--muted); font-size: .9rem; margin-bottom: 2.5rem; }
.article-list { list-style: none; padding: 0; }
.article-list li { margin: 0 0 1.6rem; }
.article-list .title-en { color: var(--muted); font-size: .85rem; font-family: var(--serif); }
hr { border: none; border-top: 1px solid var(--rule); margin: 2rem 0; }
button { font: inherit; color: inherit; background: none; border: 1px solid var(--rule);
  border-radius: 6px; padding: .3rem .7rem; cursor: pointer; }

/* Reading modes */
.seg { margin: 0 0 1.4rem; }
.seg-en { display: none; color: var(--muted); font-family: var(--serif); font-size: .95rem; }
body[data-read="bilingual"] .seg-en { display: block; margin-top: .4rem; }
.seg-en--hover { /* pure-zh mode: reveal original on hover/focus */ }
body:not([data-read="bilingual"]) .seg:hover .seg-en,
body:not([data-read="bilingual"]) .seg:focus-within .seg-en { display: block; margin-top: .4rem; opacity: .8; }
```

- [ ] **Step 2: Create `src/layouts/Base.astro`**

```astro
---
interface Props { title: string; description?: string; canonical?: string }
const { title, description, canonical } = Astro.props;
import "../styles/global.css";
---
<!doctype html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description && <meta name="description" content={description} />}
    {canonical && <link rel="canonical" href={canonical} />}
    <script is:inline>
      (() => {
        const saved = localStorage.getItem("theme");
        const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      })();
    </script>
  </head>
  <body>
    <header class="site-header">
      <a href="/">Paul Graham 中文</a>
      <button id="theme-toggle" aria-label="切换主题">◐</button>
    </header>
    <slot />
    <script is:inline>
      document.getElementById("theme-toggle")?.addEventListener("click", () => {
        const el = document.documentElement;
        const next = el.dataset.theme === "dark" ? "light" : "dark";
        el.dataset.theme = next;
        localStorage.setItem("theme", next);
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: Verify it builds**

Run: `npx tsc --noEmit`. Expected: no errors. (Astro build validation happens in Task 18.)

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Base.astro src/styles/global.css
git commit -m "feat: base layout with light/dark theme and reading typography"
```

---

### Task 18: Homepage + article page + reading-mode toggle

**Files:**
- Create: `src/components/ArticleBody.astro`
- Create: `src/pages/index.astro`
- Create: `src/pages/[slug].html.astro`

**Interfaces:**
- Consumes: `astro:content` (`getCollection`), `src/lib/markdown.ts`, `src/lib/sort.ts`, `src/layouts/Base.astro`, `shared/article-schema.ts` (`isTranslatable`).
- Produces: three routes. `index.astro` lists sorted articles. `[slug].html.astro` renders one essay with a reading-mode toggle. `ArticleBody.astro` renders segments: for translatable segments, `zhMarkdown` (rendered) as primary with `enMarkdown` (rendered) in a `.seg-en` companion; `hr` → `<hr>`; `rawUnsupported` → its raw text as a paragraph.

- [ ] **Step 1: Create `src/components/ArticleBody.astro`**

```astro
---
import { renderMarkdown } from "../lib/markdown.js";
import { isTranslatable } from "../../shared/article-schema.js";
import type { Segment } from "../../shared/article-schema.js";

interface Props { segments: Segment[] }
const { segments } = Astro.props;

const rendered = await Promise.all(segments.map(async (s) => {
  if (s.type === "hr") return { kind: "hr" as const };
  if (s.type === "rawUnsupported") {
    return { kind: "raw" as const, html: await renderMarkdown(s.enMarkdown ?? "") };
  }
  return {
    kind: "seg" as const,
    zh: await renderMarkdown(s.zhMarkdown ?? s.enMarkdown ?? ""),
    en: await renderMarkdown(s.enMarkdown ?? ""),
    translated: isTranslatable(s.type) && !!s.zhMarkdown,
  };
}));
---
<div class="article-body">
  {rendered.map((r) =>
    r.kind === "hr" ? <hr /> :
    r.kind === "raw" ? <div class="seg" set:html={r.html} /> :
    <div class="seg" tabindex="0">
      <div class="seg-zh" set:html={r.zh} />
      <div class="seg-en" set:html={r.en} />
    </div>
  )}
</div>
```

- [ ] **Step 2: Create `src/pages/index.astro`**

```astro
---
import { getCollection } from "astro:content";
import Base from "../layouts/Base.astro";
import { sortArticles } from "../lib/sort.js";

const entries = await getCollection("articles");
const articles = sortArticles(entries.map((e) => e.data));
---
<Base title="Paul Graham 文集（中文）" description="Paul Graham 文章的中文翻译">
  <main>
    <h1>Paul Graham 文集</h1>
    <p class="article-meta">共 {articles.length} 篇 · 中文翻译</p>
    <ul class="article-list">
      {articles.map((a) => (
        <li>
          <a href={`/${a.slug}.html`}>{a.titleZh}</a>
          <div class="title-en">{a.titleEn} · {a.dateText}</div>
        </li>
      ))}
    </ul>
  </main>
</Base>
```

- [ ] **Step 3: Create `src/pages/[slug].html.astro`**

```astro
---
import { getCollection } from "astro:content";
import Base from "../layouts/Base.astro";
import ArticleBody from "../components/ArticleBody.astro";

export async function getStaticPaths() {
  const entries = await getCollection("articles");
  return entries.map((e) => ({ params: { slug: e.data.slug }, props: { article: e.data } }));
}
const { article } = Astro.props;
const canonical = `https://paulgraham-cn.com/${article.slug}.html`;
---
<Base title={article.titleZh} description={article.titleEn} canonical={canonical}>
  <main>
    <h1>{article.titleZh}</h1>
    <div class="article-meta">
      <span>{article.titleEn}</span> · <span>{article.dateText}</span> ·
      <a href={article.sourceUrl} rel="nofollow">原文</a>
      <button id="read-toggle" aria-label="切换双语">双语对照</button>
    </div>
    <ArticleBody segments={article.segments} />
  </main>
  <script is:inline>
    (() => {
      const saved = localStorage.getItem("read");
      if (saved) document.body.dataset.read = saved;
      document.getElementById("read-toggle")?.addEventListener("click", () => {
        const on = document.body.dataset.read === "bilingual";
        const next = on ? "zh" : "bilingual";
        document.body.dataset.read = next;
        localStorage.setItem("read", next);
      });
    })();
  </script>
</Base>
```

- [ ] **Step 4: Build the site**

Run: `npx astro build`
Expected: build succeeds; `dist/earn.html` and `dist/greatwork.html` and `dist/index.html` exist.

- [ ] **Step 5: Verify URL parity and content**

Run: `ls dist/*.html && grep -l "如何" dist/earn.html`
Expected: `dist/earn.html` exists (not `dist/earn/index.html`) and contains Chinese text.

- [ ] **Step 6: Manual visual check**

Run: `npx astro preview` and open `http://localhost:4321/earn.html`. Verify: Chinese renders by default; hovering a paragraph reveals the English; the 双语对照 button toggles side-by-side; theme toggle works and persists on reload; the 原文 link points to paulgraham.com.

- [ ] **Step 7: Commit**

```bash
git add src/components/ArticleBody.astro src/pages/index.astro "src/pages/[slug].html.astro"
git commit -m "feat: homepage, article page, and reading-mode toggle"
```

---

## Phase 7 — Deployment & full run

### Task 19: Cloudflare Pages config + README

**Files:**
- Create: `public/_headers`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: deploy documentation and cache headers; no code behavior.

- [ ] **Step 1: Create `public/_headers`**

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer-when-downgrade
```

- [ ] **Step 2: Create `README.md`**

````markdown
# paulgraham-cn.com

Chinese translations of Paul Graham's essays.

## Translate (local, needs Vertex credentials)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=credentials/gemini-vertex.json
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

## Deploy (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`
- No environment variables or secrets needed (translation is pre-baked into committed JSON).
- Bind custom domain `paulgraham-cn.com`.
````

- [ ] **Step 3: Commit**

```bash
git add public/_headers README.md
git commit -m "docs: deploy config and README"
```

---

### Task 20: Full translation run + final verification

**Files:**
- Create: `content/articles/*.json` (all essays), updated `content/manifest.json`

**Interfaces:**
- Consumes: entire system + live network + credentials.
- Produces: complete translated corpus, built site.

- [ ] **Step 1: Run the full pipeline**

Run: `GOOGLE_APPLICATION_CREDENTIALS=credentials/gemini-vertex.json npm run translate`
Expected: summary reports ~200+ articles processed, `failed: 0` (investigate and re-run any failures with `--only=<slug>`). Review any `rawUnsupported` findings listed in the summary.

- [ ] **Step 2: Build the full site**

Run: `npm run build`
Expected: build succeeds; `ls dist/*.html | wc -l` ≈ article count + 1 (index).

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 4: Spot-check three built pages**

Open `dist/index.html`, `dist/earn.html`, and one older essay in a browser (via `npx astro preview`). Verify sorting (newest first), Chinese rendering, hover-original, bilingual toggle, and original links.

- [ ] **Step 5: Commit the full corpus**

```bash
git add content/
git commit -m "content: translate full Paul Graham essay corpus"
```

---

## Self-Review

**Spec coverage:**
- 全部一次性翻译 → Task 20. URL 一致 (`/earn.html`) → Task 15 (`build.format:"file"`) + Task 18 (`[slug].html.astro`), verified Task 18 Step 5. 纯中文为主 + 段落对照 + 悬浮看原文 + 双语切换 → Task 17 CSS + Task 18. 信达雅 → Task 9 prompt. 整篇上下文、只返回待翻译段 → Task 12 (`fullContext` + `requestIds`). 段落级 sourceHash → Task 3 + Task 6. 段落对齐 (LCS+相似度, id 稳定/不复用) → Task 7. 质量门禁 (id/链接/数字) → Task 8. Markdown 安全 (禁 raw HTML, 链接协议白名单) → Task 16. segment type 字段 (paragraph/heading/hr/list/quote/footnote/rawUnsupported) → schema Task 1, parser emits paragraph/hr/quote/list/rawUnsupported in Task 6 (footnotes stay prose paragraphs by design). dateText/publishedAt/sourceOrder + 排序 → Task 4, Task 16. manifest 由 pipeline 生成入库、build 只读、且从全量磁盘重建 → Task 11 + Task 13 (`readAllArticles`); site never reads via build-time API. rawUnsupported summary → Task 6 (classifier) + Task 13 (summary). Vertex + @google/genai + gemini-3.5-flash + credentials git-ignored → Task 0 (.gitignore), Task 10. Cloudflare Pages → Task 19. 亮/暗主题 → Task 17. YAGNI (no draft queue/search/accounts) → honored (not built).
- **Gap found & closed:** title translation was implicit in the spec ("titleZh"); Task 12 explicitly translates the title (id 0) and reuses it when unchanged.

**Placeholder scan:** No TBD/TODO. Every code step contains complete code; every test has real assertions; every command has expected output.

**Type consistency:** `Article`/`Segment`/`Manifest` from Task 1 are used verbatim downstream. `ParsedSegment`/`ParsedArticle` (Task 6) feed `alignSegments` (Task 7) and `assembleArticle` (Task 12). `TranslatorDeps.generate` (Task 10) is what Task 12 tests inject. `AssembleStats` (Task 12) is consumed by Task 13's summary. `sortArticles` and `renderMarkdown` (Task 16) are used by Task 18. Names match across tasks.
