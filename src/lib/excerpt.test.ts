import { describe, it, expect } from "vitest";
import { excerpt, stripMarkdown, articleDescription } from "./excerpt.js";
import type { Article } from "../../shared/article-schema.js";

describe("stripMarkdown", () => {
  it("flattens links, emphasis, code and footnote markers", () => {
    expect(stripMarkdown("这是**加粗**的[链接](https://x.com)和 `code`。[1](https://x.com/f)"))
      .toBe("这是加粗的链接和 code。");
  });
});

describe("excerpt", () => {
  it("truncates on a clean boundary and adds an ellipsis", () => {
    const text = "一二三四五六七八九十".repeat(3);
    const out = excerpt(text, 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(11);
  });
});

describe("articleDescription", () => {
  const article = {
    slug: "earn", titleEn: "How to Earn a Billion Dollars", titleZh: "如何赚到十亿美元",
    dateText: "June 2026", publishedAt: "2026-06-01", sourceOrder: 5,
    sourceUrl: "https://paulgraham.com/earn.html", translatedAt: "2026-10-17", model: "x",
    segments: [
      { id: 1, type: "paragraph", sourceHash: "a", zhMarkdown: "*（本文基于一次演讲。）*" },
      { id: 2, type: "paragraph", sourceHash: "b", zhMarkdown: "这是第一段足够长的正文，用来生成搜索摘要，长度必须超过四十个字符才不会被跳过，所以这里多写一点内容。" },
    ],
  } as Article;

  it("skips short italic notes and leads with the title", () => {
    const d = articleDescription(article);
    expect(d).toContain("《如何赚到十亿美元》");
    expect(d).toContain("这是第一段足够长的正文");
    expect(d).not.toContain("本文基于一次演讲");
  });
});
