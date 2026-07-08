import { describe, it, expect, vi } from "vitest";
import { translateSegments } from "./translate.js";

const context = [{ id: 1, enMarkdown: "In 2005 see [YC](https://ycombinator.com)." }];

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
});
