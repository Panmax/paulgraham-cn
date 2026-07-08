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
