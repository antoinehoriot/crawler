import Database from 'better-sqlite3'
import type { Signal } from './collectors/types.js'

export interface SnapshotRow {
  topic: string
  source: string
  metric: string
  value: number
  url: string | null
  captured_at: string
}

export function normalizeTopic(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ')
}

// No WAL: the DB file is committed to git and must stay a single file.
export class Store {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        topic       TEXT NOT NULL,
        source      TEXT NOT NULL,
        metric      TEXT NOT NULL,
        value       REAL NOT NULL,
        url         TEXT,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_topic ON snapshots(topic, captured_at);
    `)
  }

  insertSignals(signals: Signal[]): number {
    const stmt = this.db.prepare(
      'INSERT INTO snapshots (topic, source, metric, value, url, captured_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertAll = this.db.transaction((sigs: Signal[]) => {
      for (const s of sigs) {
        stmt.run(normalizeTopic(s.topic), s.source, s.metric, s.value, s.url ?? null, s.capturedAt)
      }
    })
    insertAll(signals)
    return signals.length
  }

  getAllSnapshots(): SnapshotRow[] {
    return this.db
      .prepare('SELECT topic, source, metric, value, url, captured_at FROM snapshots ORDER BY captured_at')
      .all() as SnapshotRow[]
  }

  getSourceCountsForDay(day: string): { source: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT source, COUNT(*) as count FROM snapshots
         WHERE captured_at LIKE ? || '%' GROUP BY source ORDER BY source`,
      )
      .all(day) as { source: string; count: number }[]
  }

  countSnapshots(): number {
    return (this.db.prepare('SELECT COUNT(*) as n FROM snapshots').get() as { n: number }).n
  }

  getHistorySpanDays(): number {
    const row = this.db
      .prepare('SELECT MIN(captured_at) as lo, MAX(captured_at) as hi FROM snapshots')
      .get() as { lo: string | null; hi: string | null }
    if (!row.lo || !row.hi) return 0
    return Math.round((new Date(row.hi).getTime() - new Date(row.lo).getTime()) / 86_400_000)
  }

  close(): void {
    this.db.close()
  }
}
