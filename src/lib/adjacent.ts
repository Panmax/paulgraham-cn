type Ref = { slug: string; titleZh: string };
export function withNeighbors<T extends Ref>(sorted: T[]): Array<{ article: T; prev: Ref | null; next: Ref | null }> {
  return sorted.map((article, i) => ({
    article,
    prev: i > 0 ? { slug: sorted[i - 1].slug, titleZh: sorted[i - 1].titleZh } : null,
    next: i < sorted.length - 1 ? { slug: sorted[i + 1].slug, titleZh: sorted[i + 1].titleZh } : null,
  }));
}
