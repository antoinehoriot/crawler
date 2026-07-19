import { XMLParser } from 'fast-xml-parser'
import { fetchWithRetry } from '../http.js'
import type { Collector, Signal } from './types.js'

interface RedditPost {
  title?: string
  score?: number
  permalink?: string
}

export function parseRedditTop(json: unknown, capturedAt: string): Signal[] {
  const children = (json as { data?: { children?: { data?: RedditPost }[] } } | null)?.data?.children
  if (!Array.isArray(children)) return []
  return children
    .map((c) => c.data)
    .filter((d): d is Required<RedditPost> => !!d?.title && typeof d.score === 'number' && !!d.permalink)
    .map((d) => ({
      topic: d.title,
      source: 'reddit' as const,
      metric: 'post-score',
      value: d.score,
      url: `https://www.reddit.com${d.permalink}`,
      capturedAt,
    }))
}

export function parseRedditAbout(json: unknown, sub: string, capturedAt: string): Signal[] {
  const subscribers = (json as { data?: { subscribers?: number } } | null)?.data?.subscribers
  if (typeof subscribers !== 'number') return []
  return [
    {
      topic: `r/${sub}`,
      source: 'reddit',
      metric: 'subscribers',
      value: subscribers,
      url: `https://www.reddit.com/r/${sub}/`,
      capturedAt,
    },
  ]
}

// RSS/Atom fallback tier: no OAuth token required, but no scores/subscribers either.
// Reddit's ".rss" feed is Atom, not RSS 2.0 -- entries, not items.
export function parseRedditRss(xml: string, capturedAt: string): Signal[] {
  let doc: unknown
  try {
    doc = new XMLParser({ ignoreAttributes: false }).parse(xml)
  } catch {
    return []
  }
  let entries = (doc as { feed?: { entry?: unknown } } | null)?.feed?.entry ?? []
  if (!Array.isArray(entries)) entries = [entries]
  return (entries as unknown[])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && 'title' in e)
    .map((e, index) => {
      const link = e.link as { '@_href'?: unknown } | undefined
      return {
        topic: String(e.title),
        source: 'reddit' as const,
        metric: 'feed-rank',
        value: Math.max(25 - index, 1),
        url: typeof link?.['@_href'] === 'string' ? link['@_href'] : undefined,
        capturedAt,
      }
    })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RedditAuth {
  clientId: string
  clientSecret: string
  username?: string
}

function redditUserAgent(auth?: RedditAuth): string {
  return auth?.username ? `script:trend-crawler:1.0 (by /u/${auth.username})` : 'script:trend-crawler:1.0'
}

async function fetchAccessToken(auth: RedditAuth): Promise<string> {
  const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64')
  const res = await fetchWithRetry('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(auth),
    },
  })
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('reddit OAuth: token response missing access_token')
  return json.access_token
}

export function makeRedditCollector(subreddits: string[], delayMs = 1000, auth?: RedditAuth): Collector {
  return {
    name: 'reddit',
    async collect() {
      const capturedAt = new Date().toISOString()
      const signals: Signal[] = []

      if (auth) {
        // OAuth path: byte-identical to prior behavior.
        const token = await fetchAccessToken(auth)
        const headers = { Authorization: `Bearer ${token}`, 'User-Agent': redditUserAgent(auth) }
        const base = 'https://oauth.reddit.com'
        for (const sub of subreddits) {
          const topUrl = `${base}/r/${sub}/top?t=day&limit=25&raw_json=1`
          const topRes = await fetchWithRetry(topUrl, { headers })
          signals.push(...parseRedditTop(await topRes.json(), capturedAt))
          await sleep(delayMs)
          const aboutUrl = `${base}/r/${sub}/about?raw_json=1`
          const aboutRes = await fetchWithRetry(aboutUrl, { headers })
          signals.push(...parseRedditAbout(await aboutRes.json(), sub, capturedAt))
          await sleep(delayMs)
        }
        return signals
      }

      // No auth: RSS tier first (200s from residential+datacenter IPs), falling back
      // to the public JSON endpoints (which 403 unauthenticated but are cheap to try).
      // Per-subreddit isolation: one sub's total failure must not abort the others.
      let lastErr: unknown
      let anyError = false
      for (const sub of subreddits) {
        try {
          let subSignals: Signal[]
          try {
            const rssUrl = `https://www.reddit.com/r/${sub}/top/.rss?t=day`
            const rssRes = await fetchWithRetry(rssUrl)
            subSignals = parseRedditRss(await rssRes.text(), capturedAt)
          } catch (rssErr) {
            lastErr = rssErr
            const topUrl = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`
            const topRes = await fetchWithRetry(topUrl)
            subSignals = parseRedditTop(await topRes.json(), capturedAt)
          }
          signals.push(...subSignals)
          await sleep(delayMs)

          try {
            const aboutUrl = `https://www.reddit.com/r/${sub}/about.json`
            const aboutRes = await fetchWithRetry(aboutUrl)
            signals.push(...parseRedditAbout(await aboutRes.json(), sub, capturedAt))
          } catch {
            // about.json fails fast (403) without OAuth; ignore, no subscriber signal.
          }
          await sleep(delayMs)
        } catch (err) {
          lastErr = err
          anyError = true
        }
      }

      if (signals.length === 0 && anyError) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
        throw new Error(`reddit: all subreddits failed (RSS and public JSON), last error: ${msg}`)
      }
      return signals
    },
  }
}
