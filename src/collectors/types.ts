export type SourceName = 'google-trends' | 'reddit' | 'hn'

export interface Signal {
  topic: string        // raw topic text; normalized at write time by the store
  source: SourceName
  metric: string       // e.g. 'search-traffic', 'post-score', 'subscribers', 'points'
  value: number
  url?: string         // evidence link for the report
  capturedAt: string   // ISO timestamp
}

export interface Collector {
  name: SourceName
  collect(): Promise<Signal[]>
}
