// pipeline/assemble.test.ts
import { describe, it, expect, vi } from "vitest";
import { assembleArticle, normalizeTitle } from "./assemble.js";
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
  it("normalizes Markdown heading markers from translated titles", () => {
    expect(normalizeTitle("# 超线性回报")).toBe("超线性回报");
    expect(normalizeTitle("  ### 超线性回报  ")).toBe("超线性回报");
    expect(normalizeTitle("超线性回报")).toBe("超线性回报");
  });

  it("produces a schema-valid fully-translated new article", async () => {
    const translator = translatorReturning({ 0: "# 如何赚钱", 1: "第一段。", 2: "第二段。" });
    const { article, stats } = await assembleArticle({
      listEntry, parsed, existing: null, translator,
      translatedAt: "2026-07-08", model: "gemini-3.5-flash",
    });
    expect(() => ArticleSchema.parse(article)).not.toThrow();
    expect(article.segments.find((s) => s.type === "hr")?.zhMarkdown).toBeUndefined();
    expect(article.segments.filter((s) => s.type === "paragraph").every((s) => s.zhMarkdown)).toBe(true);
    expect(article.titleZh).toBe("如何赚钱");
    expect(stats.new).toBe(2);
    expect(stats.unchanged).toBe(0);
  });

  it("normalizes a reused title without asking the translator for it", async () => {
    const existing: Article = {
      slug: "earn", titleEn: "How to Earn", titleZh: "# 如何赚钱", dateText: "June 2026",
      publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
      translatedAt: "2026-06-01", model: "gemini-3.5-flash",
      segments: [],
    };
    const translator = translatorReturning({});
    const { article } = await assembleArticle({
      listEntry,
      parsed: { ...parsed, segments: [] },
      existing,
      translator,
      translatedAt: "2026-07-08",
      model: "gemini-3.5-flash",
    });
    expect(article.titleZh).toBe("如何赚钱");
    expect(translator.generate).not.toHaveBeenCalled();
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

  it("re-translates an unchanged segment whose stored translation is blank", async () => {
    const existing: Article = {
      slug: "earn", titleEn: "How to Earn", titleZh: "如何赚钱", dateText: "June 2026",
      publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
      translatedAt: "2026-06-01", model: "gemini-3.5-flash",
      segments: [
        { id: 1, type: "paragraph", sourceHash: "h1", enMarkdown: "First para.", zhMarkdown: "   " },
        { id: 2, type: "hr", sourceHash: "hr1" },
        { id: 3, type: "paragraph", sourceHash: "h2", enMarkdown: "Second para.", zhMarkdown: "第二段。" },
      ],
    };
    const translator = translatorReturning({ 1: "补上的第一段。" });

    const { article } = await assembleArticle({
      listEntry, parsed, existing, translator,
      translatedAt: "2026-07-08", model: "gemini-3.5-flash",
    });

    expect(article.segments.find((s) => s.id === 1)?.zhMarkdown).toBe("补上的第一段。");
    expect(article.segments.find((s) => s.id === 3)?.zhMarkdown).toBe("第二段。");
    const request = JSON.parse(translator.generate.mock.calls[0][1]) as { translateIds: number[] };
    expect(request.translateIds).toEqual([1]);
  });
});
