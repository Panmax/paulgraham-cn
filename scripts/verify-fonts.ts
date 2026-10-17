import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readAllArticles } from "../pipeline/store.js";
import { collectAllChars, collectBoldChars } from "./lib/chars.js";
import type { Article } from "../shared/article-schema.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const csh = (set: Set<string>) => sha([...set].sort().join(""));

export function checkManifest(
  articles: Article[],
  m: { charsetHash: string; boldCharsetHash?: string; files: { regular: string; bold: string } },
  fileHash: (publicPath: string) => string | null,
): string[] {
  const problems: string[] = [];
  if (m.charsetHash !== csh(collectAllChars(articles)))
    problems.push("font charset stale — content changed; rerun `npm run fonts` and commit public/fonts/");
  // The bold face is subsetted to title + <strong> glyphs only, so a new bold
  // character missing from it would silently fall back to a system font.
  if (m.boldCharsetHash !== undefined && m.boldCharsetHash !== csh(collectBoldChars(articles)))
    problems.push("bold font charset stale — rerun `npm run fonts` and commit public/fonts/");
  for (const w of ["regular", "bold"] as const) {
    const path = m.files[w];
    const hash = fileHash(path);
    if (hash === null) {
      problems.push(`missing font file: ${w} (${path})`);
      continue;
    }
    const match = /\.([^.]+)\.woff2$/.exec(path);
    const embeddedHash = match?.[1] ?? "";
    if (hash.slice(0, 10) !== embeddedHash)
      problems.push(`font file content hash mismatch: ${w} (${path}) — rerun \`npm run fonts\``);
  }
  return problems;
}

function fileHash(publicPath: string): string | null {
  const abs = join(process.cwd(), "public", publicPath);
  if (!existsSync(abs)) return null;
  try {
    return createHash("sha256").update(readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

async function main() {
  const root = process.cwd();
  let articles: Article[];
  let m: { charsetHash: string; files: { regular: string; bold: string } };
  try {
    articles = await readAllArticles(join(root, "content", "articles"));
    m = JSON.parse(await readFile(join(root, "public", "fonts", "manifest.json"), "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `✗ font verification failed: cannot read public/fonts/manifest.json (rerun \`npm run fonts\`): ${message}`,
    );
    process.exit(1);
    return;
  }
  const problems = checkManifest(articles, m, fileHash);
  if (problems.length) {
    console.error("✗ font verification failed:\n" + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
  console.log(`✓ fonts verified (charset over ${articles.length} articles)`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
