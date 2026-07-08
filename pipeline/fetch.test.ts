import { describe, it, expect, vi } from "vitest";
import { fetchHtml } from "./fetch.js";

function res(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body } as unknown as Response;
}

describe("fetchHtml", () => {
  it("returns body text on success", async () => {
    const impl = vi.fn().mockResolvedValue(res("<html>hi</html>"));
    const out = await fetchHtml("https://x.test", { fetchImpl: impl });
    expect(out).toBe("<html>hi</html>");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    const impl = vi.fn()
      .mockResolvedValueOnce(res("", false, 503))
      .mockResolvedValueOnce(res("ok"));
    const out = await fetchHtml("https://x.test", { fetchImpl: impl, retries: 2, baseDelayMs: 0 });
    expect(out).toBe("ok");
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const impl = vi.fn().mockResolvedValue(res("", false, 500));
    await expect(fetchHtml("https://x.test", { fetchImpl: impl, retries: 2, baseDelayMs: 0 }))
      .rejects.toThrow(/failed/i);
    expect(impl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
