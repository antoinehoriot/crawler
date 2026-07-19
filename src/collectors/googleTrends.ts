import { XMLParser } from 'fast-xml-parser'
import { fetchWithRetry } from '../http.js'
import type { Collector, Signal } from './types.js'

const RSS_URL = 'https://trends.google.com/trending/rss?geo=US'

function parseTraffic(raw: unknown): number {
  const m = String(raw ?? '').replace(/[,.]/g, '').match(/\d+/)
  return m ? Number(m[0]) : 1
}

export function parseTrendsRss(xml: string, capturedAt: string): Signal[] {
  const doc = new XMLParser().parse(xml)
  let items = doc?.rss?.channel?.item ?? []
  if (!Array.isArray(items)) items = [items]
  return items
    .filter((it: unknown): it is Record<string, unknown> => !!it && typeof it === 'object' && 'title' in it)
    .map((it: Record<string, unknown>) => ({
      topic: String(it.title),
      source: 'google-trends' as const,
      metric: 'search-traffic',
      value: parseTraffic(it['ht:approx_traffic']),
      url: typeof it.link === 'string' ? it.link : undefined,
      capturedAt,
    }))
}

export const googleTrendsCollector: Collector = {
  name: 'google-trends',
  async collect() {
    const capturedAt = new Date().toISOString()
    const res = await fetchWithRetry(RSS_URL)
    return parseTrendsRss(await res.text(), capturedAt)
  },
}
