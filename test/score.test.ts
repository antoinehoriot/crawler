import { describe, it, expect } from 'vitest'
import { scoreTopics, topicsMatch, significantTokens, type ScoreConfig } from '../src/score.js'
import type { SnapshotRow } from '../src/store.js'

const NOW = new Date('2026-07-19T06:00:00.000Z')
const config: ScoreConfig = {
  weights: { crossSource: 0.4, momentum: 0.3, acceleration: 0.2, novelty: 0.1 },
  windowDays: 7,
  minSnapshotDaysForVelocity: 2,
  topN: 30,
}

function row(topic: string, source: string, value: number, daysAgo: number, metric = 'points'): SnapshotRow {
  const captured = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()
  return { topic, source, metric, value, url: null, captured_at: captured }
}

describe('significantTokens', () => {
  it('drops stopwords and single chars, keeps 2+ char terms', () => {
    expect(significantTokens('Ask HN: is there a tool for AI notes?')).toEqual(new Set(['tool', 'ai', 'notes']))
  })
})

describe('topicsMatch', () => {
  it('matches when half of the smaller token set is shared', () => {
    expect(topicsMatch('acme widget', 'best acme widget tool')).toBe(true)
  })
  it('rejects unrelated topics', () => {
    expect(topicsMatch('acme widget', 'wimbledon final')).toBe(false)
  })
})

describe('scoreTopics', () => {
  it('gives a rising topic momentum 1 and a flat topic momentum 0', () => {
    const rows = [
      row('flat thing', 'hn', 100, 10), row('flat thing', 'hn', 100, 2),
      row('rising thing', 'hn', 50, 10), row('rising thing', 'hn', 100, 2),
    ]
    const scores = scoreTopics(rows, config, NOW)
    const flat = scores.find((s) => s.topic === 'flat thing')!
    const rising = scores.find((s) => s.topic === 'rising thing')!
    expect(rising.momentum).toBe(1)
    expect(flat.momentum).toBe(0)
    expect(rising.score).toBeGreaterThan(flat.score)
    expect(rising.velocityReady).toBe(true)
  })

  it('unions sources across fuzzy-matched topics for the cross-source signal', () => {
    const rows = [
      row('acme widget', 'hn', 100, 1),
      row('best acme widget tool', 'reddit', 50, 1, 'post-score'),
      row('lonely topic', 'hn', 80, 1),
    ]
    const scores = scoreTopics(rows, config, NOW)
    const acme = scores.find((s) => s.topic === 'acme widget')!
    expect(acme.sources).toEqual(['hn', 'reddit'])
    expect(acme.crossSource).toBe(0.5)
    expect(scores.find((s) => s.topic === 'lonely topic')!.crossSource).toBe(0)
  })

  it('marks single-day topics as not velocity-ready and still scores them', () => {
    const rows = [row('brand new', 'hn', 100, 0)]
    const [s] = scoreTopics(rows, config, NOW)
    expect(s.velocityReady).toBe(false)
    // cold-start fallback: max normalized value (1.0) carries the 0.5 velocity mass
    expect(s.score).toBeCloseTo(0 * 0.4 + 1.0 * 0.5 + 1.0 * 0.1)
  })

  it('excludes topics not seen in the current window', () => {
    const rows = [row('old news', 'hn', 100, 12), row('current', 'hn', 100, 1)]
    const topics = scoreTopics(rows, config, NOW).map((s) => s.topic)
    expect(topics).toEqual(['current'])
  })

  it('caps output at topN', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`topic number ${i}`, 'hn', i + 1, 1))
    expect(scoreTopics(rows, config, NOW)).toHaveLength(30)
  })
})
