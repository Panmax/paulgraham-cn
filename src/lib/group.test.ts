import { describe, it, expect } from "vitest";
import { groupByYear } from "./group.js";

const A = (slug: string, publishedAt: string | null, sourceOrder = 0) =>
  ({ slug, publishedAt, sourceOrder });

describe("groupByYear", () => {
  it("descending year groups with 日期不详 (null) last", () => {
    const g = groupByYear([
      A("a", "2026-06-01"), A("b", "2024-09-01"), A("c", "2026-01-01"), A("d", null, 5),
    ] as any);
    expect(g.map((x) => x.year)).toEqual(["2026", "2024", null]);
    expect(g[0].items.map((i: any) => i.slug)).toEqual(["a", "c"]);
    expect(g[2].items.map((i: any) => i.slug)).toEqual(["d"]);
  });
});
