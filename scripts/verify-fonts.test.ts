import { describe, it, expect } from "vitest";
import { checkManifest } from "./verify-fonts.js";
import type { Article } from "../shared/article-schema.js";
import { collectAllChars } from "./lib/chars.js";
import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const csh = (set: Set<string>) => sha([...set].sort().join(""));
const a: Article = { slug: "x", titleEn: "T", titleZh: "标题", dateText: "June 2026",
  publishedAt: "2026-06-01", sourceOrder: 1, sourceUrl: "https://paulgraham.com/x.html",
  translatedAt: "2026-07-09", model: "m",
  segments: [{ id: 1, type: "paragraph", sourceHash: "h", enMarkdown: "e", zhMarkdown: "你好" }] };

const goodManifest = (list: Article[]) => ({
  charsetHash: csh(collectAllChars(list)),
  files: {
    regular: "/fonts/zh/pgcn-song.regular.aaaaaaaaaa.woff2",
    bold: "/fonts/zh/pgcn-song.bold.aaaaaaaaaa.woff2",
  },
});

const goodHash = "aaaaaaaaaa" + "0".repeat(54);

describe("checkManifest", () => {
  it("passes when charset hash matches and files exist", () => {
    expect(checkManifest([a], goodManifest([a]), () => goodHash)).toEqual([]);
  });
  it("flags stale fonts when content charset changed", () => {
    const stale = { ...goodManifest([a]), charsetHash: "deadbeef" };
    expect(checkManifest([a], stale, () => goodHash).length).toBeGreaterThan(0);
  });
  it("flags a missing woff2 file on disk", () => {
    expect(checkManifest([a], goodManifest([a]), () => null).length).toBeGreaterThan(0);
  });
  it("flags a woff2 whose content hash does not match the filename hash", () => {
    const mismatchHash = "bbbbbbbbbb" + "0".repeat(54);
    expect(checkManifest([a], goodManifest([a]), () => mismatchHash).length).toBeGreaterThan(0);
  });
});
