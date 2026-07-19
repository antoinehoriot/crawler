import { describe, it, expect } from 'vitest'
import { generateReport, type RunMeta } from '../src/report.js'
import type { TopicScore } from '../src/score.js'

const score: TopicScore = {
  topic: 'acme widget',
  score: 0.7234,
  momentum: 1,
  acceleration: 0.5,
  crossSource: 0.5,
  novelty: 0.9,
  sources: ['hn', 'reddit'],
  urls: ['https://news.ycombinator.com/item?id=1'],
  velocityReady: true,
}

const meta: RunMeta = {
  date: '2026-07-19',
  sourceCounts: [{ source: 'hn', count: 30 }, { source: 'reddit', count: 120 }],
  configuredSources: ['google-trends', 'hn', 'reddit'],
  totalSnapshots: 150,
  historySpanDays: 3,
  windowDays: 7,
}

describe('generateReport', () => {
  it('renders a ranked table row with score, sources, and link', () => {
    const md = generateReport([score], meta)
    expect(md).toContain('| 1 | acme widget | 0.72 |')
    expect(md).toContain('hn, reddit')
    expect(md).toContain('https://news.ycombinator.com/item?id=1')
  })

  it('shows a warming-up notice while history span < 2 windows', () => {
    const md = generateReport([score], meta)
    expect(md).toContain('Warming up')
    expect(md).toContain('11 more day') // 2*7 - 3
  })

  it('omits the warming-up notice once history is long enough', () => {
    const md = generateReport([score], { ...meta, historySpanDays: 20 })
    expect(md).not.toContain('Warming up')
  })

  it('renders momentum as – for non-velocity-ready topics', () => {
    const md = generateReport([{ ...score, velocityReady: false }], meta)
    expect(md).toContain('| – |')
  })

  it('footer marks sources with no data this run as failed', () => {
    const md = generateReport([score], meta)
    expect(md).toContain('hn: ✅ 30 signals')
    expect(md).toContain('google-trends: ❌ no data this run')
  })

  it('escapes pipes and collapses newlines in topic names', () => {
    const topicWithPipesAndNewlines = 'c | c++ pipes\nand newlines'
    const md = generateReport([{ ...score, topic: topicWithPipesAndNewlines }], meta)
    // Check that pipes are escaped
    expect(md).toContain('c \\| c++')
    // Check that newlines are collapsed to spaces
    expect(md).toContain('pipes and newlines')
    // Check that the row doesn't contain raw newlines (which would break the table)
    const tableLines = md.split('\n')
    const contentRow = tableLines.find(line => line.includes('c \\| c++'))
    expect(contentRow).toBeDefined()
    // Ensure the content row is a single line (no embedded newlines)
    expect(contentRow).not.toContain('\n')
  })
})
