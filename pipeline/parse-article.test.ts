import { describe, it, expect } from "vitest";
import { parseArticle } from "./parse-article.js";

const SAMPLE = `<html><head><title>How to Do Great Work</title></head>
<body><table><tr><td>
<img src="x/how-to-do-great-work-2.gif" alt="How to Do Great Work" />
<font size="2" face="verdana">July 2023<br /><br />First paragraph with a <a href="foo.html">link</a> inside.<br /><br />Second paragraph is <i>emphasized</i> here.<br /><br /><hr /><br /><br />After the rule.</font>
</td></tr></table></body></html>`;

describe("parseArticle", () => {
  it("extracts title from alt/title", () => {
    expect(parseArticle(SAMPLE, "fallback").titleEn).toBe("How to Do Great Work");
  });

  it("extracts dateText and publishedAt", () => {
    const a = parseArticle(SAMPLE, "fallback");
    expect(a.dateText).toBe("July 2023");
    expect(a.publishedAt).toBe("2023-07-01");
  });

  it("splits paragraphs and converts inline links to markdown", () => {
    const a = parseArticle(SAMPLE, "fallback");
    const paras = a.segments.filter((s) => s.type === "paragraph");
    expect(paras[0].enMarkdown).toBe(
      "First paragraph with a [link](https://paulgraham.com/foo.html) inside."
    );
    expect(paras.some((p) => p.enMarkdown?.includes("*emphasized*"))).toBe(true);
  });

  it("emits an hr segment", () => {
    const a = parseArticle(SAMPLE, "fallback");
    expect(a.segments.some((s) => s.type === "hr")).toBe(true);
  });

  it("gives every segment a non-empty sourceHash", () => {
    const a = parseArticle(SAMPLE, "fallback");
    expect(a.segments.every((s) => /^[0-9a-f]{64}$/.test(s.sourceHash))).toBe(true);
  });

  it("does not include the date line as a body paragraph", () => {
    const a = parseArticle(SAMPLE, "fallback");
    const paras = a.segments.filter((s) => s.type === "paragraph");
    expect(paras[0].enMarkdown?.startsWith("July 2023")).toBe(false);
  });
});

const STRUCTURED = `<html><head><title>T</title></head><body>
<font size="2" face="verdana">May 2020<br /><br />Intro paragraph.<br /><br /><blockquote>The best lack all conviction.</blockquote><br /><br /><ul><li>first item</li><li>second item</li></ul><br /><br /><table><tr><td>col a</td><td>col b</td></tr></table><br /><br />Closing paragraph.</font>
</body></html>`;

describe("parseArticle block types", () => {
  it("maps blockquote to a quote segment", () => {
    const q = parseArticle(STRUCTURED, "T").segments.find((s) => s.type === "quote");
    expect(q?.enMarkdown).toBe("> The best lack all conviction.");
  });

  it("maps ul to a list segment with markdown bullets", () => {
    const l = parseArticle(STRUCTURED, "T").segments.find((s) => s.type === "list");
    expect(l?.enMarkdown).toBe("- first item\n- second item");
  });

  it("maps an unconvertible table to rawUnsupported preserving its text", () => {
    const r = parseArticle(STRUCTURED, "T").segments.find((s) => s.type === "rawUnsupported");
    expect(r).toBeDefined();
    expect(r?.enMarkdown).toContain("col a");
  });

  it("still classifies ordinary blocks as paragraphs", () => {
    const paras = parseArticle(STRUCTURED, "T").segments.filter((s) => s.type === "paragraph");
    expect(paras.some((p) => p.enMarkdown === "Intro paragraph.")).toBe(true);
    expect(paras.some((p) => p.enMarkdown === "Closing paragraph.")).toBe(true);
  });
});
