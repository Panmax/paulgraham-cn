import { GoogleGenAI } from "@google/genai";
import { buildSystemPrompt, buildUserPayload } from "./prompt.js";
import { validateTranslation } from "./validate.js";

export type TranslatorDeps = {
  generate: (system: string, user: string) => Promise<string>;
};

const MODEL = "gemini-3.5-flash";

export function createVertexTranslator(): TranslatorDeps {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: "live-card-491105",
    // gemini-3.5-flash is served from the "global" location on Vertex, not a
    // regional endpoint like us-central1 (verified: us-central1 returns 404).
    location: "global",
  });
  return {
    async generate(system, user) {
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      });
      return resp.text ?? "";
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
    let parsed: { segments?: Array<{ id: number; zhMarkdown: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      lastErrors = ["model did not return valid JSON"];
      continue;
    }
    const returned = parsed.segments ?? [];
    const check = validateTranslation(requested, returned);
    if (check.ok) return returned;
    lastErrors = check.errors;
  }
  throw new Error(`translation validation failed after ${retries} retries: ${lastErrors.join("; ")}`);
}
