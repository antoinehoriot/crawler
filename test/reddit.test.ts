import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRedditTop, parseRedditAbout, makeRedditCollector } from '../src/collectors/reddit.js'

const top = JSON.parse(readFileSync('test/fixtures/reddit-top.json', 'utf8'))
const about = JSON.parse(readFileSync('test/fixtures/reddit-about.json', 'utf8'))
const AT = '2026-07-19T04:00:00.000Z'

describe('parseRedditTop', () => {
  it('maps posts to post-score signals with permalinks', () => {
    const signals = parseRedditTop(top, AT)
    expect(signals).toHaveLength(2)
    expect(signals[1]).toEqual({
      topic: 'My SaaS hit $1k MRR',
      source: 'reddit',
      metric: 'post-score',
      value: 412,
      url: 'https://www.reddit.com/r/SaaS/comments/def/my_saas/',
      capturedAt: AT,
    })
  })

  it('returns [] on malformed payloads', () => {
    expect(parseRedditTop({}, AT)).toEqual([])
    expect(parseRedditTop(null, AT)).toEqual([])
  })
})

describe('parseRedditAbout', () => {
  it('emits one subscribers signal for the subreddit', () => {
    expect(parseRedditAbout(about, 'SaaS', AT)).toEqual([
      {
        topic: 'r/SaaS',
        source: 'reddit',
        metric: 'subscribers',
        value: 123456,
        url: 'https://www.reddit.com/r/SaaS/',
        capturedAt: AT,
      },
    ])
  })

  it('returns [] when subscribers is missing', () => {
    expect(parseRedditAbout({}, 'SaaS', AT)).toEqual([])
  })
})

// live smoke: LIVE=1 npx vitest run test/reddit.test.ts
describe.skipIf(!process.env.LIVE)('reddit live', () => {
  it('collects real signals from one subreddit', async () => {
    const signals = await makeRedditCollector(['SaaS'], 0).collect()
    expect(signals.length).toBeGreaterThan(5)
    expect(signals.some((s) => s.metric === 'subscribers')).toBe(true)
  }, 60_000)
})
