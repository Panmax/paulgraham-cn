import { describe, it, expect } from "vitest";
import {
  createMarkdownRenderer,
  preferTranslatedArticleUrl,
  renderMarkdown,
} from "./markdown.js";

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

  it("prefers a local link when the referenced article is translated", async () => {
    const render = createMarkdownRenderer(new Set(["richnow"]));
    const html = await render("[common](https://paulgraham.com/richnow.html)");
    expect(html).toContain('href="/richnow.html"');
  });

  it("keeps the source link when the referenced article is not translated", async () => {
    const render = createMarkdownRenderer(new Set(["earn"]));
    const html = await render("[common](https://paulgraham.com/richnow.html)");
    expect(html).toContain('href="https://paulgraham.com/richnow.html"');
  });
});

describe("preferTranslatedArticleUrl", () => {
  const translatedSlugs = new Set(["richnow"]);

  it("supports Paul Graham's www host and preserves URL details", () => {
    expect(preferTranslatedArticleUrl(
      "http://www.paulgraham.com/richnow.html?from=earn#notes",
      translatedSlugs,
    )).toBe("/richnow.html?from=earn#notes");
  });

  it("does not rewrite other hosts or non-article paths", () => {
    expect(preferTranslatedArticleUrl(
      "https://example.com/richnow.html",
      translatedSlugs,
    )).toBe("https://example.com/richnow.html");
    expect(preferTranslatedArticleUrl(
      "https://paulgraham.com/images/richnow.html",
      translatedSlugs,
    )).toBe("https://paulgraham.com/images/richnow.html");
  });
});
