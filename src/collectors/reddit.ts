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
      const token = auth ? await fetchAccessToken(auth) : undefined
      const headers = token
        ? { Authorization: `Bearer ${token}`, 'User-Agent': redditUserAgent(auth) }
        : undefined
      const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com'
      for (const sub of subreddits) {
        const topUrl = token
          ? `${base}/r/${sub}/top?t=day&limit=25&raw_json=1`
          : `${base}/r/${sub}/top.json?t=day&limit=25`
        const topRes = await fetchWithRetry(topUrl, headers ? { headers } : undefined)
        signals.push(...parseRedditTop(await topRes.json(), capturedAt))
        await sleep(delayMs)
        const aboutUrl = token ? `${base}/r/${sub}/about?raw_json=1` : `${base}/r/${sub}/about.json`
        const aboutRes = await fetchWithRetry(aboutUrl, headers ? { headers } : undefined)
        signals.push(...parseRedditAbout(await aboutRes.json(), sub, capturedAt))
        await sleep(delayMs)
      }
      return signals
    },
  }
}
