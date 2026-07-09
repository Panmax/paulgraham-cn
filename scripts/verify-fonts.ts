import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readAllArticles } from "../pipeline/store.js";
import { collectAllChars } from "./lib/chars.js";
import type { Article } from "../shared/article-schema.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const csh = (set: Set<string>) => sha([...set].sort().join(""));

export function checkManifest(
  articles: Article[],
  m: { charsetHash: string; files: { regular: string; bold: string } },
  fileExists: (publicPath: string) => boolean,
): string[] {
  const problems: string[] = [];
  if (m.charsetHash !== csh(collectAllChars(articles)))
    problems.push("font charset stale — content changed; rerun `npm run fonts` and commit public/fonts/");
  for (const w of ["regular", "bold"] as const)
    if (!fileExists(m.files[w])) problems.push(`missing font file: ${w} (${m.files[w]})`);
  return problems;
}

async function main() {
  const root = process.cwd();
  const articles = await readAllArticles(join(root, "content", "articles"));
  const m = JSON.parse(await readFile(join(root, "public", "fonts", "manifest.json"), "utf8"));
  const problems = checkManifest(articles, m, (p) => existsSync(join(root, "public", p)));
  if (problems.length) {
    console.error("✗ font verification failed:\n" + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
  console.log(`✓ fonts verified (charset over ${articles.length} articles)`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
