import type { Article, Manifest } from "../shared/article-schema.js";

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
