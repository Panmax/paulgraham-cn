import { describe, it, expect } from "vitest";
import { extractLinkUrls, extractNumbers, validateTranslation } from "./validate.js";

describe("extractors", () => {
  it("extracts link urls", () => {
    expect(extractLinkUrls("see [a](https://x.com/1) and [b](https://y.com)")).toEqual([
      "https://x.com/1", "https://y.com",
    ]);
  });
  it("extracts numbers", () => {
    expect(extractNumbers("in 1995 there were 3 things")).toEqual(["1995", "3"]);
  });
});

describe("validateTranslation", () => {
  const req = [{ id: 1, enMarkdown: "In 2005 see [YC](https://ycombinator.com)." }];

  it("passes when ids, links, numbers all preserved", () => {
    const ret = [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }];
    expect(validateTranslation(req, ret).ok).toBe(true);
  });
  it("fails when an id is missing", () => {
    expect(validateTranslation(req, []).ok).toBe(false);
  });
  it("fails when a link is dropped", () => {
    const ret = [{ id: 1, zhMarkdown: "2005 年参见 YC。" }];
    const r = validateTranslation(req, ret);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/link/i);
  });
  it("fails when a number is dropped", () => {
    const ret = [{ id: 1, zhMarkdown: "某年参见 [YC](https://ycombinator.com)。" }];
    expect(validateTranslation(req, ret).ok).toBe(false);
  });
});
