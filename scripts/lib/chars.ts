import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { isTranslatable, type Article, type Segment } from "../../shared/article-schema.js";
import { TAGS } from "../../shared/tags.js";

const mdParser = unified().use(remarkParse);
type MdNode = { type?: string; value?: string; children?: MdNode[] };

function textOf(node: MdNode): string {
  return typeof node.value === "string" ? node.value : (node.children ?? []).map(textOf).join("");
}

// Fixed Chinese chrome that must be renderable on EVERY page (article + home),
// so each per-page subset includes these glyphs.
export const SHARED_UI_TEXT = [
  "Paul Graham 中文", "文集", "共 篇 · 中文翻译", "原文", "双语对照", "中文优先",
  "未译原文", "返回目录", "上一篇", "下一篇", "日期不详", "搜索标题…",
  "没有匹配的文章", "切换主题", "切换双语", "字体", "思源宋体",
].join("");

// Tag chrome, from the same vocabulary the site renders. The names are an h1 on
// a tag page (weight 700) and chip labels (regular); the hints are regular only.
// Most of these glyphs are already in the corpus, but relying on that is how a
// tag name quietly falls back to a system font.
export const TAG_NAMES = TAGS.map((t) => t.zh).join("");
export const TAG_HINTS = TAGS.map((t) => t.hint).join("");

export function isUntranslated(seg: Segment): boolean {
  return isTranslatable(seg.type) && !seg.zhMarkdown?.trim();
}

// Static pages (about, 404, the home intro) are not part of the article corpus,
// so Chinese that appears only there falls back to a system font — 「关于本站」's
// 站 was missing from the bold face for exactly that reason. Scan the site
// source instead of hand-copying the prose: any chrome added to src/ joins the
// subset on the next `npm run fonts`, and verify-fonts flags it as stale until
// then.
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(astro|ts|css)$/.test(e.name) ? [p] : [];
    });
  return walk(join(process.cwd(), "src"));
}

// Only CJK is taken: Latin and code punctuation are already covered by the
// corpus, and including every identifier in src/ would make the set meaningless.
export function collectSourceChars(): Set<string> {
  const set = new Set<string>();
  for (const file of sourceFiles()) {
    for (const ch of readFileSync(file, "utf8")) if (CJK.test(ch)) set.add(ch);
  }
  return set;
}

// Static pages render bold text only as headings, so heading text — not the
// whole source — is what the bold face needs.
export function collectSourceHeadingChars(): Set<string> {
  const set = new Set<string>();
  for (const file of sourceFiles()) {
    if (!file.endsWith(".astro")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)) {
      addCodePoints(set, m[1].replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, ""));
    }
  }
  return set;
}

function addCodePoints(set: Set<string>, s: string | undefined): void {
  if (!s) return;
  for (const ch of s) set.add(ch);
}

export function collectArticleChars(a: Article): Set<string> {
  const set = new Set<string>();
  addCodePoints(set, a.titleZh);
  for (const seg of a.segments) {
    if (!isUntranslated(seg)) addCodePoints(set, seg.zhMarkdown);
  }
  addCodePoints(set, SHARED_UI_TEXT);
  return set;
}

export function collectSiteChars(list: Article[]): Set<string> {
  const set = new Set<string>();
  for (const a of list) { addCodePoints(set, a.titleZh); addCodePoints(set, a.dateText); }
  addCodePoints(set, SHARED_UI_TEXT);
  addCodePoints(set, TAG_NAMES);
  return set;
}

// The whole corpus's distinct code points — used for the single site-wide font
// subset (one shared WOFF2 per weight instead of per-essay).
export function collectAllChars(list: Article[]): Set<string> {
  const set = new Set<string>();
  for (const a of list) for (const ch of collectArticleChars(a)) set.add(ch);
  addCodePoints(set, TAG_NAMES);
  addCodePoints(set, TAG_HINTS);
  for (const ch of collectSourceChars()) set.add(ch);
  return set;
}

// The code points actually rendered at font-weight 700 in Chinese: article
// titles (h1) and `<strong>` spans. Everything else uses the regular face, so
// subsetting the bold face to just these roughly halves its size.
// Parsed with remark rather than matched with a `__…__` regex — `__init__`
// inside a code span is not bold.
export function collectBoldChars(list: Article[]): Set<string> {
  const set = new Set<string>();
  for (const a of list) {
    addCodePoints(set, a.titleZh);
    for (const seg of a.segments) {
      if (isUntranslated(seg)) continue;
      const visit = (node: MdNode): void => {
        if (node.type === "strong") addCodePoints(set, textOf(node));
        node.children?.forEach(visit);
      };
      visit(mdParser.parse(seg.zhMarkdown ?? "") as MdNode);
    }
  }
  addCodePoints(set, SHARED_UI_TEXT);
  addCodePoints(set, TAG_NAMES);
  for (const ch of collectSourceHeadingChars()) set.add(ch);
  return set;
}
