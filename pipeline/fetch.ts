const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(
  url: string,
  opts: { retries?: number; baseDelayMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const { retries = 3, baseDelayMs = 500, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchImpl(url);
      if (resp.ok) return await resp.text();
      lastErr = new Error(`fetch failed: ${resp.status} for ${url}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
  }
  throw new Error(`fetchHtml failed for ${url}: ${String(lastErr)}`);
}
