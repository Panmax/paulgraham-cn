// Write `content/summaries.json`: a 2-3 sentence Chinese standfirst per essay.
//
// These are displayed under the title and used as the meta description, so the
// prompt forbids adding anything that is not in the translation. Like tags,
// summaries live in their own file and are NOT part of `npm run translate` —
// a translation run must never rewrite editorial metadata.
//
// Regenerates the whole file; git is the undo. Review the diff before committing.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "p-limit";
import { z } from "zod";
import { readAllArticles } from "../pipeline/store.js";
import { createOpenRouterTranslator } from "../pipeline/translate.js";
import type { Article } from "../shared/article-schema.js";

const CONTENT_DIR = join(process.cwd(), "content");
const ARTICLES_DIR = join(CONTENT_DIR, "articles");
const OUT = join(CONTENT_DIR, "summaries.json");
const BATCH = 10;
const RETRIES = 3;
const EXCERPT_CHARS = 900;

const SummarySchema = z.object({
  slug: z.string(),
  summary: z.string().min(30).max(180).refine((s) => !s.includes("http")),
});

const ResponseSchema = z.object({ summaries: z.array(SummarySchema) });

const SYSTEM = `你在为 Paul Graham 文章的中文译文写内容提要，帮助读者和搜索引擎在一小段话里理解文章主旨。

规则：
1. 只根据给出的中文正文写，不得添加原文没有的信息、数字或判断。
2. 2-3 句，80-140 个汉字。直接说文章讲了什么、作者的核心观点。
3. 不要复述标题；不要用“本文”“这篇文章”开头；不要写“Paul Graham 认为”这类套话，直接陈述观点。
4. 不要分段，不要用 Markdown、引号或任何格式标记。
5. 语气平实，贴近原文，不要营销腔。

只返回 JSON：{"summaries":[{"slug":"...","summary":"..."}]}。
必须覆盖输入里的每一篇，一篇不漏、不多不少。`;

function excerpt(a: Article): string {
  return a.segments
    .filter((s) => s.type === "paragraph" && s.zhMarkdown?.trim())
    .slice(0, 3)
    .map((s) => s.zhMarkdown!.trim())
    .join("\n")
    .slice(0, EXCERPT_CHARS);
}

type Batch = Array<{ slug: string; titleZh: string; titleEn: string; excerpt: string }>;

async function summarizeBatch(
  generate: (system: string, user: string) => Promise<string>,
  batch: Batch,
): Promise<Map<string, string>> {
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
      lastError = parsed.error.issues.map((i) => i.message).join("; ");
      continue;
    }
    const out = new Map<string, string>();
    let problem = "";
    for (const entry of parsed.data.summaries) {
      if (!batch.some((b) => b.slug === entry.slug)) { problem = `unknown slug ${entry.slug}`; break; }
      if (out.has(entry.slug)) { problem = `duplicate slug ${entry.slug}`; break; }
      out.set(entry.slug, entry.summary.trim());
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
      slug: a.slug, titleZh: a.titleZh, titleEn: a.titleEn, excerpt: excerpt(a),
    })));
  }
  console.log(`summarizing ${articles.length} articles in ${batches.length} batches…`);

  const limit = pLimit(3);
  let done = 0;
  const results = await Promise.all(batches.map((b) => limit(async () => {
    const r = await summarizeBatch(translator.generate, b);
    done += b.length;
    console.log(`  ${done}/${articles.length}`);
    return r;
  })));

  const summaries: Record<string, string> = {};
  for (const a of articles) summaries[a.slug] = "";
  for (const r of results) for (const [slug, summary] of r) summaries[slug] = summary;

  const missing = Object.entries(summaries).filter(([, s]) => !s).map(([slug]) => slug);
  if (missing.length) throw new Error(`no summary returned for: ${missing.join(", ")}`);

  await writeFile(OUT, JSON.stringify({ summaries }, null, 2) + "\n", "utf8");
  console.log(`\nwrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
