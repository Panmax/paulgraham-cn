import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArticle, readAllArticles, writeArticle, writeManifest } from "./store.js";
import type { Article, Manifest } from "../shared/article-schema.js";

const article: Article = {
  slug: "earn", titleEn: "E", titleZh: "赚", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 2, sourceUrl: "https://paulgraham.com/earn.html",
  translatedAt: "2026-07-08", model: "gemini-3.5-flash",
  segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "a", zhMarkdown: "啊" }],
};

let base: string;
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), "pgcn-")); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe("store", () => {
  it("round-trips an article", async () => {
    const dir = join(base, "articles");
    await writeArticle(dir, article);
    const back = await readArticle(dir, "earn");
    expect(back).toEqual(article);
  });

  it("returns null for a missing article", async () => {
    expect(await readArticle(join(base, "articles"), "nope")).toBeNull();
  });

  it("readAllArticles reads every article sorted by slug", async () => {
    const dir = join(base, "articles");
    await writeArticle(dir, { ...article, slug: "winc" });
    await writeArticle(dir, { ...article, slug: "earn" });
    const all = await readAllArticles(dir);
    expect(all.map((a) => a.slug)).toEqual(["earn", "winc"]);
  });

  it("readAllArticles returns [] when the dir is missing", async () => {
    expect(await readAllArticles(join(base, "nope"))).toEqual([]);
  });

  it("writes a manifest with trailing newline", async () => {
    const manifest: Manifest = { generatedAt: "t", articles: [] };
    await writeManifest(base, manifest);
    const raw = await readFile(join(base, "manifest.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(manifest);
  });
});
