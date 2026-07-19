import { fetchWithRetry } from '../http.js'
import type { Collector, Signal } from './types.js'

const API = 'https://hn.algolia.com/api/v1'

interface HnHit {
  title?: string
  points?: number
  objectID?: string
}

export function parseHnHits(json: unknown, capturedAt: string): Signal[] {
  const hits = (json as { hits?: HnHit[] } | null)?.hits
  if (!Array.isArray(hits)) return []
  return hits
    .filter((h) => h.title && typeof h.points === 'number' && h.objectID)
    .map((h) => ({
      topic: h.title!,
      source: 'hn' as const,
      metric: 'points',
      value: h.points!,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      capturedAt,
    }))
}

export const hnCollector: Collector = {
  name: 'hn',
  async collect() {
    const capturedAt = new Date().toISOString()
    const queries = [
      'search?tags=front_page&hitsPerPage=30',
      'search_by_date?tags=ask_hn&numericFilters=points>5&hitsPerPage=30',
    ]
    const signals: Signal[] = []
    for (const q of queries) {
      const res = await fetchWithRetry(`${API}/${q}`)
      signals.push(...parseHnHits(await res.json(), capturedAt))
    }
    return signals
  },
}
