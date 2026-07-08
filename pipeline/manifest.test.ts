// pipeline/manifest.test.ts
import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.js";
import { ManifestSchema, type Article } from "../shared/article-schema.js";

const article: Article = {
  slug: "earn", titleEn: "E", titleZh: "赚", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
  translatedAt: "2026-07-08", model: "gemini-3.5-flash",
  segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "a", zhMarkdown: "啊" }],
};

describe("buildManifest", () => {
  it("produces a schema-valid manifest with one entry per article", () => {
    const m = buildManifest([article], "2026-07-08T00:00:00Z");
    expect(() => ManifestSchema.parse(m)).not.toThrow();
    expect(m.articles[0]).toMatchObject({ slug: "earn", titleZh: "赚", sourceOrder: 2 });
    expect(m.generatedAt).toBe("2026-07-08T00:00:00Z");
  });
});
