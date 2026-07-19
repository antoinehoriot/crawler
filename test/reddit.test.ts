import { describe, it, expect, vi, afterEach } from 'vitest'
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

  it('filters posts: keeps valid posts including score 0, skips missing title/permalink/non-numeric score', () => {
    const payload = {
      data: {
        children: [
          { data: { title: 'Valid with zero score', score: 0, permalink: '/r/test/comments/abc/' } },
          { data: { score: 100, permalink: '/r/test/comments/def/' } }, // missing title
          { data: { title: 'Missing permalink', score: 50 } }, // missing permalink
          { data: { title: 'Non-numeric score', score: 'high', permalink: '/r/test/comments/ghi/' } }, // non-numeric score
        ]
      }
    }
    const signals = parseRedditTop(payload, AT)
    expect(signals).toHaveLength(1)
    expect(signals[0].value).toBe(0)
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

describe('makeRedditCollector with OAuth', () => {
  afterEach(() => vi.unstubAllGlobals())

  function jsonRes(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 })
  }

  it('requests a token with Basic auth header and grant_type body', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url === 'https://www.reddit.com/api/v1/access_token') return jsonRes({ access_token: 'tok-123' })
      if (url.includes('/top')) return jsonRes(top)
      if (url.includes('/about')) return jsonRes(about)
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', mock)

    await makeRedditCollector(['SaaS'], 0, { clientId: 'id', clientSecret: 'secret', username: 'antoine' }).collect()

    const tokenCall = calls.find((c) => c.url === 'https://www.reddit.com/api/v1/access_token')
    expect(tokenCall).toBeDefined()
    const headers = tokenCall!.init.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`)
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(headers['User-Agent']).toBe('script:trend-crawler:1.0 (by /u/antoine)')
    expect(tokenCall!.init.method).toBe('POST')
    expect(tokenCall!.init.body).toBe('grant_type=client_credentials')
  })

  it('fetches subreddit data from oauth.reddit.com with a Bearer token', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url === 'https://www.reddit.com/api/v1/access_token') return jsonRes({ access_token: 'tok-123' })
      if (url.includes('/top')) return jsonRes(top)
      if (url.includes('/about')) return jsonRes(about)
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', mock)

    const signals = await makeRedditCollector(['SaaS'], 0, { clientId: 'id', clientSecret: 'secret' }).collect()

    const topCall = calls.find((c) => c.url === 'https://oauth.reddit.com/r/SaaS/top?t=day&limit=25&raw_json=1')
    const aboutCall = calls.find((c) => c.url === 'https://oauth.reddit.com/r/SaaS/about?raw_json=1')
    expect(topCall).toBeDefined()
    expect(aboutCall).toBeDefined()
    expect((topCall!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123')
    expect((aboutCall!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123')
    expect((topCall!.init.headers as Record<string, string>)['User-Agent']).toBe('script:trend-crawler:1.0')
    expect(signals.length).toBeGreaterThan(0)
  })

  it('throws a clear error when the token response has no access_token', async () => {
    const mock = vi.fn(async (url: string) => {
      if (url === 'https://www.reddit.com/api/v1/access_token') return jsonRes({ error: 'invalid_grant' })
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', mock)

    await expect(
      makeRedditCollector(['SaaS'], 0, { clientId: 'id', clientSecret: 'secret' }).collect()
    ).rejects.toThrow(/access_token/i)
  })

  it('without auth, still calls the public www.reddit.com endpoints', async () => {
    const calls: string[] = []
    const mock = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/top.json')) return jsonRes(top)
      if (url.includes('/about.json')) return jsonRes(about)
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', mock)

    await makeRedditCollector(['SaaS'], 0).collect()

    expect(calls).toContain('https://www.reddit.com/r/SaaS/top.json?t=day&limit=25')
    expect(calls).toContain('https://www.reddit.com/r/SaaS/about.json')
    expect(calls.every((u) => !u.includes('oauth.reddit.com') && !u.includes('access_token'))).toBe(true)
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
