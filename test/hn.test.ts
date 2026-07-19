import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseHnHits, hnCollector } from '../src/collectors/hn.js'

const fixture = JSON.parse(readFileSync('test/fixtures/hn-front-page.json', 'utf8'))
const AT = '2026-07-19T04:00:00.000Z'

describe('parseHnHits', () => {
  it('maps hits to signals and skips empty titles', () => {
    const signals = parseHnHits(fixture, AT)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toEqual({
      topic: 'Show HN: I built a local-first note app',
      source: 'hn',
      metric: 'points',
      value: 342,
      url: 'https://news.ycombinator.com/item?id=40000001',
      capturedAt: AT,
    })
  })

  it('returns [] on malformed payloads', () => {
    expect(parseHnHits({}, AT)).toEqual([])
    expect(parseHnHits(null, AT)).toEqual([])
  })
})

// live smoke: LIVE=1 npx vitest run test/hn.test.ts
describe.skipIf(!process.env.LIVE)('hn live', () => {
  it('collects real front-page signals', async () => {
    const signals = await hnCollector.collect()
    expect(signals.length).toBeGreaterThan(10)
    expect(signals[0].source).toBe('hn')
  }, 60_000)
})
