import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArticle, readAllArticles, writeArticle, writeManifest, articleContentEqual } from "./store.js";
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

describe("articleContentEqual", () => {
  it("ignores translatedAt — a new run date is not a source revision", () => {
    expect(articleContentEqual(article, { ...article, translatedAt: "2026-07-10" })).toBe(true);
  });

  it("detects a changed translation", () => {
    const edited = { ...article, segments: [{ ...article.segments[0], zhMarkdown: "改了" }] };
    expect(articleContentEqual(article, edited)).toBe(false);
  });

  it("detects a changed English source hash", () => {
    const edited = { ...article, segments: [{ ...article.segments[0], sourceHash: "h2" }] };
    expect(articleContentEqual(article, edited)).toBe(false);
  });

  it("detects added and removed segments", () => {
    const extra = { ...article, segments: [...article.segments, { id: 2, type: "paragraph" as const, sourceHash: "h2" }] };
    expect(articleContentEqual(article, extra)).toBe(false);
    expect(articleContentEqual(extra, article)).toBe(false);
  });

  it("detects title and metadata changes", () => {
    expect(articleContentEqual(article, { ...article, titleZh: "别的" })).toBe(false);
    expect(articleContentEqual(article, { ...article, dateText: "July 2026" })).toBe(false);
    expect(articleContentEqual(article, { ...article, sourceOrder: 3 })).toBe(false);
  });
});
