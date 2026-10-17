// QA sweep over the stored translations. Mechanical checks only — no API calls.
// Reuses the production gate (`validateTranslation`) so stored data is held to
// exactly the standard the pipeline enforces at write time.
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkCjkFriendly from "remark-cjk-friendly";
import { readAllArticles, readArticle, writeArticle } from "../pipeline/store.js";
import { isTranslatable, type Article, type Segment } from "../shared/article-schema.js";
import { validateTranslation } from "../pipeline/validate.js";

const ARTICLES_DIR = join(process.cwd(), "content", "articles");
const CJK = /[㐀-䶿一-鿿]/;
// 6+ consecutive ASCII words is a sentence, not a proper noun. The prompt
// allows keeping untranslated proper nouns (Airbnb, Lisp), but not whole clauses.
const ENGLISH_RUN = /[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z'’-]+){5,}/;
const MOJIBAKE = /�|[Ãâ][\u0080-¿]/;

// Same parser stack as the site (`src/lib/markdown.ts`), so what this flags is
// what actually renders.
const mdParser = unified().use(remarkParse).use(remarkCjkFriendly);
type Node = { type?: string; value?: string; children?: Node[] };

// Asterisks that survive into a text node never became emphasis — CommonMark
// refuses to open one that sits between a CJK character and CJK punctuation,
// so `*《书名》*` renders as literal asterisks on the page.
function literalStars(md: string): number {
  let n = 0;
  const visit = (node: Node): void => {
    if (node.type === "text" && typeof node.value === "string") n += (node.value.match(/\*/g) ?? []).length;
    node.children?.forEach(visit);
  };
  visit(mdParser.parse(md) as Node);
  return n;
}
// Count real emphasis/strong nodes. Counting raw `*`/`_` would score every
// underscore inside a URL as emphasis.
function emphasisCount(md: string, kind: "emphasis" | "strong"): number {
  let n = 0;
  const visit = (node: Node): void => {
    if (node.type === kind) n++;
    node.children?.forEach(visit);
  };
  visit(mdParser.parse(md) as Node);
  return n;
}

type Finding = { slug: string; id: number | null; detail: string };
const findings = new Map<string, Finding[]>();
function flag(kind: string, f: Finding): void {
  const list = findings.get(kind) ?? [];
  list.push(f);
  findings.set(kind, list);
}

// Segments worth re-translating. Clearing `zhMarkdown` is the pipeline's own
// "needs translation" signal, so `npm run translate` re-translates exactly
// these and nothing else.
const emphasisFixes = new Map<string, Set<number>>();
const termFixes = new Map<string, Set<number>>();
function mark(map: Map<string, Set<number>>, slug: string, id: number): void {
  const ids = map.get(slug) ?? new Set<number>();
  ids.add(id);
  map.set(slug, ids);
}

// One English term must map to one Chinese term. A segment whose English uses
// the term but whose Chinese does not use the agreed rendering has drifted.
// `VC` is listed before `venture capital` — the abbreviation takes the
// abbreviation, the full term takes the full term.
// The compound lookaheads are deliberate: as a modifier of fund/firm the full
// form reads better ("风险投资基金的回报", "风投机构"), so both are accepted
// there. Without them the rule would keep re-translating good translations.
const TERM_RULES: Array<{ en: RegExp; zh: RegExp; label: string }> = [
  { en: /\bVCs?\b(?![\s-]+(?:fund|firms?|industry|community))/i, zh: /风投/, label: "VC → 风投" },
  { en: /\bventure capital(?!\s+firms?)(?:ist)?s?\b/i, zh: /风险投资/, label: "venture capital → 风险投资" },
  { en: /\bprogrammers?\b/i, zh: /程序员/, label: "programmer → 程序员" },
];

const letters = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;
const cjkCount = (s: string) => (s.match(/[㐀-䶿一-鿿]/g) ?? []).length;

// A bibliography entry or an acknowledgment list is legitimately left in
// English / compressed to bare names — neither is evidence of a bad translation.
const isCitation = (en: string) => /^\s*\[\d+\]/.test(en) || (en.match(/https?:\/\//g) ?? []).length >= 2;
const isAckList = (en: string, zh: string) => /thanks to/i.test(en) && /感谢/.test(zh);

function checkSegment(slug: string, seg: Segment): void {
  const en = seg.enMarkdown ?? "";
  const zh = (seg.zhMarkdown ?? "").trim();
  const at = { slug, id: seg.id };

  if (MOJIBAKE.test(en) || MOJIBAKE.test(zh)) {
    flag("乱码 / 替换字符", { ...at, detail: (MOJIBAKE.test(en) ? en : zh).slice(0, 70) });
  }
  if (!zh) {
    flag("空白译文", { ...at, detail: en.slice(0, 60) });
    return;
  }
  if (letters(en) >= 40 && cjkCount(zh) === 0 && !isCitation(en)) {
    flag("译文无中文", { ...at, detail: zh.slice(0, 60) });
  }
  if (/^\s*#{1,6}\s/.test(zh)) {
    flag("译文中混入 Markdown 标题标记", { ...at, detail: zh.slice(0, 60) });
  }
  if (/<\/?[a-zA-Z][^>]*>/.test(zh)) {
    flag("译文中含 HTML 标签", { ...at, detail: zh.slice(0, 60) });
  }
  // Compare against the English: a literal `*` in both is the source's own
  // (glob patterns in the spam-filter essays), not a broken delimiter.
  const zhStars = literalStars(zh);
  if (zhStars > literalStars(en)) {
    flag("星号未渲染成斜体", { ...at, detail: zh.slice(0, 70) });
  }
  const run = ENGLISH_RUN.exec(zh);
  if (run && !isCitation(en)) {
    flag("译文中残留整句英文", { ...at, detail: run[0].slice(0, 80) });
  }
  // Formatting: emphasis the English had should survive into the Chinese.
  // `<em>` renders as accent-coloured text on the site, so a dropped one is
  // visible, not cosmetic.
  // When the source itself carries literal asterisks (the glob patterns in the
  // spam-filter essays), delimiter pairing is unreliable in both languages —
  // skip rather than report a phantom emphasis difference.
  for (const kind of (literalStars(en) > 0 ? [] : ["emphasis", "strong"]) as Array<"emphasis" | "strong">) {
    const enEm = emphasisCount(en, kind);
    const zhEm = emphasisCount(zh, kind);
    const label = kind === "emphasis" ? "斜体" : "加粗";
    if (enEm > 0 && zhEm === 0) {
      flag(`原文有${label}、译文丢失`, { ...at, detail: en.slice(0, 60) });
      mark(emphasisFixes, slug, seg.id);
    }
    if (zhEm > 0 && enEm === 0) {
      flag(`原文无${label}、译文新增`, { ...at, detail: zh.slice(0, 60) });
      mark(emphasisFixes, slug, seg.id);
    }
  }
  for (const rule of TERM_RULES) {
    if (rule.en.test(en) && !rule.zh.test(zh)) {
      flag(`术语漂移: ${rule.label}`, { ...at, detail: zh.slice(0, 60) });
      mark(termFixes, slug, seg.id);
    }
  }
  // Truncation. Only meaningful for real prose: translated (has CJK), long, and
  // not a citation/acknowledgment list.
  const enLetters = letters(en);
  if (enLetters >= 150 && cjkCount(zh) > 0 && !isCitation(en) && !isAckList(en, zh)) {
    const ratio = cjkCount(zh) / enLetters;
    if (ratio < 0.22) flag("译文疑似漏译", { ...at, detail: `${ratio.toFixed(2)} — ${zh.slice(0, 70)}` });
    if (ratio > 1.5) flag("译文疑似增译", { ...at, detail: `${ratio.toFixed(2)} — ${zh.slice(0, 70)}` });
  }
}

function checkArticle(a: Article): void {
  const segs = a.segments.filter((s) => isTranslatable(s.type) && s.enMarkdown);
  for (const s of segs) checkSegment(a.slug, s);

  // The same hard gate the pipeline enforces before writing.
  const check = validateTranslation(
    segs.map((s) => ({ id: s.id, enMarkdown: s.enMarkdown as string })),
    segs.filter((s) => s.zhMarkdown?.trim()).map((s) => ({ id: s.id, zhMarkdown: s.zhMarkdown as string })),
  );
  for (const e of check.errors) flag("链接不一致 (硬门禁)", { slug: a.slug, id: null, detail: e });

  const t = a.titleZh.trim();
  if (!t) flag("标题为空", { slug: a.slug, id: 0, detail: a.titleEn });
  else if (/^#{1,6}\s/.test(t)) flag("标题含 Markdown 标记", { slug: a.slug, id: 0, detail: t });
  // Only a title wrapped end-to-end in quotes is wrong; quotes *inside* a title
  // (quoting a term) are normal Chinese.
  else if (/^["“「『].*["”」』]$/.test(t)) flag("标题整体被引号包裹", { slug: a.slug, id: 0, detail: t });
  else if (letters(t) >= 25) flag("标题含大段英文", { slug: a.slug, id: 0, detail: t });
}

// Corpus-wide term consistency: how often each preferred glossary rendering is
// used versus its common alternative. Guidance, not a hard rule — the point is
// to spot a corpus that splits between two renderings.
const VARIANTS: Array<[string, string[]]> = [
  ["创业公司", ["初创公司", "初创企业", "创业团队"]],
  ["创始人", ["创办人", "创立者"]],
  ["黑客", ["骇客"]],
  ["风险投资", ["风投", "创投"]],
  ["天使投资人", ["天使投资"]],
  ["程序员", ["开发者", "工程师"]],
];

async function main(): Promise<void> {
  const articles = await readAllArticles(ARTICLES_DIR);
  for (const a of articles) checkArticle(a);

  const blankEmphasis = process.argv.includes("--blank-emphasis");
  const blankTerms = process.argv.includes("--blank-terms");
  if (blankEmphasis || blankTerms) {
    const targets = new Map<string, Set<number>>();
    for (const source of [blankEmphasis && emphasisFixes, blankTerms && termFixes]) {
      if (!source) continue;
      for (const [slug, ids] of source) {
        for (const id of ids) mark(targets, slug, id);
      }
    }
    let touched = 0;
    let blanked = 0;
    for (const [slug, ids] of targets) {
      const article = await readArticle(ARTICLES_DIR, slug);
      if (!article) continue;
      for (const seg of article.segments) {
        if (ids.has(seg.id)) {
          seg.zhMarkdown = "";
          blanked++;
        }
      }
      await writeArticle(ARTICLES_DIR, article);
      touched++;
    }
    console.log(`blanked ${blanked} segments in ${touched} articles — now run \`npm run translate\``);
  }

  const segs = articles.flatMap((a) => a.segments.filter((s) => isTranslatable(s.type) && s.enMarkdown));
  const ratios = segs
    .filter((s) => letters(s.enMarkdown ?? "") >= 150 && cjkCount(s.zhMarkdown ?? "") > 0)
    .map((s) => cjkCount(s.zhMarkdown as string) / letters(s.enMarkdown as string))
    .sort((x, y) => x - y);
  const pct = (p: number) => ratios[Math.floor(ratios.length * p)]?.toFixed(2) ?? "n/a";

  console.log(`articles: ${articles.length}   translatable segments: ${segs.length}`);
  console.log(`length ratio (zh CJK / en letters): p1 ${pct(0.01)}  p5 ${pct(0.05)}  median ${pct(0.5)}  p95 ${pct(0.95)}  p99 ${pct(0.99)}`);

  const showAll = process.argv.includes("--all");
  const only = process.argv.find((a) => a.startsWith("--kind="))?.slice("--kind=".length);
  console.log("\n=== findings ===");
  const ranked = [...findings.entries()]
    .filter(([kind]) => !only || kind.includes(only))
    .sort((a, b) => b[1].length - a[1].length);
  if (!ranked.length) console.log("(none)");
  for (const [kind, list] of ranked) {
    const byArticle = new Set(list.map((f) => f.slug)).size;
    console.log(`\n${kind}: ${list.length} 处，涉及 ${byArticle} 篇`);
    const shown = showAll ? list : list.slice(0, 6);
    for (const f of shown) console.log(`  ${f.slug}${f.id === null ? "" : `:${f.id}`} — ${f.detail}`);
    if (list.length > shown.length) console.log(`  … 另有 ${list.length - shown.length} 处`);
  }

  console.log("\n=== glossary consistency (corpus-wide) ===");
  const all = articles
    .map((a) => [a.titleZh, ...a.segments.map((s) => s.zhMarkdown ?? "")].join("\n"))
    .join("\n");
  for (const [preferred, alts] of VARIANTS) {
    // Longest first and consume as we go: `天使投资` is a substring of
    // `天使投资人`, so counting each term independently double-counts.
    const terms = [preferred, ...alts].sort((a, b) => b.length - a.length);
    let rest = all;
    const counts = new Map<string, number>();
    for (const t of terms) {
      const n = rest.split(t).length - 1;
      if (n) counts.set(t, n);
      rest = rest.split(t).join("\u0000".repeat(t.length));
    }
    const total = [...counts.values()].reduce((n, c) => n + c, 0);
    if (total === 0) continue;
    console.log(
      `  ${[...counts].map(([t, c]) => `${t} ${c} (${Math.round((c / total) * 100)}%)`).join("  |  ")}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
