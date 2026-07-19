import { mkdirSync, writeFileSync } from 'node:fs'
import { loadConfig, type Config } from './config.js'
import { Store } from './store.js'
import { scoreTopics } from './score.js'
import { generateReport } from './report.js'
import { hnCollector } from './collectors/hn.js'
import { makeRedditCollector } from './collectors/reddit.js'
import { googleTrendsCollector } from './collectors/googleTrends.js'
import type { Collector } from './collectors/types.js'

const CONFIGURED_SOURCES = ['google-trends', 'hn', 'reddit']

async function collect(store: Store, config: Config): Promise<number> {
  const collectors: Collector[] = [
    googleTrendsCollector,
    hnCollector,
    makeRedditCollector(config.subreddits),
  ]
  let succeeded = 0
  for (const c of collectors) {
    try {
      const signals = await c.collect()
      store.insertSignals(signals)
      console.log(`[collect] ${c.name}: ${signals.length} signals`)
      succeeded++
    } catch (err) {
      console.error(`[collect] ${c.name} FAILED: ${err instanceof Error ? err.message : err}`)
    }
  }
  return succeeded
}

function report(store: Store, config: Config): void {
  const today = new Date().toISOString().slice(0, 10)
  const scores = scoreTopics(store.getAllSnapshots(), config, new Date())
  const md = generateReport(scores, {
    date: today,
    sourceCounts: store.getSourceCountsForDay(today),
    configuredSources: CONFIGURED_SOURCES,
    totalSnapshots: store.countSnapshots(),
    historySpanDays: store.getHistorySpanDays(),
    windowDays: config.windowDays,
  })
  mkdirSync('reports', { recursive: true })
  const path = `reports/${today}.md`
  writeFileSync(path, md)
  console.log(`[report] wrote ${path} (${scores.length} topics)`)
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'run'
  if (!['collect', 'report', 'run'].includes(cmd)) {
    console.error(`usage: tsx src/index.ts <collect|report|run>`)
    process.exit(2)
  }
  const config = loadConfig()
  mkdirSync('data', { recursive: true })
  const store = new Store('data/trends.db')
  let collectOk = true
  if (cmd === 'collect' || cmd === 'run') collectOk = (await collect(store, config)) > 0
  if (cmd === 'report' || cmd === 'run') report(store, config)
  store.close()
  if (!collectOk) {
    console.error('[collect] all collectors failed')
    process.exit(1)
  }
}

main()
