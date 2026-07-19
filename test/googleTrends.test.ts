import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseTrendsRss, googleTrendsCollector } from '../src/collectors/googleTrends.js'

const xml = readFileSync('test/fixtures/trends-rss.xml', 'utf8')
const AT = '2026-07-19T04:00:00.000Z'

describe('parseTrendsRss', () => {
  it('maps RSS items to search-traffic signals, parsing "1,000+" as 1000', () => {
    const signals = parseTrendsRss(xml, AT)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toEqual({
      topic: 'small language models',
      source: 'google-trends',
      metric: 'search-traffic',
      value: 200,
      url: 'https://trends.google.com/trending?geo=US',
      capturedAt: AT,
    })
    expect(signals[1].value).toBe(1000)
  })

  it('defaults traffic to 1 when the tag is missing', () => {
    const noTraffic = xml.replace(/<ht:approx_traffic>.*?<\/ht:approx_traffic>/gs, '')
    expect(parseTrendsRss(noTraffic, AT).every((s) => s.value === 1)).toBe(true)
  })

  it('returns [] on non-RSS input', () => {
    expect(parseTrendsRss('<html>not rss</html>', AT)).toEqual([])
  })
})

// live smoke: LIVE=1 npx vitest run test/googleTrends.test.ts
describe.skipIf(!process.env.LIVE)('google trends live', () => {
  it('collects real trending searches', async () => {
    const signals = await googleTrendsCollector.collect()
    expect(signals.length).toBeGreaterThan(3)
    expect(signals[0].source).toBe('google-trends')
  }, 60_000)
})
