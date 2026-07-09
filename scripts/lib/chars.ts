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
    if (!isUntranslated(seg)) addCodePoints(set, seg.zhMarkdown);
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

// The whole corpus's distinct code points — used for the single site-wide font
// subset (one shared WOFF2 per weight instead of per-essay).
export function collectAllChars(list: Article[]): Set<string> {
  const set = new Set<string>();
  for (const a of list) for (const ch of collectArticleChars(a)) set.add(ch);
  return set;
}
