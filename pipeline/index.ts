import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pLimit from "p-limit";
import { fetchHtml } from "./fetch.js";
import { parseArticleList } from "./parse-list.js";
import { parseArticle } from "./parse-article.js";
import { assembleArticle, type AssembleStats } from "./assemble.js";
import { createVertexTranslator } from "./translate.js";
import { readArticle, readAllArticles, writeArticle, writeManifest } from "./store.js";
import { buildManifest } from "./manifest.js";
import type { Article } from "../shared/article-schema.js";

const CONTENT_DIR = join(process.cwd(), "content");
const ARTICLES_DIR = join(CONTENT_DIR, "articles");
const MODEL = "gemini-3.5-flash";

function parseArgs(argv: string[]) {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const limitArg = argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length);
  return {
    only: only ? new Set(only.split(",")) : null,
    limit: limitArg ? Number(limitArg) : null,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { only, limit } = parseArgs(argv);
  const translator = createVertexTranslator();
  const translatedAt = new Date().toISOString().slice(0, 10);

  const listHtml = await fetchHtml("https://paulgraham.com/articles.html");
  let entries = parseArticleList(listHtml);
  if (only) entries = entries.filter((e) => only.has(e.slug));
  if (limit) entries = entries.slice(0, limit);

  const limiter = pLimit(4);
  const results: Article[] = [];
  const rawFindings: Array<{ slug: string; ids: number[] }> = [];
  const totals = { new: 0, changed: 0, unchanged: 0, deleted: 0, failed: 0, skipped: 0 };

  await Promise.all(entries.map((entry) => limiter(async () => {
    try {
      const html = await fetchHtml(entry.sourceUrl);
      const parsed = parseArticle(html, entry.titleEn);
      const existing = await readArticle(ARTICLES_DIR, entry.slug);
      const { article, stats } = await assembleArticle({
        listEntry: entry, parsed, existing, translator, translatedAt, model: MODEL,
      });
      await writeArticle(ARTICLES_DIR, article);
      results.push(article);
      totals.new += stats.new; totals.changed += stats.changed; totals.unchanged += stats.unchanged;
      totals.deleted += stats.deleted;
      if (stats.new === 0 && stats.changed === 0) totals.skipped++;
      if (stats.rawUnsupported.length) rawFindings.push({ slug: entry.slug, ids: stats.rawUnsupported });
    } catch (err) {
      totals.failed++;
      console.error(`✗ ${entry.slug}: ${String(err)}`);
    }
  })));

  // Rebuild manifest from ALL articles on disk — not just this run's results.
  // A --only/--limit run, or a run with failures, must never drop other
  // articles from the manifest (which drives the homepage/index).
  const allArticles = await readAllArticles(ARTICLES_DIR);
  const manifest = buildManifest(allArticles, new Date().toISOString());
  await writeManifest(CONTENT_DIR, manifest);

  console.log("\n=== translate summary ===");
  console.log(`articles processed: ${results.length}  failed: ${totals.failed}`);
  console.log(`segments  new:${totals.new} changed:${totals.changed} unchanged:${totals.unchanged} deleted:${totals.deleted}`);
  if (rawFindings.length) {
    console.log("\n⚠ rawUnsupported segments (verify these are not real body text):");
    for (const f of rawFindings) console.log(`  ${f.slug}: ids ${f.ids.join(", ")}`);
    console.log("Review the above before publishing.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
