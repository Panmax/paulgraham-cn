export function groupByYear<T extends { publishedAt: string | null }>(
  sorted: T[],
): Array<{ year: string | null; items: T[] }> {
  const groups: Array<{ year: string | null; items: T[] }> = [];
  const byYear = new Map<string, T[]>();
  const undated: T[] = [];
  for (const a of sorted) {
    if (a.publishedAt) {
      const y = a.publishedAt.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(a);
    } else undated.push(a);
  }
  for (const y of [...byYear.keys()].sort().reverse()) groups.push({ year: y, items: byYear.get(y)! });
  if (undated.length) groups.push({ year: null, items: undated });
  return groups;
}
