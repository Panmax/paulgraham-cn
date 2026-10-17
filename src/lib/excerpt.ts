import type { Article } from "../../shared/article-schema.js";

/** Flatten inline Markdown to the plain text a search snippet can use. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\d+\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(md: string, max = 60): string {
  const text = stripMarkdown(md);
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/[，、；：,;:\s]+$/, "")}…`;
}

/**
 * The first substantial paragraph, skipping the short italic notes some essays
 * open with ("This is based on a talk I gave…").
 */
export function articleDescription(article: Article): string {
  const lead = `Paul Graham《${article.titleZh}》中文翻译`;
  const para = article.segments.find(
    (s) => s.type === "paragraph" && s.zhMarkdown && stripMarkdown(s.zhMarkdown).length >= 40,
  );
  return para ? `${lead}：${excerpt(para.zhMarkdown!)}` : `${lead}（${article.titleEn}）`;
}
