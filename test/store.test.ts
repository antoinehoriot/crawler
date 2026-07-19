import { describe, it, expect } from 'vitest'
import { Store, normalizeTopic } from '../src/store.js'
import type { Signal } from '../src/collectors/types.js'

function sig(partial: Partial<Signal>): Signal {
  return {
    topic: 'Some Topic',
    source: 'hn',
    metric: 'points',
    value: 10,
    capturedAt: '2026-07-19T04:00:00.000Z',
    ...partial,
  }
}

describe('normalizeTopic', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalizeTopic('  Hello   World ')).toBe('hello world')
  })
})

describe('Store', () => {
  it('inserts signals and reads them back normalized', () => {
    const store = new Store(':memory:')
    const n = store.insertSignals([sig({ topic: '  Rising   Topic ' }), sig({ url: 'https://x.test' })])
    expect(n).toBe(2)
    const rows = store.getAllSnapshots()
    expect(rows).toHaveLength(2)
    expect(rows[0].topic).toBe('rising topic')
    expect(rows[0].url).toBeNull()
    expect(rows[1].url).toBe('https://x.test')
    store.close()
  })

  it('counts source signals for a given day', () => {
    const store = new Store(':memory:')
    store.insertSignals([
      sig({ source: 'hn', capturedAt: '2026-07-19T04:00:00.000Z' }),
      sig({ source: 'hn', capturedAt: '2026-07-19T05:00:00.000Z' }),
      sig({ source: 'reddit', capturedAt: '2026-07-18T04:00:00.000Z' }),
    ])
    expect(store.getSourceCountsForDay('2026-07-19')).toEqual([{ source: 'hn', count: 2 }])
    store.close()
  })

  it('reports history span in days', () => {
    const store = new Store(':memory:')
    expect(store.getHistorySpanDays()).toBe(0)
    store.insertSignals([
      sig({ capturedAt: '2026-07-10T04:00:00.000Z' }),
      sig({ capturedAt: '2026-07-19T04:00:00.000Z' }),
    ])
    expect(store.getHistorySpanDays()).toBe(9)
    expect(store.countSnapshots()).toBe(2)
    store.close()
  })
})
