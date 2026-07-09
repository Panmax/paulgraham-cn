import { describe, it, expect } from "vitest";
import { SHARED_UI_TEXT, isUntranslated, collectArticleChars, collectSiteChars } from "./chars.js";
import type { Article } from "../../shared/article-schema.js";

const art = (over: Partial<Article> = {}): Article => ({
  slug: "x", titleEn: "T", titleZh: "标题", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 1, sourceUrl: "https://paulgraham.com/x.html",
  translatedAt: "2026-07-09", model: "m",
  segments: [
    { id: 1, type: "paragraph", sourceHash: "h1", enMarkdown: "Y Combinator", zhMarkdown: "你好 YC 6500，" },
    { id: 2, type: "paragraph", sourceHash: "h2", enMarkdown: "zzz", zhMarkdown: "" },   // untranslated
    { id: 3, type: "rawUnsupported", sourceHash: "h3", enMarkdown: "qqq" },
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
  it("isUntranslated returns true for whitespace-only zhMarkdown", () => {
    const seg = { id: 1, type: "paragraph" as const, sourceHash: "h", enMarkdown: "en", zhMarkdown: "   " };
    expect(isUntranslated(seg)).toBe(true);
  });
  it("collectArticleChars includes title + translated zh + latin/digits + UI, excludes empty-seg english", () => {
    const s = collectArticleChars(art());
    for (const ch of ["标", "你", "好", "Y", "C", "6", "5", "0", "，", "原"]) expect(s.has(ch)).toBe(true);
    // Verify that chars from untranslated/unsupported segments are excluded
    expect(s.has("z")).toBe(false); // from untranslated segment enMarkdown "zzz"
    expect(s.has("q")).toBe(false); // from rawUnsupported segment enMarkdown "qqq"
  });
  it("collectSiteChars spans all titles + dateText + UI", () => {
    const s = collectSiteChars([art({ titleZh: "甲" }), art({ titleZh: "乙", slug: "y" })]);
    expect(s.has("甲")).toBe(true); expect(s.has("乙")).toBe(true);
    expect(s.has("J")).toBe(true); // from "June" dateText
  });
});
