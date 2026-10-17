const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// paulgraham.com serves windows-1252 bytes with no charset in the Content-Type
// and no <meta charset> in the page, so `resp.text()` — which assumes UTF-8 —
// turns every curly quote and em dash into U+FFFD. Browsers fall back to
// windows-1252 in exactly this situation; decode the same way.
export function decodeHtml(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

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
      if (resp.ok) return decodeHtml(await resp.arrayBuffer());
      lastErr = new Error(`fetch failed: ${resp.status} for ${url}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
  }
  throw new Error(`fetchHtml failed for ${url}: ${String(lastErr)}`);
}
