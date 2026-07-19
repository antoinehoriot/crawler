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

export function makeRedditCollector(subreddits: string[], delayMs = 1000): Collector {
  return {
    name: 'reddit',
    async collect() {
      const capturedAt = new Date().toISOString()
      const signals: Signal[] = []
      for (const sub of subreddits) {
        const topRes = await fetchWithRetry(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`)
        signals.push(...parseRedditTop(await topRes.json(), capturedAt))
        await sleep(delayMs)
        const aboutRes = await fetchWithRetry(`https://www.reddit.com/r/${sub}/about.json`)
        signals.push(...parseRedditAbout(await aboutRes.json(), sub, capturedAt))
        await sleep(delayMs)
      }
      return signals
    },
  }
}
