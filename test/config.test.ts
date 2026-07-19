import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('loads the repo config.json by default', () => {
    const config = loadConfig()
    expect(config.subreddits.length).toBeGreaterThan(0)
    expect(config.weights.crossSource).toBe(0.4)
    expect(config.windowDays).toBe(7)
  })

  it('rejects configs whose weights do not sum to 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    const bad = join(dir, 'config.json')
    writeFileSync(bad, JSON.stringify({
      subreddits: ['SaaS'],
      weights: { crossSource: 0.9, momentum: 0.3, acceleration: 0.2, novelty: 0.1 },
      windowDays: 7,
      minSnapshotDaysForVelocity: 2,
      topN: 30,
    }))
    expect(() => loadConfig(bad)).toThrow(/sum to 1/)
  })
})
