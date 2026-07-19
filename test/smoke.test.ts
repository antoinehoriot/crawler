import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('scaffold', () => {
  it('config.json has weights summing to 1', () => {
    const config = JSON.parse(readFileSync('config.json', 'utf8'))
    const sum = Object.values(config.weights as Record<string, number>).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0)
  })
})
