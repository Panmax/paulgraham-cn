import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pLimit from "p-limit";
import { fetchHtml } from "./fetch.js";
import { parseArticleList } from "./parse-list.js";
import { parseArticle } from "./parse-article.js";
import { assembleArticle, type AssembleStats } from "./assemble.js";
import { createOpenRouterTranslator, MODEL } from "./translate.js";
import { readArticle, readAllArticles, writeArticle, writeManifest, readManifest, articleContentEqual } from "./store.js";
import { buildManifest, manifestArticlesEqual } from "./manifest.js";
import type { Article } from "../shared/article-schema.js";

const CONTENT_DIR = join(process.cwd(), "content");
const ARTICLES_DIR = join(CONTENT_DIR, "articles");

export function parseArgs(argv: string[]) {
  const onlyArg = argv.find((a) => a === "--only" || a.startsWith("--only="));
  const limitArg = argv.find((a) => a === "--limit" || a.startsWith("--limit="));
  let only: Set<string> | null = null;
  if (onlyArg !== undefined) {
    const value = onlyArg.startsWith("--only=") ? onlyArg.slice("--only=".length) : "";
    const slugs = value.split(",");
    if (slugs.some((slug) => !/^[a-z][a-z0-9]*$/.test(slug))) {
      throw new Error("--only requires a comma-separated list of article slugs");
    }
    only = new Set(slugs);
  }

  let limit: number | null = null;
  if (limitArg !== undefined) {
    const value = limitArg.startsWith("--limit=") ? limitArg.slice("--limit=".length) : "";
    limit = Number(value);
    if (value === "" || !Number.isSafeInteger(limit) || limit < 0) {
      throw new Error("--limit requires a non-negative integer");
    }
  }
  return {
    only,
    limit,
  };
}

export function exitCodeFor(failed: number): 0 | 1 {
  return failed > 0 ? 1 : 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { only, limit } = parseArgs(argv);
  const translator = createOpenRouterTranslator();
  const translatedAt = new Date().toISOString().slice(0, 10);

  const listHtml = await fetchHtml("https://paulgraham.com/articles.html");
  let entries = parseArticleList(listHtml);
  if (only) entries = entries.filter((e) => only.has(e.slug));
  if (limit !== null) entries = entries.slice(0, limit);

  const limiter = pLimit(4);
  const results: Article[] = [];
  const rawFindings: Array<{ slug: string; ids: number[] }> = [];
  const addedSlugs: string[] = [];
  const updatedSlugs: string[] = [];
  const totals = { new: 0, changed: 0, unchanged: 0, deleted: 0, failed: 0, skipped: 0 };

  await Promise.all(entries.map((entry) => limiter(async () => {
    try {
      const html = await fetchHtml(entry.sourceUrl);
      const parsed = parseArticle(html, entry.titleEn);
      const existing = await readArticle(ARTICLES_DIR, entry.slug);
      const { article, stats } = await assembleArticle({
        listEntry: entry, parsed, existing, translator, translatedAt, model: MODEL,
      });

      // Write only on a real content change. `article.translatedAt` is today's
      // date on every run, so writing unconditionally would rewrite all ~227
      // files on any day after the last run and make each look source-revised.
      // Skipping the write also preserves the original translatedAt on disk.
      if (!existing) {
        await writeArticle(ARTICLES_DIR, article);
        addedSlugs.push(entry.slug);
      } else if (!articleContentEqual(article, existing)) {
        await writeArticle(ARTICLES_DIR, article);
        updatedSlugs.push(entry.slug);
      } else {
        totals.skipped++;
      }

      results.push(article);
      totals.new += stats.new; totals.changed += stats.changed; totals.unchanged += stats.unchanged;
      totals.deleted += stats.deleted;
      if (stats.rawUnsupported.length) rawFindings.push({ slug: entry.slug, ids: stats.rawUnsupported });
    } catch (err) {
      totals.failed++;
      console.error(`✗ ${entry.slug}: ${String(err)}`);
    }
  })));

  // Rebuild manifest from ALL articles on disk — not just this run's results.
  // A --only/--limit run, or a run with failures, must never drop other
  // articles from the manifest (which drives the homepage/index).
  //
  // Reading from disk also matters now that unchanged articles are not
  // rewritten: their in-memory `translatedAt` is today, but the file still
  // holds the original date, and the manifest must reflect the file.
  const allArticles = await readAllArticles(ARTICLES_DIR);
  const manifest = buildManifest(allArticles, new Date().toISOString());
  const existingManifest = await readManifest(CONTENT_DIR);
  if (!existingManifest || !manifestArticlesEqual(manifest, existingManifest)) {
    await writeManifest(CONTENT_DIR, manifest);
  }

  console.log("\n=== translate summary ===");
  console.log(`articles processed: ${results.length}  failed: ${totals.failed}`);
  console.log(`articles  added:${addedSlugs.length} updated:${updatedSlugs.length} unchanged:${totals.skipped}`);
  console.log(`segments  new:${totals.new} changed:${totals.changed} unchanged:${totals.unchanged} deleted:${totals.deleted}`);
  if (addedSlugs.length) console.log(`\n+ added: ${addedSlugs.sort().join(", ")}`);
  if (updatedSlugs.length) console.log(`~ updated: ${updatedSlugs.sort().join(", ")}`);
  if (rawFindings.length) {
    console.log("\n⚠ rawUnsupported segments (verify these are not real body text):");
    for (const f of rawFindings) console.log(`  ${f.slug}: ids ${f.ids.join(", ")}`);
    console.log("Review the above before publishing.");
  }

  // Per-article failures are caught above and only counted, so without this the
  // process exits 0 and a partially failed run looks successful.
  // `exitCode` rather than `exit()`: the latter can truncate the buffered
  // summary written just above.
  process.exitCode = exitCodeFor(totals.failed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
