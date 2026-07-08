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
  it("does NOT fail the hard gate when a number is not verbatim, but warns", () => {
    // Chinese reformats numbers (万/亿), so a non-verbatim number is a soft
    // warning, not a hard failure that would block/retry the whole article.
    const ret = [{ id: 1, zhMarkdown: "某年参见 [YC](https://ycombinator.com)。" }];
    const r = validateTranslation(req, ret);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/number 2005/i);
  });

  it("treats a Chinese 亿-formatted number as acceptable (no verbatim digits)", () => {
    const bigReq = [{ id: 1, enMarkdown: "526 million a year" }];
    const bigRet = [{ id: 1, zhMarkdown: "每年 5.26 亿" }];
    const r = validateTranslation(bigReq, bigRet);
    expect(r.ok).toBe(true); // 526 absent verbatim -> warning only, not a failure
  });
});
