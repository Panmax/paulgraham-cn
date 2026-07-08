import { describe, it, expect } from "vitest";
import { sortArticles } from "./sort.js";

describe("sortArticles", () => {
  it("sorts by publishedAt desc then sourceOrder asc", () => {
    const input = [
      { publishedAt: "2020-01-01", sourceOrder: 5 },
      { publishedAt: "2026-06-01", sourceOrder: 3 },
      { publishedAt: "2026-06-01", sourceOrder: 1 },
      { publishedAt: null, sourceOrder: 2 },
    ];
    expect(sortArticles(input)).toEqual([
      { publishedAt: "2026-06-01", sourceOrder: 1 },
      { publishedAt: "2026-06-01", sourceOrder: 3 },
      { publishedAt: "2020-01-01", sourceOrder: 5 },
      { publishedAt: null, sourceOrder: 2 },
    ]);
  });
});
