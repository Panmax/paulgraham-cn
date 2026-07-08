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

export type TranslationCheck = { ok: boolean; errors: string[] };

export function validateTranslation(
  requested: Array<{ id: number; enMarkdown: string }>,
  returned: Array<{ id: number; zhMarkdown: string }>,
): TranslationCheck {
  const errors: string[] = [];
  const reqIds = new Set(requested.map((r) => r.id));
  const retIds = new Set(returned.map((r) => r.id));
  for (const id of reqIds) if (!retIds.has(id)) errors.push(`missing translation for id ${id}`);
  for (const id of retIds) if (!reqIds.has(id)) errors.push(`unexpected id ${id} in output`);

  const retById = new Map(returned.map((r) => [r.id, r.zhMarkdown]));
  for (const r of requested) {
    const zh = retById.get(r.id);
    if (zh === undefined) continue;
    const enLinks = extractLinkUrls(r.enMarkdown);
    const zhLinks = extractLinkUrls(zh);
    if (JSON.stringify(enLinks) !== JSON.stringify(zhLinks)) {
      errors.push(`link mismatch in id ${r.id}: [${enLinks}] vs [${zhLinks}]`);
    }
    const enNums = extractNumbers(r.enMarkdown);
    for (const n of enNums) if (!zh.includes(n)) errors.push(`number ${n} missing in id ${r.id}`);
  }
  return { ok: errors.length === 0, errors };
}
