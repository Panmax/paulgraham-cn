export function extractLinkUrls(md: string): string[] {
  const urls: string[] = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) urls.push(m[1].trim());
  return urls.sort();
}

export function extractNumbers(md: string): string[] {
  return (md.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "")).sort();
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
