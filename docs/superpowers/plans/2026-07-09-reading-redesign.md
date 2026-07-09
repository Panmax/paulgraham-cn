# 阅读体验重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The **frontend-design** skill carries out the visual/CSS tasks (Tasks 5–9).

**Goal:** Rebuild the `src/` site into a 精致文学杂志风 Chinese reading experience — self-hosted per-essay subsetted serif, 静谧古典 article page, 年鉴编年 homepage with instant search, a global 双语对照 toggle (hover removed) — without touching the translation pipeline or content JSON.

**Architecture:** A local font step (`npm run fonts`) scans every `content/articles/*.json`, collects each page's exact code points (+ fixed UI glyphs), and emits committed, content-hashed WOFF2 subsets (Regular + Bold) of Source Han Serif SC plus a manifest. A read-only `verify-fonts` gate runs before `astro build` so stale fonts fail CI while the build stays hermetic (no raw font, no network). Astro pages reference subsets per-page via `@font-face`; homepage and article rendering read the manifest.

**Tech Stack:** Astro 7, TypeScript (tsx), vitest, `subset-font` (harfbuzz-wasm → WOFF2), `fontkit` (dev-only cmap coverage assertion), Source Han Serif SC + Newsreader (both SIL OFL).

## Global Constraints

- Node **>=22.12.0**; ES modules; imports use `.js` extensions (verbatimModuleSyntax).
- **Never** modify `pipeline/**` or `content/**` (data + translation logic frozen).
- `npm run build` = `tsx scripts/verify-fonts.ts && astro build`; **no API calls, no network, no raw font** needed at build.
- Generated `public/fonts/**.woff2` + `public/fonts/manifest.json` are **committed** to git. Raw `.otf` lives in gitignored `assets/fonts/` (local only).
- CSS `font-family` for Chinese is **`"PGCN Song"`** (custom, not a reserved name); English is **`"Newsreader"`**. Bundle `public/OFL.txt`; attribute both fonts in the footer.
- "Untranslated" everywhere means `seg.zhMarkdown?.trim()` is empty (empty string counts as untranslated, not just `undefined`).
- Contrast: any text color vs its background ≥ 4.5:1 in **both** light and dark themes.
- Pinned raw-font SHA-256 values are recorded in `scripts/font-sources.ts` and checked by the font step.

## File Structure

**New**
- `scripts/lib/chars.ts` — pure char-collection + fixed UI text constant.
- `scripts/lib/chars.test.ts` — unit tests.
- `scripts/font-sources.ts` — raw font paths + pinned SHA-256 + CSS family name.
- `scripts/subset-fonts.ts` — `npm run fonts` entry: subset → hashed WOFF2 → manifest.
- `scripts/verify-fonts.ts` — read-only build gate.
- `scripts/verify-fonts.test.ts` — unit tests for the check logic.
- `src/lib/group.ts` + `.test.ts` — year grouping incl. 日期不详.
- `src/lib/adjacent.ts` + `.test.ts` — prev/next neighbors.
- `src/lib/segments.ts` + `.test.ts` — pure segment classification for rendering.
- `public/fonts/**` (generated, committed), `public/OFL.txt`.

**Modified**
- `src/styles/global.css` — tokens, @font-face base, typography, reading modes, homepage, footer.
- `src/components/ArticleBody.astro` — 中文优先 rendering, remove `tabindex`.
- `src/pages/[slug].astro` — 静谧古典 layout, per-page @font-face, toggle, footer nav.
- `src/pages/index.astro` — 年鉴编年 + search.
- `src/layouts/Base.astro` — footer with attribution, keep theme toggle.
- `package.json` — `fonts`/`build` scripts + deps.
- `.gitignore` — ignore `assets/fonts/`.
- `README.md` — fonts workflow.

---

### Task 1: Char-collection module + fixed UI text

**Files:**
- Create: `scripts/lib/chars.ts`
- Test: `scripts/lib/chars.test.ts`

**Interfaces:**
- Consumes: `Article`, `Segment` from `../../shared/article-schema.js`; `isTranslatable`.
- Produces:
  - `SHARED_UI_TEXT: string` — every fixed Chinese chrome string, concatenated.
  - `isUntranslated(seg: Segment): boolean` — `isTranslatable(seg.type) && !seg.zhMarkdown?.trim()`.
  - `collectArticleChars(a: Article): Set<string>` — code points of `titleZh` + each translated segment's `zhMarkdown` + `SHARED_UI_TEXT`.
  - `collectSiteChars(list: Article[]): Set<string>` — code points of every `titleZh` + `dateText` + `SHARED_UI_TEXT`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/lib/chars.test.ts
import { describe, it, expect } from "vitest";
import { SHARED_UI_TEXT, isUntranslated, collectArticleChars, collectSiteChars } from "./chars.js";
import type { Article } from "../../shared/article-schema.js";

const art = (over: Partial<Article> = {}): Article => ({
  slug: "x", titleEn: "T", titleZh: "标题", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 1, sourceUrl: "https://paulgraham.com/x.html",
  translatedAt: "2026-07-09", model: "m",
  segments: [
    { id: 1, type: "paragraph", sourceHash: "h1", enMarkdown: "Y Combinator", zhMarkdown: "你好 YC 6500，" },
    { id: 2, type: "paragraph", sourceHash: "h2", enMarkdown: "note", zhMarkdown: "" },   // untranslated
    { id: 3, type: "rawUnsupported", sourceHash: "h3", enMarkdown: "code" },
  ],
  ...over,
});

describe("chars", () => {
  it("SHARED_UI_TEXT includes chrome strings", () => {
    for (const s of ["原文", "双语对照", "未译原文", "返回目录", "上一篇", "下一篇", "日期不详", "中文"])
      expect(SHARED_UI_TEXT).toContain(s);
  });
  it("isUntranslated treats empty/whitespace zh as untranslated", () => {
    const a = art();
    expect(isUntranslated(a.segments[0])).toBe(false);
    expect(isUntranslated(a.segments[1])).toBe(true);
    expect(isUntranslated(a.segments[2])).toBe(false); // rawUnsupported is not translatable
  });
  it("collectArticleChars includes title + translated zh + latin/digits + UI, excludes empty-seg english", () => {
    const s = collectArticleChars(art());
    for (const ch of ["标", "你", "好", "Y", "C", "6", "5", "0", "，", "原"]) expect(s.has(ch)).toBe(true);
    expect(s.has("n")).toBe(true); // 'n' appears in SHARED_UI_TEXT-adjacent? ensure via a real UI char instead:
  });
  it("collectSiteChars spans all titles + dateText + UI", () => {
    const s = collectSiteChars([art({ titleZh: "甲" }), art({ titleZh: "乙", slug: "y" })]);
    expect(s.has("甲")).toBe(true); expect(s.has("乙")).toBe(true);
    expect(s.has("J")).toBe(true); // from "June" dateText
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/lib/chars.test.ts`
Expected: FAIL — `Cannot find module './chars.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/lib/chars.ts
import { isTranslatable, type Article, type Segment } from "../../shared/article-schema.js";

// Fixed Chinese chrome that must be renderable on EVERY page (article + home),
// so each per-page subset includes these glyphs.
export const SHARED_UI_TEXT = [
  "Paul Graham 中文", "文集", "共 篇 · 中文翻译", "原文", "双语对照", "中文优先",
  "未译原文", "返回目录", "上一篇", "下一篇", "日期不详", "搜索标题…",
  "没有匹配的文章", "切换主题", "切换双语", "字体", "思源宋体",
].join("");

export function isUntranslated(seg: Segment): boolean {
  return isTranslatable(seg.type) && !seg.zhMarkdown?.trim();
}

function addCodePoints(set: Set<string>, s: string | undefined): void {
  if (!s) return;
  for (const ch of s) set.add(ch);
}

export function collectArticleChars(a: Article): Set<string> {
  const set = new Set<string>();
  addCodePoints(set, a.titleZh);
  for (const seg of a.segments) {
    if (isTranslatable(seg.type) && seg.zhMarkdown?.trim()) addCodePoints(set, seg.zhMarkdown);
  }
  addCodePoints(set, SHARED_UI_TEXT);
  return set;
}

export function collectSiteChars(list: Article[]): Set<string> {
  const set = new Set<string>();
  for (const a of list) { addCodePoints(set, a.titleZh); addCodePoints(set, a.dateText); }
  addCodePoints(set, SHARED_UI_TEXT);
  return set;
}
```

Fix the one placeholder assertion in the test (`expect(s.has("n"))`) to assert a concrete UI char instead, e.g. `expect(s.has("原")).toBe(true)` (already present) — remove the `'n'` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/lib/chars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/chars.ts scripts/lib/chars.test.ts
git commit -m "feat(fonts): char-collection module + fixed UI glyph set"
```

---

### Task 2: Font subsetting script (`npm run fonts`)

**Files:**
- Create: `scripts/font-sources.ts`, `scripts/subset-fonts.ts`
- Modify: `package.json` (deps + scripts), `.gitignore`
- Generated (committed later): `public/fonts/zh/*.woff2`, `public/fonts/manifest.json`

**Interfaces:**
- Consumes: `collectArticleChars`, `collectSiteChars` (Task 1); `readAllArticles` from `../pipeline/store.js`.
- Produces: `public/fonts/manifest.json` with shape
  `{ sourceSha256: {regular,bold}, charsetHash: {site, articles: Record<slug,string>}, files: { site: {regular,bold}, articles: Record<slug,{regular,bold}> } }`
  where each `{regular,bold}` is a public path like `/fonts/zh/earn.regular.<hash>.woff2`.

- [ ] **Step 1: Add dependencies**

Run:
```bash
npm install --save-dev subset-font fontkit @types/fontkit
```
Expected: `subset-font`, `fontkit` appear in `devDependencies`.

- [ ] **Step 2: Write the font-sources config**

```ts
// scripts/font-sources.ts
import { join } from "node:path";

export const CSS_ZH_FAMILY = "PGCN Song";   // custom name — avoids OFL reserved name "Source"
export const ASSETS_FONT_DIR = join(process.cwd(), "assets", "fonts");

// Pinned Source Han Serif SC (OTF). Fill SHA-256 in Step 4 after downloading.
export const RAW_FONTS = {
  regular: { file: "SourceHanSerifSC-Regular.otf", sha256: "__FILL_ME__" },
  bold:    { file: "SourceHanSerifSC-Bold.otf",    sha256: "__FILL_ME__" },
} as const;
export type Weight = keyof typeof RAW_FONTS;
```

- [ ] **Step 3: Write the subsetting script**

```ts
// scripts/subset-fonts.ts
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import subsetFont from "subset-font";
import { readAllArticles } from "../pipeline/store.js";
import { collectArticleChars, collectSiteChars } from "./lib/chars.js";
import { RAW_FONTS, ASSETS_FONT_DIR, type Weight } from "./font-sources.js";

const OUT_DIR = join(process.cwd(), "public", "fonts", "zh");
const MANIFEST = join(process.cwd(), "public", "fonts", "manifest.json");
const ARTICLES_DIR = join(process.cwd(), "content", "articles");
const WEIGHTS: Weight[] = ["regular", "bold"];

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}
function charsetHash(chars: Set<string>): string {
  return sha256([...chars].sort().join(""));
}

async function loadRaw(weight: Weight): Promise<Buffer> {
  const { file, sha256: want } = RAW_FONTS[weight];
  let buf: Buffer;
  try { buf = await readFile(join(ASSETS_FONT_DIR, file)); }
  catch { throw new Error(`Missing raw font ${file}. Place Source Han Serif SC OTFs in assets/fonts/ (adobe-fonts/source-han-serif release).`); }
  const got = sha256(buf);
  if (want !== "__FILL_ME__" && got !== want) throw new Error(`SHA-256 mismatch for ${file}: got ${got}`);
  return buf;
}

async function emit(raw: Buffer, chars: Set<string>, prefix: string, weight: Weight): Promise<string> {
  const text = [...chars].join("");
  const sub = await subsetFont(raw, text, { targetFormat: "woff2" });
  const hash = sha256(sub).slice(0, 10);
  const name = `${prefix}.${weight}.${hash}.woff2`;
  await writeFile(join(OUT_DIR, name), sub);
  return `/fonts/zh/${name}`;
}

async function main() {
  const articles = await readAllArticles(ARTICLES_DIR);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const raws = { regular: await loadRaw("regular"), bold: await loadRaw("bold") };

  const manifest: any = {
    sourceSha256: { regular: sha256(raws.regular), bold: sha256(raws.bold) },
    charsetHash: { site: "", articles: {} as Record<string, string> },
    files: { site: {}, articles: {} as Record<string, any> },
  };

  const siteChars = collectSiteChars(articles);
  manifest.charsetHash.site = charsetHash(siteChars);
  for (const w of WEIGHTS) manifest.files.site[w] = await emit(raws[w], siteChars, "_site", w);

  for (const a of articles) {
    const chars = collectArticleChars(a);
    manifest.charsetHash.articles[a.slug] = charsetHash(chars);
    manifest.files.articles[a.slug] = {};
    for (const w of WEIGHTS) manifest.files.articles[a.slug][w] = await emit(raws[w], chars, a.slug, w);
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  const n = articles.length;
  console.log(`fonts: ${n} articles × ${WEIGHTS.length} + site subset → public/fonts/zh/`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Wire package.json + gitignore, place raw fonts**

Add to `package.json` scripts: `"fonts": "tsx scripts/subset-fonts.ts"`. Add `assets/fonts/` to `.gitignore`. Download the two OTFs into `assets/fonts/`, run `sha256sum`, and paste the digests into `scripts/font-sources.ts`.

- [ ] **Step 5: Generate and sanity-check**

Run: `npm run fonts && ls public/fonts/zh | head && du -sh public/fonts`
Expected: hundreds of `*.woff2` files, manifest present, individual files roughly ≤ ~250KB.

- [ ] **Step 6: Commit (including generated fonts)**

```bash
git add scripts/font-sources.ts scripts/subset-fonts.ts package.json package-lock.json .gitignore public/fonts
git commit -m "feat(fonts): per-essay WOFF2 subsetting + committed output"
```

---

### Task 3: `verify-fonts` build gate

**Files:**
- Create: `scripts/verify-fonts.ts`, `scripts/verify-fonts.test.ts`
- Modify: `package.json` (`build` script)

**Interfaces:**
- Consumes: manifest from Task 2; `collectArticleChars`/`collectSiteChars` (Task 1); `readAllArticles`.
- Produces: `verifyFonts(opts): Promise<string[]>` returning a list of problems (empty = OK); a CLI wrapper that exits non-zero when problems exist.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/verify-fonts.test.ts
import { describe, it, expect } from "vitest";
import { checkManifest } from "./verify-fonts.js";
import type { Article } from "../shared/article-schema.js";
import { collectArticleChars, collectSiteChars } from "./lib/chars.js";
import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const csh = (set: Set<string>) => sha([...set].sort().join(""));
const a: Article = { slug: "x", titleEn: "T", titleZh: "标题", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 1, sourceUrl: "https://paulgraham.com/x.html",
  translatedAt: "2026-07-09", model: "m",
  segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "e", zhMarkdown: "你好" }] };

function goodManifest(list: Article[]) {
  return { charsetHash: { site: csh(collectSiteChars(list)),
    articles: Object.fromEntries(list.map(x => [x.slug, csh(collectArticleChars(x))])) },
    files: { site: { regular: "/f/s.r.woff2", bold: "/f/s.b.woff2" },
      articles: Object.fromEntries(list.map(x => [x.slug, { regular: `/f/${x.slug}.r.woff2`, bold: `/f/${x.slug}.b.woff2` }])) } };
}

describe("checkManifest", () => {
  it("passes when charset hashes match", () => {
    expect(checkManifest([a], goodManifest([a]), () => true)).toEqual([]);
  });
  it("flags stale fonts when content charset changed", () => {
    const stale = goodManifest([a]);
    stale.charsetHash.articles["x"] = "deadbeef";
    expect(checkManifest([a], stale, () => true)).toEqual(
      expect.arrayContaining([expect.stringContaining("x")]));
  });
  it("flags a missing article entry", () => {
    const m = goodManifest([]);
    expect(checkManifest([a], m, () => true).length).toBeGreaterThan(0);
  });
  it("flags a missing file on disk", () => {
    expect(checkManifest([a], goodManifest([a]), () => false).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/verify-fonts.test.ts`
Expected: FAIL — `Cannot find module './verify-fonts.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/verify-fonts.ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readAllArticles } from "../pipeline/store.js";
import { collectArticleChars, collectSiteChars } from "./lib/chars.js";
import type { Article } from "../shared/article-schema.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const csh = (set: Set<string>) => sha([...set].sort().join(""));

export function checkManifest(
  articles: Article[],
  m: { charsetHash: { site: string; articles: Record<string, string> };
       files: { site: { regular: string; bold: string };
                articles: Record<string, { regular: string; bold: string }> } },
  fileExists: (publicPath: string) => boolean,
): string[] {
  const problems: string[] = [];
  if (m.charsetHash.site !== csh(collectSiteChars(articles)))
    problems.push("site subset charset stale — rerun `npm run fonts`");
  for (const [p] of [["site", m.files.site]] as const)
    for (const w of ["regular", "bold"] as const)
      if (!fileExists(m.files.site[w])) problems.push(`missing file: ${p} ${w}`);

  for (const a of articles) {
    const want = csh(collectArticleChars(a));
    if (m.charsetHash.articles[a.slug] !== want)
      problems.push(`article ${a.slug} charset stale — rerun \`npm run fonts\``);
    const f = m.files.articles[a.slug];
    if (!f) { problems.push(`article ${a.slug} missing from manifest`); continue; }
    for (const w of ["regular", "bold"] as const)
      if (!fileExists(f[w])) problems.push(`missing file: ${a.slug} ${w}`);
  }
  const known = new Set(articles.map((x) => x.slug));
  for (const slug of Object.keys(m.charsetHash.articles))
    if (!known.has(slug)) problems.push(`stale manifest entry for removed article ${slug}`);
  return problems;
}

async function main() {
  const root = process.cwd();
  const articles = await readAllArticles(join(root, "content", "articles"));
  const m = JSON.parse(await readFile(join(root, "public", "fonts", "manifest.json"), "utf8"));
  const problems = checkManifest(articles, m, (p) => existsSync(join(root, "public", p)));
  if (problems.length) {
    console.error("✗ font verification failed:\n" + problems.map((p) => "  - " + p).join("\n"));
    console.error("\nRun `npm run fonts` and commit public/fonts/.");
    process.exit(1);
  }
  console.log(`✓ fonts verified (${articles.length} articles)`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run tests + wire build**

Change `package.json` `build` to `"tsx scripts/verify-fonts.ts && astro build"`.
Run: `npx vitest run scripts/verify-fonts.test.ts && npm run build`
Expected: unit tests PASS; `verify-fonts` prints ✓ and Astro builds `dist/`.

- [ ] **Step 5: Prove the gate catches stale fonts**

Run: `printf '\\n' >> content/articles/earn.json; npm run build; git checkout content/articles/earn.json`
Expected: build **fails** with "charset stale" for `earn` (JSON whitespace change is harmless; the point is to see a failure path — then restore). If the trailing newline doesn't change the charset, instead temporarily add a CJK char to a `zhMarkdown` in a scratch copy to observe the failure, then discard.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-fonts.ts scripts/verify-fonts.test.ts package.json
git commit -m "feat(fonts): read-only verify-fonts build gate"
```

---

### Task 4: Design tokens + @font-face base (global.css)

**Files:**
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: CSS custom properties (`--paper --ink --muted --rule --accent --measure --zh --en`) for light + dark; `@font-face` for Newsreader (Latin, self-hosted); base `body` typography. Chinese `@font-face` is emitted per-page (Tasks 6–7), not here.

- [ ] **Step 1: Add Newsreader web fonts**

Download Newsreader (Latin) Regular + Italic (+ Bold) as WOFF2 into `public/fonts/latin/`. Commit them.

- [ ] **Step 2: Rewrite the token + base layer**

Replace the top of `src/styles/global.css` with:

```css
@font-face { font-family:"Newsreader"; font-style:normal; font-weight:400;
  src:url("/fonts/latin/Newsreader-Regular.woff2") format("woff2"); font-display:swap; }
@font-face { font-family:"Newsreader"; font-style:italic; font-weight:400;
  src:url("/fonts/latin/Newsreader-Italic.woff2") format("woff2"); font-display:swap; }
@font-face { font-family:"Newsreader"; font-style:normal; font-weight:600;
  src:url("/fonts/latin/Newsreader-SemiBold.woff2") format("woff2"); font-display:swap; }

:root {
  --paper:#f7f4ec; --ink:#26221b; --muted:#71695b; --rule:#e0d9ca; --accent:#a1552f;
  --measure:36rem;
  --zh:"PGCN Song","Noto Serif SC","Songti SC",serif;
  --en:"Newsreader",Georgia,serif;
}
:root[data-theme="dark"] {
  --paper:#1c1a16; --ink:#e7e1d4; --muted:#a89f8e; --rule:#332f27; --accent:#d08a5e;
}
* { box-sizing:border-box; }
html { font-size:18px; }
body { margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--zh); line-height:2.0; -webkit-font-smoothing:antialiased; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
```

Keep the rest of the file for now (superseded pieces are replaced in Tasks 5–9).

- [ ] **Step 3: Verify contrast**

Compute WCAG ratios for `--muted`/`--accent` on `--paper` in both themes (any contrast tool). Adjust hex until all ≥ 4.5:1. Record the final values.
Expected: `#71695b` on `#f7f4ec` ≈ 5.2:1; dark `--muted` `#a89f8e` on `#1c1a16` ≥ 4.5:1.

- [ ] **Step 4: Build to confirm no CSS errors**

Run: `npm run build`
Expected: builds; English text renders in Newsreader.

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css public/fonts/latin
git commit -m "feat(design): color tokens + Newsreader @font-face, warm dark palette"
```

---

### Task 5: Segment classification + ArticleBody rewrite

**Files:**
- Create: `src/lib/segments.ts`, `src/lib/segments.test.ts`
- Modify: `src/components/ArticleBody.astro`

**Interfaces:**
- Consumes: `Segment`, `isTranslatable`; `isUntranslated` semantics (reuse via local copy for `src/`).
- Produces: `classifySegment(seg): { kind: "hr" } | { kind: "original", md: string } | { kind: "translated", zh: string, en: string }`.
  - `hr` → rule. `original` = rawUnsupported OR untranslated translatable (empty zh) → render English once, marked 未译原文, no `.seg-en`. `translated` → zh + hidden en for 对照.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/segments.test.ts
import { describe, it, expect } from "vitest";
import { classifySegment } from "./segments.js";

describe("classifySegment", () => {
  it("hr", () => expect(classifySegment({ id:1, type:"hr", sourceHash:"h" }).kind).toBe("hr"));
  it("rawUnsupported -> original english", () => {
    const r = classifySegment({ id:1, type:"rawUnsupported", sourceHash:"h", enMarkdown:"code" });
    expect(r).toEqual({ kind:"original", md:"code" });
  });
  it("empty zh translatable -> original english (no double render)", () => {
    const r = classifySegment({ id:1, type:"paragraph", sourceHash:"h", enMarkdown:"note", zhMarkdown:"  " });
    expect(r).toEqual({ kind:"original", md:"note" });
  });
  it("translated -> zh + en", () => {
    const r = classifySegment({ id:1, type:"paragraph", sourceHash:"h", enMarkdown:"E", zhMarkdown:"中" });
    expect(r).toEqual({ kind:"translated", zh:"中", en:"E" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/segments.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/segments.ts
import { isTranslatable, type Segment } from "../../shared/article-schema.js";

export type RenderSeg =
  | { kind: "hr" }
  | { kind: "original"; md: string }
  | { kind: "translated"; zh: string; en: string };

export function classifySegment(seg: Segment): RenderSeg {
  if (seg.type === "hr") return { kind: "hr" };
  const zh = seg.zhMarkdown?.trim();
  if (isTranslatable(seg.type) && zh) return { kind: "translated", zh: seg.zhMarkdown!, en: seg.enMarkdown ?? "" };
  return { kind: "original", md: seg.enMarkdown ?? "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite ArticleBody.astro**

```astro
---
import { renderMarkdown } from "../lib/markdown.js";
import { classifySegment } from "../lib/segments.js";
import type { Segment } from "../../shared/article-schema.js";

interface Props { segments: Segment[] }
const { segments } = Astro.props;

const rendered = await Promise.all(segments.map(async (s) => {
  const c = classifySegment(s);
  if (c.kind === "hr") return { kind: "hr" as const };
  if (c.kind === "original") return { kind: "original" as const, html: await renderMarkdown(c.md) };
  return { kind: "translated" as const, zh: await renderMarkdown(c.zh), en: await renderMarkdown(c.en) };
}));
---
<div class="article-body">
  {rendered.map((r) =>
    r.kind === "hr" ? <hr /> :
    r.kind === "original" ? (
      <div class="seg seg--original">
        <span class="seg-mark">未译原文</span>
        <div set:html={r.html} />
      </div>
    ) : (
      <div class="seg">
        <div class="seg-zh" set:html={r.zh} />
        <div class="seg-en" set:html={r.en} />
      </div>
    )
  )}
</div>
```

Note: no `tabindex` anywhere. `.seg--original` styling (left rule + small label) is added in Task 8.

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/segments.ts src/lib/segments.test.ts src/components/ArticleBody.astro
git commit -m "feat(reading): 中文优先 rendering, mark 未译原文, drop tabindex"
```

---

### Task 6: Article page — layout, per-page fonts, toggle, footer nav

**Files:**
- Create: `src/lib/adjacent.ts`, `src/lib/adjacent.test.ts`
- Modify: `src/pages/[slug].astro`

**Interfaces:**
- Consumes: `sortArticles` from `../lib/sort.js`; font `manifest.json`; `classifySegment` (already used by ArticleBody).
- Produces: `withNeighbors(sorted): Array<{ article; prev: {slug,titleZh}|null; next: {slug,titleZh}|null }>` (prev = newer/earlier-in-list, next = older/later-in-list).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/adjacent.test.ts
import { describe, it, expect } from "vitest";
import { withNeighbors } from "./adjacent.js";

const A = (slug: string) => ({ slug, titleZh: slug.toUpperCase() });

describe("withNeighbors", () => {
  it("links prev/next along the sorted order with nulls at ends", () => {
    const out = withNeighbors([A("a"), A("b"), A("c")] as any);
    expect(out[0].prev).toBeNull();
    expect(out[0].next).toEqual({ slug: "b", titleZh: "B" });
    expect(out[1].prev).toEqual({ slug: "a", titleZh: "A" });
    expect(out[2].next).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/adjacent.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/adjacent.ts
type Ref = { slug: string; titleZh: string };
export function withNeighbors<T extends Ref>(sorted: T[]): Array<{ article: T; prev: Ref | null; next: Ref | null }> {
  return sorted.map((article, i) => ({
    article,
    prev: i > 0 ? { slug: sorted[i - 1].slug, titleZh: sorted[i - 1].titleZh } : null,
    next: i < sorted.length - 1 ? { slug: sorted[i + 1].slug, titleZh: sorted[i + 1].titleZh } : null,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/adjacent.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite [slug].astro**

```astro
---
import { getCollection } from "astro:content";
import Base from "../layouts/Base.astro";
import ArticleBody from "../components/ArticleBody.astro";
import { sortArticles } from "../lib/sort.js";
import { withNeighbors } from "../lib/adjacent.js";
import fontManifest from "../../public/fonts/manifest.json";

export async function getStaticPaths() {
  const entries = await getCollection("articles");
  const sorted = sortArticles(entries.map((e) => e.data));
  return withNeighbors(sorted).map(({ article, prev, next }) => ({
    params: { slug: article.slug }, props: { article, prev, next },
  }));
}
const { article, prev, next } = Astro.props;
const canonical = `https://paulgraham-cn.com/${article.slug}.html`;
const f = (fontManifest as any).files.articles[article.slug];
---
<Base title={article.titleZh} description={article.titleEn} canonical={canonical}>
  <style is:inline set:html={`
    @font-face{font-family:"PGCN Song";font-weight:400;font-display:swap;src:url("${f.regular}") format("woff2")}
    @font-face{font-family:"PGCN Song";font-weight:700;font-display:swap;src:url("${f.bold}") format("woff2")}
  `}></style>
  <main class="article">
    <p class="kicker">{article.dateText} · Paul Graham</p>
    <h1 class="article-title">{article.titleZh}</h1>
    <hr class="title-rule" />
    <div class="article-meta">
      <a href={article.sourceUrl} rel="nofollow">原文</a>
      <button id="read-toggle" aria-pressed="false">双语对照</button>
    </div>
    <ArticleBody segments={article.segments} />
    <nav class="article-nav">
      <a href="/">← 返回目录</a>
      <span>
        {prev && <a href={`/${prev.slug}.html`}>上一篇</a>}
        {next && <a href={`/${next.slug}.html`}>下一篇</a>}
      </span>
    </nav>
  </main>
  <script is:inline>
    (() => {
      const saved = localStorage.getItem("read");
      if (saved === "bilingual") document.body.dataset.read = "bilingual";
      const btn = document.getElementById("read-toggle");
      const sync = () => { const on = document.body.dataset.read === "bilingual";
        btn.setAttribute("aria-pressed", String(on)); };
      sync();
      btn?.addEventListener("click", () => {
        const on = document.body.dataset.read === "bilingual";
        document.body.dataset.read = on ? "zh" : "bilingual";
        localStorage.setItem("read", on ? "zh" : "bilingual");
        sync();
      });
    })();
  </script>
</Base>
```

- [ ] **Step 6: Build + eyeball one article**

Run: `npm run build && npx astro preview &` then open `/earn.html`.
Expected: 静谧古典 header, Chinese in PGCN Song, working 双语对照 toggle, footer nav. Stop preview after.

- [ ] **Step 7: Commit**

```bash
git add src/lib/adjacent.ts src/lib/adjacent.test.ts src/pages/[slug].astro
git commit -m "feat(reading): article page layout, per-page fonts, toggle, footer nav"
```

---

### Task 7: Homepage — 年鉴编年 + instant search

**Files:**
- Create: `src/lib/group.ts`, `src/lib/group.test.ts`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `sortArticles`; font manifest `files.site`.
- Produces: `groupByYear(sorted): Array<{ year: string | null; items: T[] }>` — descending years, then a trailing `{ year: null }` (日期不详) group whose items keep `sortArticles` order.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/group.test.ts
import { describe, it, expect } from "vitest";
import { groupByYear } from "./group.js";

const A = (slug: string, publishedAt: string | null, sourceOrder = 0) =>
  ({ slug, publishedAt, sourceOrder });

describe("groupByYear", () => {
  it("descending year groups with 日期不详 (null) last", () => {
    const g = groupByYear([
      A("a", "2026-06-01"), A("b", "2024-09-01"), A("c", "2026-01-01"), A("d", null, 5),
    ] as any);
    expect(g.map((x) => x.year)).toEqual(["2026", "2024", null]);
    expect(g[0].items.map((i: any) => i.slug)).toEqual(["a", "c"]);
    expect(g[2].items.map((i: any) => i.slug)).toEqual(["d"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/group.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/group.ts
export function groupByYear<T extends { publishedAt: string | null }>(
  sorted: T[],
): Array<{ year: string | null; items: T[] }> {
  const groups: Array<{ year: string | null; items: T[] }> = [];
  const byYear = new Map<string, T[]>();
  const undated: T[] = [];
  for (const a of sorted) {
    if (a.publishedAt) {
      const y = a.publishedAt.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(a);
    } else undated.push(a);
  }
  for (const y of [...byYear.keys()].sort().reverse()) groups.push({ year: y, items: byYear.get(y)! });
  if (undated.length) groups.push({ year: null, items: undated });
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/group.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite index.astro**

```astro
---
import { getCollection } from "astro:content";
import Base from "../layouts/Base.astro";
import { sortArticles } from "../lib/sort.js";
import { groupByYear } from "../lib/group.js";
import fontManifest from "../../public/fonts/manifest.json";

const entries = await getCollection("articles");
const groups = groupByYear(sortArticles(entries.map((e) => e.data)));
const total = entries.length;
const site = (fontManifest as any).files.site;
---
<Base title="Paul Graham 文集（中文）" description="Paul Graham 文章的中文翻译">
  <style is:inline set:html={`
    @font-face{font-family:"PGCN Song";font-weight:400;font-display:swap;src:url("${site.regular}") format("woff2")}
    @font-face{font-family:"PGCN Song";font-weight:700;font-display:swap;src:url("${site.bold}") format("woff2")}
  `}></style>
  <main class="home">
    <header class="home-mast">
      <h1>Paul Graham 文集</h1>
      <p class="home-sub">共 {total} 篇 · 中文翻译</p>
      <label class="home-search">
        <span class="visually-hidden">搜索标题</span>
        <input id="q" type="search" placeholder="搜索标题…" autocomplete="off" />
      </label>
      <p id="empty" class="home-empty" aria-live="polite" hidden>没有匹配的文章</p>
    </header>
    <div id="index">
      {groups.map((g) => (
        <section class="yr-group" data-group>
          <div class="yr">{g.year ?? "日期不详"}</div>
          <ul class="yr-items">
            {g.items.map((a) => (
              <li class="row" data-title={`${a.titleZh} ${a.titleEn}`.toLowerCase()}>
                <a href={`/${a.slug}.html`}>{a.titleZh}</a>
                <span class="row-en">{a.titleEn} · {a.dateText}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </main>
  <script is:inline>
    (() => {
      const q = document.getElementById("q"), empty = document.getElementById("empty");
      q?.addEventListener("input", () => {
        const term = q.value.trim().toLowerCase();
        let shown = 0;
        for (const row of document.querySelectorAll(".row")) {
          const hit = !term || row.dataset.title.includes(term);
          row.hidden = !hit; if (hit) shown++;
        }
        for (const g of document.querySelectorAll("[data-group]")) {
          g.hidden = !g.querySelector(".row:not([hidden])");
        }
        empty.hidden = shown !== 0;
      });
    })();
  </script>
</Base>
```

- [ ] **Step 6: Build + eyeball homepage**

Run: `npm run build && npx astro preview &` then open `/`. Type in the search box.
Expected: year groups with 日期不详 last; typing filters rows and hides empty groups; empty-state message appears for no matches. Stop preview.

- [ ] **Step 7: Commit**

```bash
git add src/lib/group.ts src/lib/group.test.ts src/pages/index.astro
git commit -m "feat(home): 年鉴编年 grouping + instant accessible search"
```

---

### Task 8: Visual polish CSS — article, homepage, reading modes, 未译原文

**Files:**
- Modify: `src/styles/global.css`

**Interfaces:** none (styling only). Replaces the leftover old rules from the original file.

- [ ] **Step 1: Replace the layout/reading-mode/homepage CSS**

Remove the old `main`, `.article-meta`, `.article-list`, `.seg*`, `:hover`-reveal rules and add:

```css
main.article, main.home { max-width:var(--measure); margin:0 auto; padding:3rem 1.25rem 5rem; }

/* Article header — 静谧古典 */
.kicker { text-align:center; font-family:var(--en); font-size:.8rem; letter-spacing:.2em;
  text-transform:uppercase; color:var(--muted); margin:0 0 1rem; }
.article-title { text-align:center; font-family:var(--zh); font-weight:700; font-size:2.35rem;
  line-height:1.35; margin:0 auto; max-width:20ch; }
.title-rule { width:56px; border:0; border-top:1px solid var(--rule); margin:1.4rem auto 1.8rem; }
.article-meta { display:flex; gap:1rem; justify-content:center; align-items:center;
  color:var(--muted); font-family:var(--en); font-size:.9rem; margin-bottom:2.6rem; }
button#read-toggle { font:inherit; color:inherit; background:none; border:1px solid var(--rule);
  border-radius:6px; padding:.25rem .7rem; cursor:pointer; }
button#read-toggle[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); }

/* Body */
.article-body { font-size:19px; letter-spacing:.005em; }
.seg { margin:0 0 1.35rem; }
.seg-zh p, .article-body > .seg > div > p { text-indent:2em; margin:0; }
.seg-en { display:none; font-family:var(--en); font-style:italic; color:var(--muted);
  font-size:.95rem; line-height:1.7; }
body[data-read="bilingual"] .seg-en { display:block; margin-top:.4rem; }
.seg--original { border-left:2px solid var(--rule); padding-left:1rem; color:var(--ink); }
.seg--original .seg-mark { display:block; font-family:var(--en); font-size:.7rem;
  letter-spacing:.15em; text-transform:uppercase; color:var(--muted); margin-bottom:.3rem; }
hr { border:0; border-top:1px solid var(--rule); margin:2rem auto; width:56px; }

/* Footer nav */
.article-nav { display:flex; justify-content:space-between; gap:1rem; margin-top:3rem;
  padding-top:1.5rem; border-top:1px solid var(--rule); font-family:var(--en); font-size:.9rem; }
.article-nav span { display:flex; gap:1.2rem; }

/* Homepage — 年鉴 */
.home-mast { text-align:center; margin-bottom:2.5rem; }
.home-mast h1 { font-family:var(--zh); font-weight:700; font-size:1.9rem; margin:0; }
.home-sub { font-family:var(--en); font-style:italic; color:var(--muted); margin:.5rem 0 1.4rem; }
.home-search input { font:inherit; font-family:var(--zh); width:min(22rem,100%); text-align:center;
  padding:.55rem 1rem; border:1px solid var(--rule); border-radius:22px; background:transparent; color:var(--ink); }
.home-search input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
.home-empty { text-align:center; color:var(--muted); }
.yr-group { display:grid; grid-template-columns:5rem 1fr; gap:0 1.25rem; margin-bottom:1.5rem; }
.yr { font-family:var(--en); font-weight:600; font-size:1.5rem; color:var(--accent); padding-top:.8rem; }
.yr-items { list-style:none; margin:0; padding:0; }
.row { padding:.8rem 0; border-top:1px solid var(--rule); }
.row a { font-family:var(--zh); font-size:1.1rem; }
.row-en { display:block; font-family:var(--en); font-size:.8rem; color:var(--muted); margin-top:.2rem; }

@media (max-width:640px) {
  .yr-group { grid-template-columns:1fr; gap:0; }
  .yr { padding-top:1.2rem; }
}
```

- [ ] **Step 2: Build + eyeball both pages at desktop and 320px**

Run: `npm run build && npx astro preview &`
Expected: article + homepage render in the intended style; at 320px the year number stacks above its list and body isn't crushed. Stop preview.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(design): 静谧古典 + 年鉴 CSS, reading modes, 未译原文, responsive"
```

---

### Task 9: Footer attribution, OFL bundle, README, final verification

**Files:**
- Create: `public/OFL.txt`
- Modify: `src/layouts/Base.astro`, `README.md`

- [ ] **Step 1: Bundle the license**

Copy the SIL Open Font License text into `public/OFL.txt`.

- [ ] **Step 2: Add footer attribution to Base.astro**

Add before `</body>` (after `<slot />`):

```astro
<footer class="site-footer">
  <span>中文字体 思源宋体 · 西文 Newsreader · <a href="/OFL.txt">SIL OFL</a></span>
</footer>
```

And in `global.css`:

```css
.site-footer { max-width:var(--measure); margin:0 auto; padding:2rem 1.25rem 3rem;
  color:var(--muted); font-family:var(--en); font-size:.8rem; text-align:center; }
```

- [ ] **Step 3: Update README fonts section**

Add a "Fonts" section documenting: `npm run fonts` regenerates subsets **after content changes**; committed WOFF2 means `npm run dev` needs no font step; `assets/fonts/` holds the raw OTFs (not committed); `npm run build` verifies fonts and fails if stale.

- [ ] **Step 4: Full clean-ish build + suite**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; `verify-fonts` ✓; `dist/` produced; `dist/OFL.txt` present.

- [ ] **Step 5: Note on internal font name (RFN)**

The CSS family is the custom `"PGCN Song"` and OFL is bundled + attributed. `subset-font` does **not** rewrite the OTF `name` table, so the subset's *internal* name still reads "Source Han Serif SC". If strict OFL Reserved-Font-Name compliance requires renaming the internal name table too, that is a **follow-up** (e.g. a `fonttools`/`opentype.js` rename pass) tracked separately — it does not block this redesign. Record this decision in the commit message.

- [ ] **Step 6: Commit**

```bash
git add public/OFL.txt src/layouts/Base.astro src/styles/global.css README.md
git commit -m "chore(fonts): bundle OFL, footer attribution, README; note RFN follow-up"
```

---

## Self-Review

**Spec coverage:**
- §1 tokens/typography → Task 4, 8. §2 article page → Task 6, 8. §3 双语 toggle + remove hover/tabindex → Task 5, 6, 8. §4 homepage 年鉴 + 日期不详 + search a11y + responsive + footer nav → Task 6, 7, 8. §5 subset build + coverage + weights + hash names + verify gate + license + dev note → Task 1, 2, 3, 4, 9. §6 dark mode → Task 4. §7 out-of-scope respected (no pipeline/content edits; no data backfill; the 9 empty segs handled at render). Acceptance criteria → covered across tasks (contrast T4, coverage/verify T2–3, budget T2, a11y T5–8, responsive T8, nav T6–7, license T9). **No gaps.**
- **Backfill note:** the 9 empty `zhMarkdown` segments are intentionally rendered as marked 未译原文 (spec decision), not translated — consistent with "don't touch pipeline/content".

**Placeholder scan:** `__FILL_ME__` SHA-256 in Task 2 is a real value the implementer inserts after downloading the pinned OTF (Task 2 Step 4) — intentional, not a plan gap. The chars.test.ts `'n'` assertion is explicitly corrected in Task 1 Step 3. No other placeholders.

**Type consistency:** `collectArticleChars`/`collectSiteChars` (Task 1) reused verbatim in Tasks 2–3. Manifest shape (`files.articles[slug].{regular,bold}`, `files.site.{regular,bold}`, `charsetHash.*`) is identical across Tasks 2, 3, 6, 7. `classifySegment` return union (Task 5) consumed by ArticleBody. `withNeighbors`/`groupByYear` signatures match their consumers. `"PGCN Song"` family string identical in Task 4/6/7 CSS.
