import type { SnapshotRow } from './store.js'

export interface ScoreConfig {
  weights: { crossSource: number; momentum: number; acceleration: number; novelty: number }
  windowDays: number
  minSnapshotDaysForVelocity: number
  topN: number
}

export interface TopicScore {
  topic: string
  score: number
  momentum: number
  acceleration: number
  crossSource: number
  novelty: number
  sources: string[]
  urls: string[]
  velocityReady: boolean
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'be',
  'it', 'my', 'your', 'you', 'we', 'us', 'vs', 'at', 'by', 'as', 'do', 'does', 'can', 'not', 'no',
  'how', 'what', 'why', 'when', 'this', 'that', 'there', 'ask', 'show', 'hn',
])

export function significantTokens(topic: string): Set<string> {
  return new Set(
    topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  )
}

function tokensMatch(ta: Set<string>, tb: Set<string>): boolean {
  if (ta.size === 0 || tb.size === 0) return false
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size) >= 0.5
}

export function topicsMatch(a: string, b: string): boolean {
  return tokensMatch(significantTokens(a), significantTokens(b))
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const MS_PER_DAY = 86_400_000

export function scoreTopics(rows: SnapshotRow[], config: ScoreConfig, now: Date): TopicScore[] {
  const W = config.windowDays
  const daysAgo = (iso: string) => (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY

  // normalize values 0-1 per (source, metric) group
  const maxByGroup = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.source}|${r.metric}`
    maxByGroup.set(k, Math.max(maxByGroup.get(k) ?? 0, r.value))
  }
  const norm = (r: SnapshotRow) => {
    const max = maxByGroup.get(`${r.source}|${r.metric}`)!
    return max > 0 ? r.value / max : 0
  }

  const byTopic = new Map<string, SnapshotRow[]>()
  for (const r of rows) {
    const list = byTopic.get(r.topic) ?? []
    list.push(r)
    byTopic.set(r.topic, list)
  }

  const inWindow = (r: SnapshotRow) => daysAgo(r.captured_at) < W
  const recentTopics = [...byTopic.keys()].filter((t) => byTopic.get(t)!.some(inWindow))
  const tokenCache = new Map(recentTopics.map((t) => [t, significantTokens(t)]))

  // mean daily strength over the window starting `startAge` days ago.
  // Same-day duplicates of the same (source, metric) — e.g. two crawler runs in
  // one day, or the same story surfacing from two queries — collapse to their
  // max so a topic isn't inflated just because it was captured more than once.
  // Distinct (source, metric) pairs on the same day still sum (cross-source signal).
  function windowStrength(topicRows: SnapshotRow[], startAge: number): number {
    const byDayGroup = new Map<string, Map<string, number>>()
    for (const r of topicRows) {
      const age = daysAgo(r.captured_at)
      if (age >= startAge && age < startAge + W) {
        const day = r.captured_at.slice(0, 10)
        const groupKey = `${r.source}|${r.metric}`
        let dayMap = byDayGroup.get(day)
        if (!dayMap) {
          dayMap = new Map()
          byDayGroup.set(day, dayMap)
        }
        dayMap.set(groupKey, Math.max(dayMap.get(groupKey) ?? 0, norm(r)))
      }
    }
    let total = 0
    for (const dayMap of byDayGroup.values()) {
      for (const v of dayMap.values()) total += v
    }
    return total / W
  }

  const growth = (recent: number, prior: number) =>
    prior > 0 ? clamp01((recent - prior) / prior) : recent > 0 ? 1 : 0

  // O(n²) over topics in the window — fine at personal-tool scale (~hundreds of topics)
  function crossSourcesOf(topic: string): Set<string> {
    const own = tokenCache.get(topic)!
    const sources = new Set<string>()
    for (const other of recentTopics) {
      if (other === topic || tokensMatch(own, tokenCache.get(other)!)) {
        for (const r of byTopic.get(other)!) if (inWindow(r)) sources.add(r.source)
      }
    }
    return sources
  }

  const scores: TopicScore[] = []
  for (const topic of recentTopics) {
    const trows = byTopic.get(topic)!
    const distinctDays = new Set(trows.map((r) => r.captured_at.slice(0, 10))).size
    const velocityReady = distinctDays >= config.minSnapshotDaysForVelocity

    const s0 = windowStrength(trows, 0)
    const s1 = windowStrength(trows, W)
    const s2 = windowStrength(trows, 2 * W)
    const momentum = growth(s0, s1)
    const acceleration = clamp01(momentum - growth(s1, s2))

    const sourceSet = crossSourcesOf(topic)
    const crossSource = clamp01((sourceSet.size - 1) / 2)

    const firstSeenAge = Math.min(...trows.map((r) => daysAgo(r.captured_at)))
    const novelty = clamp01(1 - firstSeenAge / 30)

    const w = config.weights
    // cold start: without history, within-window strength stands in for velocity
    const strength = Math.max(...trows.filter(inWindow).map(norm))
    const velocityPart = velocityReady
      ? momentum * w.momentum + acceleration * w.acceleration
      : strength * (w.momentum + w.acceleration)

    const score = crossSource * w.crossSource + velocityPart + novelty * w.novelty
    const urls = [...new Set(trows.filter((r) => r.url).map((r) => r.url!))].slice(0, 3)

    scores.push({
      topic, score, momentum, acceleration, crossSource, novelty,
      sources: [...sourceSet].sort(), urls, velocityReady,
    })
  }

  scores.sort((a, b) => b.score - a.score)
  return scores.slice(0, config.topN)
}
