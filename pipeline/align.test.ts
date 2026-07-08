// pipeline/align.test.ts
import { describe, it, expect } from "vitest";
import { alignSegments } from "./align.js";
import type { Segment } from "../shared/article-schema.js";

const old: Segment[] = [
  { id: 1, type: "paragraph", sourceHash: "h1", enMarkdown: "Alpha one two three", zhMarkdown: "甲" },
  { id: 2, type: "paragraph", sourceHash: "h2", enMarkdown: "Beta four five six", zhMarkdown: "乙" },
  { id: 3, type: "paragraph", sourceHash: "h3", enMarkdown: "Gamma seven eight", zhMarkdown: "丙" },
];

describe("alignSegments", () => {
  it("keeps unchanged segments with id and zh preserved", () => {
    const parsed = old.map((s) => ({ type: s.type, enMarkdown: s.enMarkdown, sourceHash: s.sourceHash }));
    const { aligned } = alignSegments(old, parsed);
    expect(aligned.map((a) => a.disposition)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(aligned[0].segment.zhMarkdown).toBe("甲");
    expect(aligned[0].segment.id).toBe(1);
  });

  it("detects a changed segment and inherits its id, clears zh", () => {
    const parsed = [
      { type: "paragraph" as const, enMarkdown: "Alpha one two three", sourceHash: "h1" },
      { type: "paragraph" as const, enMarkdown: "Beta four five six EDITED", sourceHash: "h2new" },
      { type: "paragraph" as const, enMarkdown: "Gamma seven eight", sourceHash: "h3" },
    ];
    const { aligned } = alignSegments(old, parsed);
    expect(aligned[1].disposition).toBe("changed");
    expect(aligned[1].segment.id).toBe(2);
    expect(aligned[1].segment.zhMarkdown).toBeUndefined();
    expect(aligned[1].segment.sourceHash).toBe("h2new");
  });

  it("assigns a fresh id to an inserted new segment without shifting others", () => {
    const parsed = [
      { type: "paragraph" as const, enMarkdown: "Alpha one two three", sourceHash: "h1" },
      { type: "paragraph" as const, enMarkdown: "Totally brand new content here", sourceHash: "hNew" },
      { type: "paragraph" as const, enMarkdown: "Beta four five six", sourceHash: "h2" },
      { type: "paragraph" as const, enMarkdown: "Gamma seven eight", sourceHash: "h3" },
    ];
    const { aligned, nextId } = alignSegments(old, parsed);
    expect(aligned[1].disposition).toBe("new");
    expect(aligned[1].segment.id).toBe(4);
    expect(aligned[0].segment.id).toBe(1);
    expect(aligned[2].segment.id).toBe(2);
    expect(nextId).toBe(5);
  });

  it("treats everything as new when there is no old article", () => {
    const parsed = [{ type: "paragraph" as const, enMarkdown: "x", sourceHash: "hx" }];
    const { aligned } = alignSegments([], parsed);
    expect(aligned[0].disposition).toBe("new");
    expect(aligned[0].segment.id).toBe(1);
  });

  it("confines similarity matching to the gap between anchors (no cross-region id theft)", () => {
    // old: A X B Y C ; new: A B Y' C. Anchors A,B,C match by hash. Y' is a light
    // edit of Y and sits in the B..C gap — it must inherit Y's id (40), NOT steal
    // X's id (20) even though X is also unclaimed. X is deleted.
    const oldSegs: Segment[] = [
      { id: 10, type: "paragraph", sourceHash: "hA", enMarkdown: "A anchor alpha", zhMarkdown: "甲" },
      { id: 20, type: "paragraph", sourceHash: "hX", enMarkdown: "Yankee zulu common words here", zhMarkdown: "X译" },
      { id: 30, type: "paragraph", sourceHash: "hB", enMarkdown: "B anchor bravo", zhMarkdown: "乙" },
      { id: 40, type: "paragraph", sourceHash: "hY", enMarkdown: "Yankee zulu common words there", zhMarkdown: "Y译" },
      { id: 50, type: "paragraph", sourceHash: "hC", enMarkdown: "C anchor charlie", zhMarkdown: "丙" },
    ];
    const parsed = [
      { type: "paragraph" as const, enMarkdown: "A anchor alpha", sourceHash: "hA" },
      { type: "paragraph" as const, enMarkdown: "B anchor bravo", sourceHash: "hB" },
      { type: "paragraph" as const, enMarkdown: "Yankee zulu common words there EDITED", sourceHash: "hYnew" },
      { type: "paragraph" as const, enMarkdown: "C anchor charlie", sourceHash: "hC" },
    ];
    const { aligned } = alignSegments(oldSegs, parsed);
    const yPrime = aligned[2];
    expect(yPrime.disposition).toBe("changed");
    expect(yPrime.segment.id).toBe(40); // inherited Y, not X's 20
    // X (id 20) is unmatched → deleted → never appears in output.
    expect(aligned.some((a) => a.segment.id === 20)).toBe(false);
  });
});
