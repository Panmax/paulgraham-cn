import { describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { TAGS, TAG_IDS } from "../../shared/tags.js";
import { assignments, slugsWithTag } from "./tags.js";

const ARTICLES_DIR = join(process.cwd(), "content", "articles");

async function slugsOnDisk(): Promise<string[]> {
  const files = await readdir(ARTICLES_DIR);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
}

// `content/tags.json` is keyed by slug, so a rename or a new essay leaves it
// silently stale: the article drops off every tag page, or a ghost entry keeps
// a chip alive. These are the checks that notice.
describe("content/tags.json", () => {
  it("assigns 1-3 tags to every article on disk", async () => {
    const onDisk = await slugsOnDisk();
    const untagged = onDisk.filter((s) => !assignments[s]?.length);
    expect(untagged).toEqual([]);
  });

  it("has no entry for an article that does not exist", async () => {
    const onDisk = new Set(await slugsOnDisk());
    expect(Object.keys(assignments).filter((s) => !onDisk.has(s))).toEqual([]);
  });

  it("uses only vocabulary tags, at most 3 per article", () => {
    for (const [slug, tags] of Object.entries(assignments)) {
      expect(tags.length, slug).toBeLessThanOrEqual(3);
      for (const t of tags) expect(TAG_IDS, slug).toContain(t);
    }
  });

  it("leaves no tag empty", () => {
    // A chip leading to a page with nothing on it is worse than no chip.
    expect(TAGS.filter((t) => slugsWithTag(t.id).length === 0).map((t) => t.id)).toEqual([]);
  });
});
