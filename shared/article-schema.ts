import { z } from "zod";

export const SEGMENT_TYPES = [
  "paragraph", "heading", "hr", "list", "quote", "footnote", "rawUnsupported",
] as const;

export const SegmentTypeSchema = z.enum(SEGMENT_TYPES);
export type SegmentType = z.infer<typeof SegmentTypeSchema>;

export const TRANSLATABLE_TYPES: ReadonlySet<SegmentType> = new Set([
  "paragraph", "heading", "list", "quote", "footnote",
]);

export function isTranslatable(type: SegmentType): boolean {
  return TRANSLATABLE_TYPES.has(type);
}

export const SegmentSchema = z.object({
  id: z.number().int().positive(),
  type: SegmentTypeSchema,
  sourceHash: z.string().min(1),
  enMarkdown: z.string().optional(),
  zhMarkdown: z.string().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ArticleSchema = z.object({
  slug: z.string().min(1),
  titleEn: z.string(),
  titleZh: z.string(),
  dateText: z.string(),
  publishedAt: z.string().nullable(),
  sourceOrder: z.number().int().nonnegative(),
  sourceUrl: z.string().url(),
  translatedAt: z.string(),
  model: z.string(),
  segments: z.array(SegmentSchema),
});
export type Article = z.infer<typeof ArticleSchema>;

export const ManifestEntrySchema = z.object({
  slug: z.string(),
  titleZh: z.string(),
  dateText: z.string(),
  publishedAt: z.string().nullable(),
  sourceOrder: z.number().int().nonnegative(),
  translatedAt: z.string(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  generatedAt: z.string(),
  articles: z.array(ManifestEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;
