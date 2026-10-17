import { z } from "zod";
import { buildSystemPrompt, buildUserPayload } from "./prompt.js";
import { validateTranslation, stripAddedLinks } from "./validate.js";

export type TranslatorDeps = {
  generate: (system: string, user: string) => Promise<string>;
};

export const MODEL = "google/gemini-3.8-flash";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 180_000;

const TranslationResponseSchema = z.object({
  segments: z.array(z.object({
    id: z.number().int(),
    zhMarkdown: z.string().refine((value) => value.trim().length > 0),
  })),
});

export function createOpenRouterTranslator(): TranslatorDeps {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    async generate(system, user) {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const content = (await resp.json())?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("OpenRouter returned no message content");
      // Some providers ignore response_format and wrap the JSON in a code fence.
      const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
      return fenced ? fenced[1] : content;
    },
  };
}

export async function translateSegments(
  deps: TranslatorDeps,
  context: Array<{ id: number; enMarkdown: string }>,
  toTranslateIds: number[],
  opts: { retries?: number } = {},
): Promise<Array<{ id: number; zhMarkdown: string }>> {
  const { retries = 3 } = opts;
  const system = buildSystemPrompt();
  const user = buildUserPayload(context, toTranslateIds);
  const requested = context.filter((c) => toTranslateIds.includes(c.id));

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await deps.generate(system, user);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      lastErrors = ["model did not return valid JSON"];
      continue;
    }
    const parsed = TranslationResponseSchema.safeParse(json);
    if (!parsed.success) {
      lastErrors = ["model returned invalid translation response structure"];
      continue;
    }
    // Repair the common failure where the model hyperlinks a plain-text
    // mention (e.g. a book/essay title) the English left unlinked.
    const returned = stripAddedLinks(requested, parsed.data.segments);
    const check = validateTranslation(requested, returned);
    if (check.ok) {
      if (check.warnings.length) {
        for (const w of check.warnings) console.warn(`  ⚠ ${w}`);
      }
      return returned;
    }
    lastErrors = check.errors;
  }
  throw new Error(`translation validation failed after ${retries} retries: ${lastErrors.join("; ")}`);
}
