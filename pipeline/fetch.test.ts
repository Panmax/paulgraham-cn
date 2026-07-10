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

  it("passes an abort signal so a stalled response cannot hold a slot", async () => {
    const impl = vi.fn().mockResolvedValue(res("ok"));
    await fetchHtml("https://x.test", { fetchImpl: impl });
    expect(impl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a request that outlives timeoutMs, then retries", async () => {
    // Rejects only when the signal fetchHtml supplied actually fires.
    const stall = (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    });
    const impl = vi.fn().mockImplementationOnce(stall).mockResolvedValueOnce(res("ok"));
    const out = await fetchHtml("https://x.test", { fetchImpl: impl, timeoutMs: 10, retries: 1, baseDelayMs: 0 });
    expect(out).toBe("ok");
    expect(impl).toHaveBeenCalledTimes(2);
  });
});
