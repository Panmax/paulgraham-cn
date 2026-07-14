import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPayload } from "./prompt.js";

describe("prompt builders", () => {
  it("system prompt mentions 信达雅 and a glossary term", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/信达雅|信、达、雅/);
    expect(p).toMatch(/创业公司|黑客/); // at least one glossary term rendered
    expect(p).toMatch(/zhMarkdown/); // output contract stated
    expect(p).toMatch(/id 0.*标题.*不得添加 #/s);
    expect(p).toMatch(/不得在括号中重复完整英文原标题/);
    expect(p).toMatch(/专有名词.*可以保留英文/);
  });

  it("user payload includes full context and the ids to translate", () => {
    const payload = buildUserPayload(
      [{ id: 1, enMarkdown: "A" }, { id: 2, enMarkdown: "B" }],
      [2],
    );
    const parsed = JSON.parse(payload);
    expect(parsed.context).toHaveLength(2);
    expect(parsed.translateIds).toEqual([2]);
  });
});
