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
