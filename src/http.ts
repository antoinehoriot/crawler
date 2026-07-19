const USER_AGENT = 'trend-crawler/1.0 (personal research tool)'

export interface FetchOpts {
  retries?: number
  timeoutMs?: number
  backoffMs?: number
  headers?: Record<string, string>
  method?: string
  body?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 10_000, backoffMs = 1000, headers = {}, method, body } = opts
  let lastErr: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1))
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        ...(method !== undefined ? { method } : {}),
        ...(body !== undefined ? { body } : {}),
      })
      if (res.ok) return res
      const err = new Error(`HTTP ${res.status} for ${url}`)
      // 4xx (except 429) will not get better on retry
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err
      lastErr = err
    } catch (err) {
      if (err instanceof Error && /^HTTP 4\d\d/.test(err.message) && !err.message.startsWith('HTTP 429')) throw err
      lastErr = err
    }
  }
  throw lastErr
}
