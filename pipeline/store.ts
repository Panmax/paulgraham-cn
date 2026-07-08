import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArticleSchema, ManifestSchema, type Article, type Manifest } from "../shared/article-schema.js";

function pretty(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
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
  ArticleSchema.parse(article);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${article.slug}.json`), pretty(article), "utf8");
}

export async function writeManifest(contentDir: string, manifest: Manifest): Promise<void> {
  ManifestSchema.parse(manifest);
  await mkdir(contentDir, { recursive: true });
  await writeFile(join(contentDir, "manifest.json"), pretty(manifest), "utf8");
}
