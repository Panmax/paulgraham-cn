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
  return set;
}
