const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(
  url: string,
  opts: { retries?: number; baseDelayMs?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const { retries = 3, baseDelayMs = 500, timeoutMs = 30_000, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Without this, a stalled response falls back to undici's 300s
      // headers/body timeouts — one bad URL can hold a concurrency slot for
      // ~20 minutes across retries.
      const resp = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (resp.ok) return await resp.text();
      lastErr = new Error(`fetch failed: ${resp.status} for ${url}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
  }
  throw new Error(`fetchHtml failed for ${url}: ${String(lastErr)}`);
}
