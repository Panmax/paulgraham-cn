import * as cheerio from "cheerio";

export type ArticleListEntry = {
  slug: string;
  titleEn: string;
  sourceUrl: string;
  sourceOrder: number;
};

// Navigation / non-essay pages that live at bare *.html but are not essays.
const EXCLUDED_SLUGS = new Set([
  "index", "articles", "books", "arc", "bel", "lisp", "antispam",
  "kedrosky", "faq", "raq", "quo", "rss", "bio",
]);

export function parseArticleList(html: string): ArticleListEntry[] {
  const $ = cheerio.load(html);
  const entries: ArticleListEntry[] = [];
  const seen = new Set<string>();
  let order = 0;

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const m = href.match(/^([a-z][a-z0-9]*)\.html$/i);
    if (!m) return; // skip external, absolute, and non-.html links
    const slug = m[1].toLowerCase();
    if (EXCLUDED_SLUGS.has(slug) || seen.has(slug)) return;
    const titleEn = $(el).text().trim();
    if (!titleEn) return;
    seen.add(slug);
    entries.push({
      slug,
      titleEn,
      sourceUrl: `https://paulgraham.com/${slug}.html`,
      sourceOrder: order++,
    });
  });

  return entries;
}
