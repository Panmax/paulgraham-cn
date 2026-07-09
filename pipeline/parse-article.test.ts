import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArticle } from "./parse-article.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("parseArticle — apple.html (promo banner prepended to body)", () => {
  const html = loadFixture("apple.html");
  const article = parseArticle(html, "Apple's Mistake");

  it("never lets the promo banner text into any segment", () => {
    for (const s of article.segments) {
      expect(s.enMarkdown ?? "").not.toContain("Want to start a startup");
      expect(s.enMarkdown ?? "").not.toContain("Y Combinator");
    }
  });

  it("does not leave the date line at the start of any body paragraph", () => {
    for (const s of article.segments) {
      expect(s.enMarkdown?.startsWith("November 2009")).toBe(false);
    }
  });

  it("extracts dateText and publishedAt from the real body, not the promo", () => {
    expect(article.dateText).toBe("November 2009");
    expect(article.publishedAt).toBe("2009-11-01");
  });

  it("contains real essay prose", () => {
    const joined = article.segments.map((s) => s.enMarkdown ?? "").join(" ");
    expect(joined).toContain("App Store");
    expect(joined.length).toBeGreaterThan(500);
  });

  it("gives every segment a 64-hex sourceHash", () => {
    expect(article.segments.every((s) => /^[0-9a-f]{64}$/.test(s.sourceHash))).toBe(true);
  });
});

describe("parseArticle — greatwork.html (inline blockquote wrapped in prose)", () => {
  const html = loadFixture("greatwork.html");
  const article = parseArticle(html, "fallback");

  it("extracts the title from the title-gif alt text", () => {
    expect(article.titleEn).toBe("How to Do Great Work");
  });

  it("extracts dateText and publishedAt", () => {
    expect(article.dateText).toBe("July 2023");
    expect(article.publishedAt).toBe("2023-07-01");
  });

  it("emits a quote segment for the inline blockquote, with prose before and after it", () => {
    const idx = article.segments.findIndex((s) => s.type === "quote");
    expect(idx).toBeGreaterThan(0);
    expect(article.segments[idx]?.enMarkdown).toBe(
      "> The best lack all conviction, while the worst\n> Are full of passionate intensity."
    );
    expect(article.segments[idx - 1]?.type).toBe("paragraph");
    expect(article.segments[idx + 1]?.type).toBe("paragraph");
  });
});

describe("parseArticle — goodtaste.html (real table used for a figure)", () => {
  const html = loadFixture("goodtaste.html");
  const article = parseArticle(html, "fallback");

  it("extracts the title", () => {
    expect(article.titleEn).toBe("Is There Such a Thing as Good Taste?");
  });

  it("parses the date", () => {
    expect(article.dateText).toBe("November 2021");
    expect(article.publishedAt).toBe("2021-11-01");
  });

  it("has real essay prose and no dangling markdown links from anchor targets", () => {
    const joined = article.segments.map((s) => s.enMarkdown ?? "").join(" ");
    expect(joined).toContain("good taste");
    expect(joined).not.toMatch(/\]\(\)/);
  });
});

describe("parseArticle — growth.html (promo banner + inline table + inline ordered list)", () => {
  const html = loadFixture("growth.html");
  const article = parseArticle(html, "fallback");

  it("strips the promo banner and extracts the real date", () => {
    for (const s of article.segments) {
      expect(s.enMarkdown ?? "").not.toContain("Want to start a startup");
    }
    expect(article.dateText).toBe("September 2012");
    expect(article.publishedAt).toBe("2012-09-01");
  });

  it("emits a rawUnsupported segment for the stats table instead of flattening it into a run-on paragraph", () => {
    const raw = article.segments.find((s) => s.type === "rawUnsupported");
    expect(raw).toBeDefined();
    expect(raw?.enMarkdown).toContain("1%");
    expect(raw?.enMarkdown).toContain("1.7x");
    // The old string-split implementation garbled this into "weeklyyearly
    // 1%1.7x 2%2.8x" with no separators — assert that never happens again.
    expect(raw?.enMarkdown).not.toContain("weeklyyearly");
    expect(raw?.enMarkdown).not.toContain("1%1.7x");
  });

  it("emits a list segment for the inline ordered list wrapped in prose", () => {
    const list = article.segments.find((s) => s.type === "list");
    expect(list).toBeDefined();
    expect(list?.enMarkdown).toMatch(/^1\./);
    expect(list?.enMarkdown).toContain("2.");
    expect(list?.enMarkdown).toContain("3.");
  });
});

describe("parseArticle — date not in the first paragraph", () => {
  // Regression: the date line follows a preamble (an image-only link, or an
  // editor's note). The old code only checked the FIRST flushed paragraph, so
  // the date leaked into the body and the article landed in "日期不详".
  const withImagePreamble = `<html><head><title>T</title></head>
<body><table><tr><td>
<img src="x/roots-2.gif" alt="The Roots of Lisp" />
<font size="2" face="verdana"><a href="pic.gif"></a><br /><br />May 2001  *(I wrote this to help myself.)*<br /><br />In 1960, McCarthy published a paper.</font>
</td></tr></table></body></html>`;

  it("extracts the date from the second paragraph when the first is an image-only link", () => {
    const a = parseArticle(withImagePreamble, "fallback");
    expect(a.dateText).toBe("May 2001");
    expect(a.publishedAt).toBe("2001-05-01");
  });

  it("strips the date prefix but keeps the rest of that paragraph", () => {
    const a = parseArticle(withImagePreamble, "fallback");
    const paras = a.segments.filter((s) => s.type === "paragraph");
    expect(paras.some((p) => p.enMarkdown?.startsWith("May 2001"))).toBe(false);
    expect(paras.some((p) => p.enMarkdown === "*(I wrote this to help myself.)*")).toBe(true);
  });

  const dateOnlyParagraph = `<html><head><title>T</title></head>
<body><table><tr><td>
<img src="x/t-2.gif" alt="Taste" />
<font size="2" face="verdana"><a href="pic.gif"></a><br /><br />February 2002<br /><br />Real prose begins here.</font>
</td></tr></table></body></html>`;

  it("drops a date-only paragraph entirely, leaving no blank segment", () => {
    const a = parseArticle(dateOnlyParagraph, "fallback");
    expect(a.dateText).toBe("February 2002");
    const paras = a.segments.filter((s) => s.type === "paragraph");
    expect(paras.every((p) => (p.enMarkdown ?? "").trim().length > 0)).toBe(true);
    expect(paras.some((p) => p.enMarkdown === "Real prose begins here.")).toBe(true);
  });

  const undated = `<html><head><title>T</title></head>
<body><table><tr><td>
<img src="x/fix-2.gif" alt="Fix" />
<font size="2" face="verdana">Kevin suggested an interesting idea.<br /><br />I visited in September 2004 once.</font>
</td></tr></table></body></html>`;

  it("does not grab a mid-sentence month/year that isn't the leading date", () => {
    const a = parseArticle(undated, "fallback");
    expect(a.dateText).toBe("");
    expect(a.publishedAt).toBeNull();
    const joined = a.segments.map((s) => s.enMarkdown ?? "").join(" ");
    expect(joined).toContain("September 2004");
  });
});

describe("parseArticle — hw.html (inline apply.html link must not delete the body)", () => {
  const html = loadFixture("hw.html");
  const article = parseArticle(html, "The Hardware Renaissance");

  it("keeps the essay body even though a body sentence links to apply.html", () => {
    const joined = article.segments.map((s) => s.enMarkdown ?? "").join(" ");
    expect(joined).toContain("One advantage of Y Combinator");
    expect(joined).toContain("hardware startups");
    expect(joined.length).toBeGreaterThan(2000);
  });

  it("extracts the date and strips the top promo banner", () => {
    expect(article.dateText).toBe("October 2012");
    expect(article.publishedAt).toBe("2012-10-01");
    for (const s of article.segments) {
      expect(s.enMarkdown ?? "").not.toContain("Want to start a startup");
    }
  });

  it("splits into many paragraphs, not one giant blob", () => {
    const paras = article.segments.filter((s) => s.type === "paragraph");
    expect(paras.length).toBeGreaterThan(5);
  });
});

describe("parseArticle — ycstart.html (paragraphs separated by <p>, not <br><br>)", () => {
  const html = loadFixture("ycstart.html");
  const article = parseArticle(html, "How Y Combinator Started");

  it("splits <p>-separated prose into multiple paragraphs", () => {
    const paras = article.segments.filter((s) => s.type === "paragraph");
    expect(paras.length).toBeGreaterThan(5);
    expect(paras.every((p) => (p.enMarkdown ?? "").length < 4000)).toBe(true);
  });

  it("extracts the date and keeps the whole essay", () => {
    expect(article.dateText).toBe("March 2012");
    expect(article.publishedAt).toBe("2012-03-01");
    const joined = article.segments.map((s) => s.enMarkdown ?? "").join(" ");
    expect(joined).toContain("7th birthday");
    expect(joined).toContain("Jessica");
  });
});

describe("parseArticle — synthetic structural checks", () => {
  const SAMPLE = `<html><head><title>How to Do Great Work</title></head>
<body><table><tr><td>
<img src="x/how-to-do-great-work-2.gif" alt="How to Do Great Work" />
<font size="2" face="verdana">July 2023<br /><br />First paragraph with a <a href="foo.html">link</a> inside.<br /><br />Second paragraph is <i>emphasized</i> here.<br /><br /><hr /><br /><br />After the rule.</font>
</td></tr></table></body></html>`;

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
});
