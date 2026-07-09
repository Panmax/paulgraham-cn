// One-off migration. 27 essays had their byline date ("May 2001") stranded in
// the SECOND body paragraph because a preamble (an image-only link, or an
// editor's note) tripped the old parser's first-paragraph-only date check, so
// they landed in "日期不详" with the date shown as prose. parse-article.ts is
// now fixed for future runs; this backfills the already-committed JSON offline
// (no re-scrape, no re-translation) to match exactly what the fixed pipeline
// would produce:
//   - set dateText + publishedAt from the leading date,
//   - strip the date prefix from that paragraph's English (the parser's own
//     `^.*?\d{4}\s*` rule) and from its Chinese (drop the leading `YYYY年M月`,
//     keeping any following separator, as the existing correctly-parsed essays
//     like `avg` do),
//   - if nothing survives the strip (a date-only paragraph), drop the segment.
// Idempotent: only touches articles with publishedAt === null whose leading
// paragraph starts with a real month/year.

import { join } from "node:path";
import { readAllArticles, writeArticle, writeManifest } from "../pipeline/store.js";
import { buildManifest } from "../pipeline/manifest.js";
import { parseLeadingDate } from "../pipeline/date.js";
import { hashText } from "../pipeline/hash.js";
import type { Article } from "../shared/article-schema.js";

const CONTENT_DIR = join(process.cwd(), "content");
const ARTICLES_DIR = join(CONTENT_DIR, "articles");

// Leading Chinese date, matching what the translation produces for a byline:
// "YYYY 年 M 月" (full date) or "YYYY 年" (bare year), with optional interior
// spaces and trailing ASCII whitespace. A following fullwidth comma is kept.
const LEADING_DATE_ZH = /^\s*\d{4}\s*年(?:\s*\d{1,2}\s*月)?[ \t]*/;

async function main(): Promise<void> {
  const articles = await readAllArticles(ARTICLES_DIR);
  const changed: string[] = [];

  for (const article of articles) {
    if (article.publishedAt !== null) continue;

    // The date lives in the first paragraph segment whose text opens with a
    // byline date ("Month YYYY" or a bare year like "1993").
    let idx = -1;
    let parsed: { dateText: string; publishedAt: string } | null = null;
    for (let i = 0; i < article.segments.length; i++) {
      const s = article.segments[i];
      if (s.type !== "paragraph") continue;
      const p = parseLeadingDate(s.enMarkdown ?? "");
      if (p) {
        idx = i;
        parsed = p;
        break;
      }
    }
    if (idx === -1 || !parsed) continue;

    const seg = article.segments[idx];
    const en = seg.enMarkdown ?? "";
    const { dateText, publishedAt } = parsed;

    article.dateText = dateText;
    article.publishedAt = publishedAt;

    const enRest = en.replace(/^.*?\d{4}\s*/, "").trim();
    if (!enRest) {
      // Date-only paragraph — the fixed parser never emits it.
      article.segments.splice(idx, 1);
    } else {
      const zhRest = (seg.zhMarkdown ?? "").replace(LEADING_DATE_ZH, "").trim();
      seg.enMarkdown = enRest;
      seg.sourceHash = hashText(enRest);
      if (seg.zhMarkdown !== undefined) seg.zhMarkdown = zhRest;
    }

    await writeArticle(ARTICLES_DIR, article);
    changed.push(`${article.slug} → ${dateText} (${publishedAt})`);
  }

  const rebuilt = await readAllArticles(ARTICLES_DIR);
  const prev = JSON.parse(
    await (await import("node:fs/promises")).readFile(join(CONTENT_DIR, "manifest.json"), "utf8"),
  ) as { generatedAt: string };
  await writeManifest(CONTENT_DIR, buildManifest(rebuilt, prev.generatedAt));

  console.log(`backfilled ${changed.length} article(s):`);
  for (const c of changed) console.log("  " + c);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
