import { unified } from "unified";
import remarkParse from "remark-parse";

type MarkdownNode = {
  type?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const markdownParser = unified().use(remarkParse);

function linkNodes(md: string): MarkdownNode[] {
  const links: MarkdownNode[] = [];
  const visit = (node: MarkdownNode): void => {
    if (node.type === "link" && typeof node.url === "string") links.push(node);
    node.children?.forEach(visit);
  };
  visit(markdownParser.parse(md) as MarkdownNode);
  return links;
}

export function extractLinkUrls(md: string): string[] {
  return linkNodes(md).map((node) => node.url!.trim()).sort();
}

export function extractNumbers(md: string): string[] {
  return (md.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "")).sort();
}

// Convert every markdown inline link in `md` to its plain link text:
// `[text](url)` -> `text`. Used to remove links the model hallucinated.
export function stripLinks(md: string): string {
  const replacements = linkNodes(md).flatMap((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    const firstChild = node.children?.[0];
    const lastChild = node.children?.at(-1);
    const labelStart = firstChild?.position?.start.offset;
    const labelEnd = lastChild?.position?.end.offset;
    const text = labelStart === undefined || labelEnd === undefined
      ? ""
      : md.slice(labelStart, labelEnd);
    return [{ start, end, text }];
  });
  let stripped = md;
  for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
    stripped = stripped.slice(0, start) + text + stripped.slice(end);
  }
  return stripped;
}

// Repair a spurious-added-link failure: when the English segment contains NO
// links, any link the model put in the translation is invented, so flatten it
// back to plain text (preserving fidelity to the source). Segments whose
// English does contain links are left untouched — those need real validation.
export function stripAddedLinks(
  requested: Array<{ id: number; enMarkdown: string }>,
  returned: Array<{ id: number; zhMarkdown: string }>,
): Array<{ id: number; zhMarkdown: string }> {
  const enHasLink = new Map(requested.map((r) => [r.id, extractLinkUrls(r.enMarkdown).length > 0]));
  return returned.map((r) =>
    enHasLink.get(r.id) === false && extractLinkUrls(r.zhMarkdown).length > 0
      ? { ...r, zhMarkdown: stripLinks(r.zhMarkdown) }
      : r,
  );
}

export type TranslationCheck = { ok: boolean; errors: string[]; warnings: string[] };

export function validateTranslation(
  requested: Array<{ id: number; enMarkdown: string }>,
  returned: Array<{ id: number; zhMarkdown: string }>,
): TranslationCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reqIds = new Set(requested.map((r) => r.id));
  const retIds = new Set(returned.map((r) => r.id));
  const seenRetIds = new Set<number>();
  const duplicateRetIds = new Set<number>();
  for (const { id } of returned) {
    if (seenRetIds.has(id)) duplicateRetIds.add(id);
    seenRetIds.add(id);
  }
  for (const id of duplicateRetIds) errors.push(`duplicate translation for id ${id}`);
  for (const id of reqIds) if (!retIds.has(id)) errors.push(`missing translation for id ${id}`);
  for (const id of retIds) if (!reqIds.has(id)) errors.push(`unexpected id ${id} in output`);

  const retById = new Map(returned.map((r) => [r.id, r.zhMarkdown]));
  for (const r of requested) {
    const zh = retById.get(r.id);
    if (zh === undefined) continue;
    // Hard gate: link URLs must be preserved exactly (they carry meaning and
    // should never change between languages).
    const enLinks = extractLinkUrls(r.enMarkdown);
    const zhLinks = extractLinkUrls(zh);
    if (JSON.stringify(enLinks) !== JSON.stringify(zhLinks)) {
      errors.push(`link mismatch in id ${r.id}: [${enLinks}] vs [${zhLinks}]`);
    }
    // Soft warning only: Chinese legitimately reformats numbers using 万/亿
    // units (e.g. "526 million" -> "5.26亿", "44 million" -> "4400万"), so a
    // literal-digit check produces false positives. Surface for human review
    // rather than blocking/retrying the whole article.
    const enNums = extractNumbers(r.enMarkdown);
    for (const n of enNums) if (!zh.includes(n)) warnings.push(`number ${n} not verbatim in id ${r.id}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
