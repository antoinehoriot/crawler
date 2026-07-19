import { readFileSync } from 'node:fs'
import type { ScoreConfig } from './score.js'

export interface Config extends ScoreConfig {
  subreddits: string[]
}

export function loadConfig(path = 'config.json'): Config {
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config
  const sum = config.weights.crossSource + config.weights.momentum
    + config.weights.acceleration + config.weights.novelty
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`config weights must sum to 1, got ${sum}`)
  if (!Array.isArray(config.subreddits) || config.subreddits.length === 0) {
    throw new Error('config.subreddits must be a non-empty array')
  }
  return config
}
