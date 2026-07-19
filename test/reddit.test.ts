import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRedditTop, parseRedditAbout, parseRedditRss, makeRedditCollector } from '../src/collectors/reddit.js'

const top = JSON.parse(readFileSync('test/fixtures/reddit-top.json', 'utf8'))
const about = JSON.parse(readFileSync('test/fixtures/reddit-about.json', 'utf8'))
const rssAtom = readFileSync('test/fixtures/reddit-top.atom.xml', 'utf8')
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

describe('parseRedditRss', () => {
  it('maps Atom entries to feed-rank signals, top of feed strongest', () => {
    const signals = parseRedditRss(rssAtom, AT)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toEqual({
      topic: 'My SaaS hit $1k MRR',
      source: 'reddit',
      metric: 'feed-rank',
      value: 25,
      url: 'https://www.reddit.com/r/SaaS/comments/def/my_saas/',
      capturedAt: AT,
    })
    expect(signals[1]).toEqual({
      topic: 'Is there a tool for tracking niche trends?',
      source: 'reddit',
      metric: 'feed-rank',
      value: 24,
      url: 'https://www.reddit.com/r/SaaS/comments/abc/is_there_a_tool/',
      capturedAt: AT,
    })
  })

  it('handles single-entry feeds (non-array parsing)', () => {
    const soloAtom = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>solo reddit post</title>
          <link href="https://www.reddit.com/r/SaaS/comments/xyz/solo/" />
        </entry>
      </feed>
    `
    const signals = parseRedditRss(soloAtom, AT)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toEqual({
      topic: 'solo reddit post',
      source: 'reddit',
      metric: 'feed-rank',
      value: 25,
      url: 'https://www.reddit.com/r/SaaS/comments/xyz/solo/',
      capturedAt: AT,
    })
  })

  it('returns [] on garbage/non-Atom input', () => {
    expect(parseRedditRss('not xml at all', AT)).toEqual([])
    expect(parseRedditRss('<html><body>nope</body></html>', AT)).toEqual([])
  })

  it('skips entries without a title', () => {
    const noTitleAtom = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link href="https://www.reddit.com/r/SaaS/comments/xyz/notitle/" />
        </entry>
        <entry>
          <title>has a title</title>
          <link href="https://www.reddit.com/r/SaaS/comments/xyz/hastitle/" />
        </entry>
      </feed>
    `
    const signals = parseRedditRss(noTitleAtom, AT)
    expect(signals).toHaveLength(1)
    expect(signals[0].topic).toBe('has a title')
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
      if (url.includes('.rss')) return new Response('', { status: 403 })
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

describe('makeRedditCollector without auth: RSS/public three-tier fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  function jsonRes(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 })
  }

  it('uses RSS when it succeeds, and does not call public top.json for that sub', async () => {
    const calls: string[] = []
    const mock = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('.rss')) return new Response(rssAtom, { status: 200 })
      if (url.includes('/about.json')) return jsonRes(about)
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', mock)

    const signals = await makeRedditCollector(['SaaS'], 0).collect()

    expect(signals.some((s) => s.metric === 'feed-rank')).toBe(true)
    expect(calls.some((u) => u.includes('.rss'))).toBe(true)
    expect(calls.some((u) => u.includes('/top.json'))).toBe(false)
  })

  it('falls back to public top.json when RSS is 429-exhausted', async () => {
    vi.useFakeTimers()
    try {
      let rssCalls = 0
      const mock = vi.fn(async (url: string) => {
        if (url.includes('.rss')) {
          rssCalls++
          return new Response('', { status: 429 })
        }
        if (url.includes('/top.json')) return jsonRes(top)
        if (url.includes('/about.json')) return jsonRes(about)
        throw new Error(`unexpected url ${url}`)
      })
      vi.stubGlobal('fetch', mock)

      const promise = makeRedditCollector(['SaaS'], 0).collect()
      await vi.runAllTimersAsync()
      const signals = await promise

      expect(rssCalls).toBe(3) // fetchWithRetry default retries, all 429
      expect(signals.some((s) => s.metric === 'post-score')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('isolates a fully-failing subreddit: partial signals returned, no throw', async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.includes('/r/Bad/')) return new Response('', { status: 403 })
      if (url.includes('/r/Good/') && url.includes('.rss')) return new Response(rssAtom, { status: 200 })
      if (url.includes('/r/Good/') && url.includes('/about.json')) return jsonRes(about)
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', mock)

    const signals = await makeRedditCollector(['Bad', 'Good'], 0).collect()

    expect(signals.length).toBeGreaterThan(0)
    expect(signals.some((s) => s.metric === 'feed-rank')).toBe(true)
  })

  it('throws naming the last error when every subreddit fails', async () => {
    const mock = vi.fn(async () => new Response('', { status: 403 }))
    vi.stubGlobal('fetch', mock)

    await expect(makeRedditCollector(['Bad1', 'Bad2'], 0).collect()).rejects.toThrow(/403/)
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
