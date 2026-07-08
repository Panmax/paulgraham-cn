// pipeline/assemble.ts
import { alignSegments } from "./align.js";
import { translateSegments, type TranslatorDeps } from "./translate.js";
import type { ParsedArticle } from "./parse-article.js";
import { isTranslatable, type Article, type Segment } from "../shared/article-schema.js";

type ListEntry = { slug: string; titleEn: string; sourceUrl: string; sourceOrder: number };

export type AssembleStats = {
  new: number; changed: number; unchanged: number; deleted: number; rawUnsupported: number[];
};

// Title carries id 0 in the translation context (never collides with body ids ≥ 1).
const TITLE_ID = 0;

export async function assembleArticle(params: {
  listEntry: ListEntry;
  parsed: ParsedArticle;
  existing: Article | null;
  translator: TranslatorDeps;
  translatedAt: string;
  model: string;
}): Promise<{ article: Article; stats: AssembleStats }> {
  const { listEntry, parsed, existing, translator, translatedAt, model } = params;

  const { aligned } = alignSegments(existing?.segments ?? [], parsed.segments);
  const segments: Segment[] = aligned.map((a) => a.segment);

  // Full translatable context (body).
  const context = segments
    .filter((s) => isTranslatable(s.type) && s.enMarkdown)
    .map((s) => ({ id: s.id, enMarkdown: s.enMarkdown as string }));

  // Ids needing translation: changed + new (i.e. missing zhMarkdown among translatable).
  const toTranslate = segments
    .filter((s) => isTranslatable(s.type) && s.enMarkdown && s.zhMarkdown === undefined)
    .map((s) => s.id);

  // Title: reuse if unchanged, else translate via id 0.
  const titleUnchanged = existing && existing.titleEn === parsed.titleEn && existing.titleZh;
  let titleZh = titleUnchanged ? existing!.titleZh : "";

  const titleContext = { id: TITLE_ID, enMarkdown: parsed.titleEn };
  const fullContext = [titleContext, ...context];
  const requestIds = [...toTranslate];
  if (!titleUnchanged) requestIds.unshift(TITLE_ID);

  if (requestIds.length > 0) {
    const results = await translateSegments(translator, fullContext, requestIds);
    const byId = new Map(results.map((r) => [r.id, r.zhMarkdown]));
    if (!titleUnchanged && byId.has(TITLE_ID)) titleZh = byId.get(TITLE_ID)!;
    for (const s of segments) {
      if (byId.has(s.id)) s.zhMarkdown = byId.get(s.id);
    }
  }

  // Stats count only translatable segments (hr/rawUnsupported are structural,
  // never translated, and must not inflate new/changed/unchanged/deleted).
  const translatableAligned = aligned.filter((a) => isTranslatable(a.segment.type));
  const oldTranslatable = (existing?.segments ?? []).filter((s) => isTranslatable(s.type)).length;
  const stats: AssembleStats = {
    new: translatableAligned.filter((a) => a.disposition === "new").length,
    changed: translatableAligned.filter((a) => a.disposition === "changed").length,
    unchanged: translatableAligned.filter((a) => a.disposition === "unchanged").length,
    deleted: oldTranslatable
      - translatableAligned.filter((a) => a.disposition === "unchanged" || a.disposition === "changed").length,
    rawUnsupported: segments.filter((s) => s.type === "rawUnsupported").map((s) => s.id),
  };

  const article: Article = {
    slug: listEntry.slug,
    titleEn: parsed.titleEn,
    titleZh,
    dateText: parsed.dateText,
    publishedAt: parsed.publishedAt,
    sourceOrder: listEntry.sourceOrder,
    sourceUrl: listEntry.sourceUrl,
    translatedAt,
    model,
    segments,
  };

  return { article, stats };
}
