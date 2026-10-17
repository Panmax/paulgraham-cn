import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArticleSchema, ManifestSchema, type Article, type Manifest, type Segment } from "../shared/article-schema.js";

function pretty(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

function segmentsEqual(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i];
    return s.id === t.id && s.type === t.type && s.sourceHash === t.sourceHash
      && s.enMarkdown === t.enMarkdown && s.zhMarkdown === t.zhMarkdown;
  });
}

/**
 * Compares everything that describes the article except `translatedAt`, which
 * is a run timestamp rather than content. Without this exclusion every full run
 * rewrites every article on a new calendar day, and each one then reads as a
 * source-side revision.
 *
 * Fields are compared explicitly: `existing` comes back from Zod and `article`
 * is an object literal, so their key order need not agree and serializing both
 * would give false negatives.
 */
export function articleContentEqual(a: Article, b: Article): boolean {
  return a.slug === b.slug
    && a.titleEn === b.titleEn
    && a.titleZh === b.titleZh
    && a.dateText === b.dateText
    && a.publishedAt === b.publishedAt
    && a.sourceOrder === b.sourceOrder
    && a.sourceUrl === b.sourceUrl
    && a.model === b.model
    && segmentsEqual(a.segments, b.segments);
}

export async function readArticle(dir: string, slug: string): Promise<Article | null> {
  try {
    const raw = await readFile(join(dir, `${slug}.json`), "utf8");
    return ArticleSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readAllArticles(dir: string): Promise<Article[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const slugs = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  const articles: Article[] = [];
  for (const slug of slugs) {
    const article = await readArticle(dir, slug);
    if (article) articles.push(article);
  }
  return articles;
}

export async function writeArticle(dir: string, article: Article): Promise<void> {
  // Write the parsed object, not the caller's: Zod strips unknown keys, so a
  // field added upstream can never leak into the committed JSON.
  const parsed = ArticleSchema.parse(article);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${parsed.slug}.json`), pretty(parsed), "utf8");
}

export async function readManifest(contentDir: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(join(contentDir, "manifest.json"), "utf8");
    return ManifestSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeManifest(contentDir: string, manifest: Manifest): Promise<void> {
  const parsed = ManifestSchema.parse(manifest);
  await mkdir(contentDir, { recursive: true });
  await writeFile(join(contentDir, "manifest.json"), pretty(parsed), "utf8");
}
