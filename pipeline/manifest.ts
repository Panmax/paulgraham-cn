import type { Article, Manifest } from "../shared/article-schema.js";

/**
 * Compares the article index only, ignoring `generatedAt` — which is `now()` on
 * every run and would otherwise dirty manifest.json even when nothing changed.
 */
export function manifestArticlesEqual(a: Manifest, b: Manifest): boolean {
  if (a.articles.length !== b.articles.length) return false;
  return a.articles.every((x, i) => {
    const y = b.articles[i];
    return x.slug === y.slug && x.titleZh === y.titleZh && x.dateText === y.dateText
      && x.publishedAt === y.publishedAt && x.sourceOrder === y.sourceOrder
      && x.translatedAt === y.translatedAt;
  });
}

export function buildManifest(articles: Article[], generatedAt: string): Manifest {
  return {
    generatedAt,
    articles: articles.map((a) => ({
      slug: a.slug,
      titleZh: a.titleZh,
      dateText: a.dateText,
      publishedAt: a.publishedAt,
      sourceOrder: a.sourceOrder,
      translatedAt: a.translatedAt,
    })),
  };
}
