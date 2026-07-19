import type { TopicScore } from './score.js'

export interface RunMeta {
  date: string
  sourceCounts: { source: string; count: number }[]
  configuredSources: string[]
  totalSnapshots: number
  historySpanDays: number
  windowDays: number
}

export function generateReport(scores: TopicScore[], meta: RunMeta): string {
  const lines: string[] = []
  lines.push(`# Trend digest — ${meta.date}`)
  lines.push('')

  const warmTarget = 2 * meta.windowDays
  if (meta.historySpanDays < warmTarget) {
    const left = warmTarget - meta.historySpanDays
    lines.push(`> ⚠️ Warming up — velocity signals need ${left} more day${left === 1 ? '' : 's'} of history.`)
    lines.push('> Until then, ranking leans on within-snapshot strength.')
    lines.push('')
  }

  lines.push('| # | Topic | Score | Momentum | Sources | Evidence |')
  lines.push('|---|-------|-------|----------|---------|----------|')
  scores.forEach((s, i) => {
    const momentum = s.velocityReady ? `${Math.round(s.momentum * 100)}%` : '–'
    const links = s.urls.map((u, j) => `[${j + 1}](${u})`).join(' ')
    lines.push(`| ${i + 1} | ${s.topic} | ${s.score.toFixed(2)} | ${momentum} | ${s.sources.join(', ')} | ${links} |`)
  })

  lines.push('')
  lines.push('## Run status')
  lines.push('')
  const countBySource = new Map(meta.sourceCounts.map((c) => [c.source, c.count]))
  for (const source of meta.configuredSources) {
    const n = countBySource.get(source)
    lines.push(n ? `- ${source}: ✅ ${n} signals` : `- ${source}: ❌ no data this run`)
  }
  lines.push(`- total snapshots in DB: ${meta.totalSnapshots}`)
  lines.push('')
  return lines.join('\n')
}
