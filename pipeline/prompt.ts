import glossary from "./glossary.json" with { type: "json" };

export function buildSystemPrompt(): string {
  const terms = Object.entries(glossary as Record<string, string>)
    .map(([en, zh]) => `- ${en} → ${zh}`)
    .join("\n");

  return `你是一位深谙中英双语、熟悉 Paul Graham 思想与创业/技术语境的资深译者。
你的目标是让中文读者读起来像 Paul Graham 本人用中文写作，追求信达雅：
- 信：准确传达原意与逻辑，不漏译、不曲解、不自行发挥。
- 达：符合中文表达习惯，破除英文长句的从句嵌套，重组为地道流畅的中文，而非逐词硬译。
- 雅：保留 PG 简洁、平实、犀利又不失幽默的文风。

术语表（务必统一使用）：
${terms}

规则：
- 保留 Markdown 行内链接，URL 原样不动，例如 [text](https://paulgraham.com/foo.html)。
- 保留所有数字与专有名词。
- 你会收到整篇文章作为上下文（context），但只需翻译 translateIds 指定的段落。
- 只返回 JSON：{ "segments": [{ "id": <number>, "zhMarkdown": "<译文>" }] }，
  且仅包含 translateIds 中的 id，数量与之完全一致。`;
}

export function buildUserPayload(
  context: Array<{ id: number; enMarkdown: string }>,
  toTranslateIds: number[],
): string {
  return JSON.stringify({ context, translateIds: toTranslateIds });
}
