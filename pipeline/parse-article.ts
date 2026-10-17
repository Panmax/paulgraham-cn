import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { hashText } from "./hash.js";
import { parseLeadingDate } from "./date.js";
import type { SegmentType } from "../shared/article-schema.js";

export type ParsedSegment = {
  type: SegmentType;
  enMarkdown?: string;
  sourceHash: string;
};

export type ParsedArticle = {
  titleEn: string;
  dateText: string;
  publishedAt: string | null;
  segments: ParsedSegment[];
};

function absolutize(href: string): string {
  if (/^[a-z][a-z0-9]*\.html$/i.test(href)) return `https://paulgraham.com/${href}`;
  return href;
}

// Tags that mark a segment boundary: the content up to this point flushes as
// a paragraph, then this element becomes its own segment.
const BLOCK_TAGS = new Set(["blockquote", "ul", "ol", "table", "pre", "hr"]);

// Inline formatting tags handled directly by inlineToMarkdown; not recursed
// into during flattening.
const INLINE_TAGS = new Set(["a", "i", "em", "b", "strong", "br"]);

// Tags with no useful textual content for the essay body (or whose text
// would be noise, e.g. embedded scripts) — skipped entirely during flattening.
const SKIP_TAGS = new Set(["script", "style", "img", "area", "map"]);

// Convert an inline HTML fragment into Markdown text. Handles text, <a>,
// <i>/<em>, <b>/<strong>, and <br> (a single <br>, not part of a <br><br>
// paragraph break, becomes a line break within the same paragraph).
function inlineToMarkdown($: cheerio.CheerioAPI, nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += (node.data ?? "").replace(/\s+/g, " ");
    } else if (node.type === "tag") {
      const el = $(node);
      if (node.name === "a") {
        const href = el.attr("href");
        // Footnote back-reference anchors (<a name="f3n">3</a>) have no
        // href — they're anchor *targets*, not links. Emitting them as
        // markdown links would produce a dangling "[3]()".
        out += href ? `[${el.text().trim()}](${absolutize(href)})` : el.text();
      } else if (node.name === "i" || node.name === "em") {
        out += `*${el.text().trim()}*`;
      } else if (node.name === "b" || node.name === "strong") {
        out += `**${el.text().trim()}**`;
      } else if (node.name === "br") {
        out += "\n";
      } else {
        out += el.text();
      }
    }
  }
  return out.trim();
}

// Convert an <ul>/<ol> element into Markdown list text.
function listToMarkdown($: cheerio.CheerioAPI, listEl: AnyNode): string {
  const ordered = (listEl as Element).name === "ol";
  const lines: string[] = [];
  $(listEl).children("li").each((i, li) => {
    const text = inlineToMarkdown($, li.children as AnyNode[]);
    lines.push(`${ordered ? `${i + 1}.` : "-"} ${text}`);
  });
  return lines.join("\n");
}

// Convert a <blockquote> element into Markdown quote text (lines prefixed "> ").
function blockquoteToMarkdown($: cheerio.CheerioAPI, bqEl: AnyNode): string {
  const md = inlineToMarkdown($, (bqEl as Element).children as AnyNode[]);
  return md
    .split("\n")
    .map((l) => `> ${l.trim()}`)
    .filter((l) => l !== ">")
    .join("\n");
}

// Convert a <table> into plain text preserving row/cell structure (cells
// joined by " | ", rows joined by newlines), instead of flattening every
// cell's text together with no separators — which is what previously
// garbled numeric tables like "weeklyyearly 1%1.7x 2%2.8x" into one run-on
// string. Falls back to the whole table's flattened text if it has no rows
// (e.g. a table used purely for layout with no <tr>).
function tableToText($: cheerio.CheerioAPI, tableEl: AnyNode): string {
  // A layout table can contain another table. Its outer cell text already
  // includes the nested table, so visiting the nested rows again duplicates
  // the whole block. Keep only rows owned by this table.
  const rows = $(tableEl).find("tr").filter((_, tr) =>
    $(tr).closest("table").get(0) === tableEl
  );
  if (rows.length === 0) return $(tableEl).text().trim();
  const lines: string[] = [];
  rows.each((_, tr) => {
    const cells: string[] = [];
    $(tr).children("td,th").each((__, cell) => {
      cells.push($(cell).text().replace(/\s+/g, " ").trim());
    });
    const line = cells.join(" | ").trim();
    if (line) lines.push(line);
  });
  return lines.join("\n").trim();
}

// Recursively flatten a node list into a single in-order sequence of "leaf"
// nodes: text nodes, inline formatting tags, and block-boundary tags are
// emitted as-is; everything else (font/p/center/div/span/td/tr/... — HTML
// this old, malformed markup uses purely for layout) is transparent and its
// children are spliced in in its place. This is what lets a <blockquote>,
// <ul>/<ol>, or <table> that's wrapped in prose within the same <br><br>
// block still be recognized as a segment boundary, and lets us survive the
// HTML parser splitting one logical <font size="2"> block into several
// sibling elements when it contains an inline <table>.
function flatten($: cheerio.CheerioAPI, nodes: AnyNode[], out: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(node);
      continue;
    }
    if (node.type !== "tag") continue;
    if (BLOCK_TAGS.has(node.name) || INLINE_TAGS.has(node.name)) {
      out.push(node);
      continue;
    }
    if (SKIP_TAGS.has(node.name)) continue;
    // <p> is a paragraph boundary: push it as a marker (the main walk flushes
    // on it) then flatten its inline children so they form the next paragraph.
    // Some essays use <p> instead of <br><br> to separate paragraphs; without
    // this the whole essay collapses into one giant paragraph.
    if (node.name === "p") out.push(node);
    flatten($, (node as Element).children as AnyNode[], out);
  }
}

// Remove the recurring "Want to start a startup? Get funded by Y Combinator."
// promo banner from the DOM before extracting text, so its text never leaks
// into body segments. We anchor on the banner's own headline phrase (which
// appears ONLY in the banner) and remove its closest <table>. Anchoring on the
// apply.html link instead would be wrong: essays sometimes link to apply.html
// from ordinary body prose (e.g. "don't be deterred from applying to Y
// Combinator"), and that link's closest <table> is the outer layout table
// wrapping the whole essay — removing it would delete the entire body.
function stripPromoTables($: cheerio.CheerioAPI): void {
  $('b:contains("Want to start a startup")').each((_, b) => {
    const table = $(b).closest("table");
    if (table.length) table.remove();
  });
}

// Locate the container holding the essay body. The title gif's alt text
// identifies the essay heading image; its closest ancestor <td> is the cell
// that holds the whole essay (image, then the font[size="2"] prose block,
// promo table, footnotes, etc). Falling back to the longest top-level
// font[size="2"] block, then the whole body, covers pages with no such image.
function findBodyContainer($: cheerio.CheerioAPI): cheerio.Cheerio<AnyNode> {
  const titleImg = $("img[alt]").filter((_, el) => ($(el).attr("alt") ?? "").length > 3).first();
  if (titleImg.length) {
    const td = titleImg.closest("td");
    if (td.length) return td;
  }

  const candidates = $('font[size="2"]').filter((_, el) => {
    let p = $(el).parent();
    while (p.length) {
      if (p.is('font[size="2"]')) return false;
      p = p.parent();
    }
    return true;
  });
  let best: AnyNode | null = null;
  let bestLen = -1;
  candidates.each((_, el) => {
    const len = $(el).text().length;
    if (len > bestLen) {
      bestLen = len;
      best = el;
    }
  });
  if (best) return $(best);

  return $("body");
}

export function parseArticle(html: string, fallbackTitle: string): ParsedArticle {
  const $ = cheerio.load(html);

  const titleEn =
    ($("img[alt]").filter((_, el) => ($(el).attr("alt") ?? "").length > 3).first().attr("alt")
      ?? $("title").text().trim()
      ?? fallbackTitle).trim() || fallbackTitle;

  // Strip promo banners before locating/walking the body so their text can
  // never leak into segments, and so they don't skew which font block looks
  // "biggest" if the body-container fallback path is used.
  stripPromoTables($);

  const container = findBodyContainer($);

  const segments: ParsedSegment[] = [];
  let dateText = "";
  let publishedAt: string | null = null;
  let dateFound = false;
  let paragraphsSeen = 0;
  let hrIdx = 0;
  let rawIdx = 0;

  const paragraphNodes: AnyNode[] = [];

  function flushParagraph(): void {
    if (paragraphNodes.length === 0) return;
    let md = inlineToMarkdown($, paragraphNodes);
    paragraphNodes.length = 0;
    if (!md) return;

    // The date can trail a preamble paragraph (an image-only link, or an
    // editor's note), so look past the first flushed paragraph — but only in
    // the header zone (first few paragraphs), so a body paragraph that happens
    // to open "December 2008 was ..." in an undated essay can't be mistaken for
    // a byline. The preambles observed are 1 paragraph; 3 leaves margin.
    const inHeaderZone = paragraphsSeen++ < 3;
    if (!dateFound && inHeaderZone) {
      const parsed = parseLeadingDate(md);
      if (parsed) {
        dateFound = true;
        publishedAt = parsed.publishedAt;
        dateText = parsed.dateText;
        // Strip the leading date token (a bare year, or "Month YYYY") plus any
        // trailing whitespace, keeping the rest of the paragraph.
        md = md.replace(/^.*?\d{4}\s*/, "").trim();
        if (!md) return;
      }
    }
    segments.push({ type: "paragraph", enMarkdown: md, sourceHash: hashText(md) });
  }

  function isBrPair(nodes: AnyNode[], i: number): boolean {
    const a = nodes[i];
    const b = nodes[i + 1];
    return (
      a?.type === "tag" && a.name === "br" &&
      b?.type === "tag" && b.name === "br"
    );
  }

  const flatNodes: AnyNode[] = [];
  flatten($, container.contents().toArray(), flatNodes);

  for (let i = 0; i < flatNodes.length; i++) {
    const node = flatNodes[i];

    if (node.type === "tag" && BLOCK_TAGS.has(node.name)) {
      flushParagraph();
      if (node.name === "blockquote") {
        const md = blockquoteToMarkdown($, node);
        if (md.trim()) segments.push({ type: "quote", enMarkdown: md, sourceHash: hashText(md) });
      } else if (node.name === "ul" || node.name === "ol") {
        const md = listToMarkdown($, node);
        if (md.trim()) segments.push({ type: "list", enMarkdown: md, sourceHash: hashText(md) });
      } else if (node.name === "table" || node.name === "pre") {
        const raw = node.name === "table" ? tableToText($, node) : $(node).text().trim();
        if (raw) {
          segments.push({ type: "rawUnsupported", enMarkdown: raw, sourceHash: hashText("raw:" + rawIdx++ + raw) });
        }
      } else if (node.name === "hr") {
        segments.push({ type: "hr", sourceHash: hashText("hr:" + hrIdx++) });
      }
      continue;
    }

    if (isBrPair(flatNodes, i)) {
      flushParagraph();
      i++; // consume the second <br> of the pair as well
      continue;
    }

    // A <p> marker starts a new paragraph (its inline children were flattened
    // in right after it, so just flush what precedes it and drop the marker).
    if (node.type === "tag" && node.name === "p") {
      flushParagraph();
      continue;
    }

    paragraphNodes.push(node);
  }
  flushParagraph();

  return { titleEn, dateText, publishedAt, segments };
}
