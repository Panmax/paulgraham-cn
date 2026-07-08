import { describe, it, expect } from "vitest";
import { parseArticleList } from "./parse-list.js";

const SAMPLE = `
<html><body>
<a href="index.html">home</a>
<a href="earn.html">How to Earn a Billion Dollars</a>
<a href="greatwork.html">How to Do Great Work</a>
<a href="https://twitter.com/paulg">twitter</a>
<a href="earn.html">dup should be ignored</a>
<a href="rss.html">RSS</a>
</body></html>`;

describe("parseArticleList", () => {
  it("extracts essay entries in order with sourceOrder", () => {
    const out = parseArticleList(SAMPLE);
    const slugs = out.map((e) => e.slug);
    expect(slugs).toContain("earn");
    expect(slugs).toContain("greatwork");
    expect(out.find((e) => e.slug === "earn")).toMatchObject({
      slug: "earn",
      titleEn: "How to Earn a Billion Dollars",
      sourceUrl: "https://paulgraham.com/earn.html",
      sourceOrder: 0,
    });
  });

  it("excludes navigation and external links", () => {
    const slugs = parseArticleList(SAMPLE).map((e) => e.slug);
    expect(slugs).not.toContain("index");
    expect(slugs).not.toContain("rss");
  });

  it("dedupes repeated slugs keeping the first", () => {
    const earn = parseArticleList(SAMPLE).filter((e) => e.slug === "earn");
    expect(earn).toHaveLength(1);
    expect(earn[0].titleEn).toBe("How to Earn a Billion Dollars");
  });
});
