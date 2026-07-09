import { describe, it, expect } from "vitest";
import { withNeighbors } from "./adjacent.js";

const A = (slug: string) => ({ slug, titleZh: slug.toUpperCase() });

describe("withNeighbors", () => {
  it("links prev/next along the sorted order with nulls at ends", () => {
    const out = withNeighbors([A("a"), A("b"), A("c")] as any);
    expect(out[0].prev).toBeNull();
    expect(out[0].next).toEqual({ slug: "b", titleZh: "B" });
    expect(out[1].prev).toEqual({ slug: "a", titleZh: "A" });
    expect(out[2].next).toBeNull();
  });
});
