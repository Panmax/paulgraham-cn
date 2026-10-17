import { describe, it, expect, vi } from "vitest";
import { translateSegments } from "./translate.js";

const context = [{ id: 1, enMarkdown: "In 2005 see [YC](https://ycombinator.com)." }];
const validResponse = JSON.stringify({
  segments: [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }],
});

describe("translateSegments", () => {
  it("returns validated translations", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({ segments: [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }] }),
    );
    const out = await translateSegments({ generate }, context, [1]);
    expect(out).toEqual([{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries when validation fails then succeeds", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "参见 YC。" }] })) // drops link
      .mockResolvedValueOnce(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "2005 年参见 [YC](https://ycombinator.com)。" }] }));
    const out = await translateSegments({ generate }, context, [1], { retries: 2 });
    expect(out[0].zhMarkdown).toContain("ycombinator.com");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "参见 YC。" }] }));
    await expect(translateSegments({ generate }, context, [1], { retries: 1 })).rejects.toThrow(/validation/i);
  });

  it.each([
    ["null response", "null"],
    ["array response", "[]"],
    ["missing segments", "{}"],
    ["non-array segments", JSON.stringify({ segments: {} })],
    ["null segment", JSON.stringify({ segments: [null] })],
    ["string id", JSON.stringify({ segments: [{ id: "1", zhMarkdown: "译文" }] })],
    ["non-string markdown", JSON.stringify({ segments: [{ id: 1, zhMarkdown: null }] })],
  ])("retries a malformed %s inside the validation loop", async (_name, malformed) => {
    const generate = vi.fn()
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(validResponse);

    await expect(translateSegments({ generate }, context, [1], { retries: 1 }))
      .resolves.toEqual(JSON.parse(validResponse).segments);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("retries a blank translation instead of accepting it as complete", async () => {
    const plainContext = [{ id: 1, enMarkdown: "Hello." }];
    const generate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "   " }] }))
      .mockResolvedValueOnce(JSON.stringify({ segments: [{ id: 1, zhMarkdown: "你好。" }] }));

    await expect(translateSegments({ generate }, plainContext, [1], { retries: 1 }))
      .resolves.toEqual([{ id: 1, zhMarkdown: "你好。" }]);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
