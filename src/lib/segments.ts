import { isTranslatable, type Segment } from "../../shared/article-schema.js";

export type RenderSeg =
  | { kind: "hr" }
  | { kind: "original"; md: string }
  | { kind: "translated"; zh: string; en: string };

export function classifySegment(seg: Segment): RenderSeg {
  if (seg.type === "hr") return { kind: "hr" };
  const zh = seg.zhMarkdown?.trim();
  if (isTranslatable(seg.type) && zh) return { kind: "translated", zh: seg.zhMarkdown!, en: seg.enMarkdown ?? "" };
  return { kind: "original", md: seg.enMarkdown ?? "" };
}
