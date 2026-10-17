import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import subsetFont from "subset-font";
import { readAllArticles } from "../pipeline/store.js";
import { collectAllChars, collectBoldChars } from "./lib/chars.js";
import { RAW_FONTS, ASSETS_FONT_DIR, type Weight } from "./font-sources.js";

const OUT_DIR = join(process.cwd(), "public", "fonts", "zh");
const MANIFEST = join(process.cwd(), "public", "fonts", "manifest.json");
const ARTICLES_DIR = join(process.cwd(), "content", "articles");

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}
function charsetHash(chars: Set<string>): string {
  return sha256([...chars].sort().join(""));
}

async function loadRaw(weight: Weight): Promise<Buffer> {
  const { file, sha256: want } = RAW_FONTS[weight];
  let buf: Buffer;
  try {
    buf = await readFile(join(ASSETS_FONT_DIR, file));
  } catch {
    throw new Error(
      `Missing raw font ${file}. Place Source Han Serif SC OTFs (2.003R) in assets/fonts/ ` +
        `(adobe-fonts/source-han-serif release 09_SourceHanSerifSC.zip).`,
    );
  }
  const got = sha256(buf);
  if (got !== want) throw new Error(`SHA-256 mismatch for ${file}: got ${got}, want ${want}`);
  return buf;
}

// One shared subset per weight covering the whole corpus. The corpus is only
// ~3246 distinct code points, so per-essay subsetting duplicated the common
// glyphs 48.8× (139MB); a single shared subset is ~3–4MB total.
async function emit(raw: Buffer, chars: Set<string>, weight: Weight): Promise<string> {
  const text = [...chars].join("");
  const sub = await subsetFont(raw, text, { targetFormat: "woff2" });
  const hash = sha256(sub).slice(0, 10);
  const name = `pgcn-song.${weight}.${hash}.woff2`;
  await writeFile(join(OUT_DIR, name), sub);
  return `/fonts/zh/${name}`;
}

async function main(): Promise<void> {
  const articles = await readAllArticles(ARTICLES_DIR);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const raws = { regular: await loadRaw("regular"), bold: await loadRaw("bold") };

  const allChars = collectAllChars(articles);
  const boldChars = collectBoldChars(articles);
  const manifest = {
    sourceSha256: { regular: sha256(raws.regular), bold: sha256(raws.bold) },
    charsetHash: charsetHash(allChars),
    boldCharsetHash: charsetHash(boldChars),
    files: {
      regular: await emit(raws.regular, allChars, "regular"),
      bold: await emit(raws.bold, boldChars, "bold"),
    },
  };

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `fonts: regular ${allChars.size} code points, bold ${boldChars.size} ` +
      `(${Math.round((boldChars.size / allChars.size) * 100)}%) → public/fonts/zh/`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
