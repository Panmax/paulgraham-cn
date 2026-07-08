export function sortArticles<T extends { publishedAt: string | null; sourceOrder: number }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
      return a.sourceOrder - b.sourceOrder;
    }
    if (a.publishedAt && !b.publishedAt) return -1;
    if (!a.publishedAt && b.publishedAt) return 1;
    return a.sourceOrder - b.sourceOrder;
  });
}
