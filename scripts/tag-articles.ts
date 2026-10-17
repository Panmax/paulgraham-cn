// Assign every article 1-3 tags from the vocabulary in `shared/tags.ts` and
// write `content/tags.json`.
//
// Deliberately NOT part of `npm run translate`: the translation pipeline is
// incremental over segment `sourceHash` and knows nothing about editorial
// metadata. Keeping tags in a separate file that only this script writes means
// a translation run can never rewrite a hand-corrected classification.
//
// This script regenerates the whole file, so hand edits to assignments are lost
// when you re-run it. That is intentional — you only re-run when the vocabulary
// changes, and then you are redoing the assignments anyway. Git is the undo.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "p-limit";
import { z } from "zod";
import { TAGS, TAG_IDS } from "../shared/tags.js";
import { readAllArticles } from "../pipeline/store.js";
import { createOpenRouterTranslator } from "../pipeline/translate.js";
import { isTranslatable, type Article } from "../shared/article-schema.js";

const CONTENT_DIR = join(process.cwd(), "content");
const ARTICLES_DIR = join(CONTENT_DIR, "articles");
const OUT = join(CONTENT_DIR, "tags.json");
const BATCH = 12;
const RETRIES = 3;
const EXCERPT_CHARS = 700;

const ResponseSchema = z.object({
  articles: z.array(z.object({
    slug: z.string(),
    tags: z.array(z.string()).min(1).max(3),
  })),
});

const SYSTEM = `你在给 Paul Graham 的文章归档打标签，供中文读者按主题浏览。

标签词表（只能从这里选，每篇 1-3 个）：
${TAGS.map((t) => `- ${t.id}（${t.zh}）：${t.hint}`).join("\n")}

规则：
1. tags 里的每一项必须是上面列出的 id，不得自创、不得用中文名。
2. 每篇 1-3 个。一个就够时不要凑第二个；只有确实横跨多个主题时才给三个。
3. 按文章主旨判断，不要因为文中提到某个词就打那个标签。
4. 拿不准时选最贴近主旨的那一个，宁可少不要多。

只返回 JSON：{"articles":[{"slug":"...","tags":["id"]}]}。
必须覆盖输入里的每一篇，一篇不漏、不多不少。`;

function excerpt(a: Article): string {
  return a.segments
    .filter((s) => isTranslatable(s.type) && s.enMarkdown?.trim())
    .slice(0, 2)
    .map((s) => s.enMarkdown!.trim())
    .join("\n\n")
    .slice(0, EXCERPT_CHARS);
}

type Batch = Array<{ slug: string; titleEn: string; titleZh: string; excerpt: string }>;

async function tagBatch(
  generate: (system: string, user: string) => Promise<string>,
  batch: Batch,
): Promise<Map<string, string[]>> {
  const user = JSON.stringify({ articles: batch }, null, 1);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const raw = await generate(SYSTEM, user);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      lastError = "not valid JSON";
      continue;
    }
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) {
      lastError = "wrong response shape";
      continue;
    }
    const out = new Map<string, string[]>();
    let problem = "";
    for (const entry of parsed.data.articles) {
      if (!batch.some((b) => b.slug === entry.slug)) { problem = `unknown slug ${entry.slug}`; break; }
      if (out.has(entry.slug)) { problem = `duplicate slug ${entry.slug}`; break; }
      const bad = entry.tags.find((t) => !TAG_IDS.includes(t));
      if (bad) { problem = `invented tag "${bad}" on ${entry.slug}`; break; }
      if (new Set(entry.tags).size !== entry.tags.length) { problem = `repeated tag on ${entry.slug}`; break; }
      out.set(entry.slug, entry.tags);
    }
    if (problem) { lastError = problem; continue; }
    const missing = batch.filter((b) => !out.has(b.slug)).map((b) => b.slug);
    if (missing.length) { lastError = `missing ${missing.join(", ")}`; continue; }
    return out;
  }
  throw new Error(`batch failed after ${RETRIES} retries: ${lastError}`);
}

async function main(): Promise<void> {
  const articles = await readAllArticles(ARTICLES_DIR);
  if (!articles.length) throw new Error("no articles found");
  const translator = createOpenRouterTranslator();

  const batches: Batch[] = [];
  for (let i = 0; i < articles.length; i += BATCH) {
    batches.push(articles.slice(i, i + BATCH).map((a) => ({
      slug: a.slug, titleEn: a.titleEn, titleZh: a.titleZh, excerpt: excerpt(a),
    })));
  }
  console.log(`tagging ${articles.length} articles in ${batches.length} batches…`);

  const limit = pLimit(3);
  let done = 0;
  const results = await Promise.all(batches.map((b) => limit(async () => {
    const r = await tagBatch(translator.generate, b);
    done += b.length;
    console.log(`  ${done}/${articles.length}`);
    return r;
  })));

  const assignments: Record<string, string[]> = {};
  for (const a of articles) assignments[a.slug] = [];
  for (const r of results) for (const [slug, tags] of r) assignments[slug] = tags;

  const untagged = Object.entries(assignments).filter(([, t]) => !t.length).map(([s]) => s);
  if (untagged.length) throw new Error(`no tags returned for: ${untagged.join(", ")}`);

  await writeFile(OUT, JSON.stringify({ articles: assignments }, null, 2) + "\n", "utf8");

  const counts = new Map<string, number>();
  for (const tags of Object.values(assignments)) {
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  console.log(`\nwrote ${OUT}`);
  for (const t of TAGS) console.log(`  ${t.zh.padEnd(6)} ${String(counts.get(t.id) ?? 0).padStart(3)}`);
  const sizes = Object.values(assignments).map((t) => t.length);
  console.log(`  tags per article: min ${Math.min(...sizes)}  max ${Math.max(...sizes)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
