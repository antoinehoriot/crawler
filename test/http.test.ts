import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithRetry } from '../src/http.js'

afterEach(() => vi.unstubAllGlobals())

function res(status: number): Response {
  return new Response('body', { status })
}

describe('fetchWithRetry', () => {
  it('returns the response on first success and sends the User-Agent', async () => {
    const mock = vi.fn().mockResolvedValue(res(200))
    vi.stubGlobal('fetch', mock)
    const r = await fetchWithRetry('https://example.com')
    expect(r.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
    const init = mock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('trend-crawler')
  })

  it('retries on 500 then succeeds', async () => {
    const mock = vi.fn().mockResolvedValueOnce(res(500)).mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', mock)
    const r = await fetchWithRetry('https://example.com', { backoffMs: 1 })
    expect(r.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('retries on network error then succeeds', async () => {
    const mock = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', mock)
    const r = await fetchWithRetry('https://example.com', { backoffMs: 1 })
    expect(r.status).toBe(200)
  })

  it('fails fast on 404 without retrying', async () => {
    const mock = vi.fn().mockResolvedValue(res(404))
    vi.stubGlobal('fetch', mock)
    await expect(fetchWithRetry('https://example.com', { backoffMs: 1 })).rejects.toThrow('404')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('gives up after 3 attempts on persistent 500', async () => {
    const mock = vi.fn().mockResolvedValue(res(500))
    vi.stubGlobal('fetch', mock)
    await expect(fetchWithRetry('https://example.com', { backoffMs: 1 })).rejects.toThrow('500')
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it('passes method and body through to fetch', async () => {
    const mock = vi.fn().mockResolvedValue(res(200))
    vi.stubGlobal('fetch', mock)
    await fetchWithRetry('https://example.com/token', {
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: { Authorization: 'Basic abc123' },
    })
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('grant_type=client_credentials')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Basic abc123')
  })
})
