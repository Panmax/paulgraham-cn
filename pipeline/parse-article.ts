import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { hashText } from "./hash.js";
import { parsePublishedAt } from "./date.js";
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

// Convert an inline HTML fragment (children of the body font block, within one
// paragraph) into Markdown text.
function inlineToMarkdown($: cheerio.CheerioAPI, nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += (node.data ?? "").replace(/\s+/g, " ");
    } else if (node.type === "tag") {
      const el = $(node);
      if (node.name === "a") {
        out += `[${el.text().trim()}](${absolutize(el.attr("href") ?? "")})`;
      } else if (node.name === "i" || node.name === "em") {
        out += `*${el.text().trim()}*`;
      } else if (node.name === "b" || node.name === "strong") {
        out += `**${el.text().trim()}**`;
      } else {
        out += el.text();
      }
    }
  }
  return out.trim();
}

export function parseArticle(html: string, fallbackTitle: string): ParsedArticle {
  const $ = cheerio.load(html);

  const titleEn =
    ($("img[alt]").filter((_, el) => ($(el).attr("alt") ?? "").length > 3).first().attr("alt")
      ?? $("title").text().trim()
      ?? fallbackTitle).trim() || fallbackTitle;

  const font = $('font[size="2"]').first();
  const container = font.length ? font : $("body");

  // Serialize inner HTML and split on <br><br> boundaries.
  const inner = container.html() ?? "";
  const blocks = inner
    .split(/<br\s*\/?>\s*<br\s*\/?>/i)
    .map((b) => b.trim())
    .filter(Boolean);

  const segments: ParsedSegment[] = [];
  let dateText = "";
  let publishedAt: string | null = null;

  // Convert an <ul>/<ol> element into Markdown list text.
  function listToMarkdown(frag: cheerio.CheerioAPI, listEl: AnyNode): string {
    const ordered = (listEl as { name?: string }).name === "ol";
    const lines: string[] = [];
    frag(listEl).children("li").each((i, li) => {
      const text = inlineToMarkdown(frag, li.children as AnyNode[]);
      lines.push(`${ordered ? `${i + 1}.` : "-"} ${text}`);
    });
    return lines.join("\n");
  }

  blocks.forEach((block, idx) => {
    if (/^<hr\s*\/?>$/i.test(block)) {
      segments.push({ type: "hr", sourceHash: hashText("hr:" + idx) });
      return;
    }

    const frag = cheerio.load(`<div>${block}</div>`);
    const root = frag("div")[0];
    const nodes = root.children as AnyNode[];

    // A block whose sole meaningful element is a structural tag gets that type.
    const tagChildren = nodes.filter((n): n is Element => n.type === "tag");
    const soleTag = tagChildren.length === 1 && !nodes.some(
      (n) => n.type === "text" && (n.data ?? "").trim(),
    ) ? tagChildren[0] : null;

    if (soleTag && soleTag.name === "blockquote") {
      const md = inlineToMarkdown(frag, soleTag.children as AnyNode[])
        .split("\n").map((l) => `> ${l.trim()}`).join("\n");
      if (md.trim()) segments.push({ type: "quote", enMarkdown: md, sourceHash: hashText(md) });
      return;
    }
    if (soleTag && (soleTag.name === "ul" || soleTag.name === "ol")) {
      const md = listToMarkdown(frag, soleTag);
      if (md.trim()) segments.push({ type: "list", enMarkdown: md, sourceHash: hashText(md) });
      return;
    }
    // Blocks built from tags we cannot faithfully convert (e.g. tables) are
    // preserved verbatim as rawUnsupported so they surface in the run summary
    // instead of being silently flattened into prose.
    if (soleTag && (soleTag.name === "table" || soleTag.name === "pre")) {
      const raw = frag(soleTag).text().trim();
      segments.push({ type: "rawUnsupported", enMarkdown: raw, sourceHash: hashText("raw:" + idx + raw) });
      return;
    }

    const md = inlineToMarkdown(frag, nodes);
    if (!md) return;

    if (idx === 0) {
      // First block leads with the date line.
      const parsed = parsePublishedAt(md);
      if (parsed) {
        publishedAt = parsed;
        const dm = md.match(/\b[A-Z][a-z]+\s+\d{4}\b/);
        dateText = dm ? dm[0] : "";
        const rest = md.replace(/^.*?\d{4}\s*/, "").trim();
        if (rest) segments.push({ type: "paragraph", enMarkdown: rest, sourceHash: hashText(rest) });
        return;
      }
    }
    segments.push({ type: "paragraph", enMarkdown: md, sourceHash: hashText(md) });
  });

  return { titleEn, dateText, publishedAt, segments };
}
