// The weighted shard dealer (scripts/test-shard.ts): every core test file
// lands in exactly one shard, the deal is deterministic, and the recorded
// weights name files that exist — a renamed file must take its weight
// with it, or it silently falls to the median.

import { describe, expect, it } from 'bun:test'
import { partition, readWeights, testFiles } from '../scripts/test-shard.js'
import { SHARD_COUNT } from '../vx.config.js'

describe('weighted test shards', () => {
  const files = testFiles()
  const weights = readWeights()

  it('deals every non-unsafe test file exactly once across the configured shards', () => {
    const bins = partition(files, weights, SHARD_COUNT)
    expect(bins).toHaveLength(SHARD_COUNT)
    expect(bins.flat().sort()).toEqual([...files].sort())
    for (const bin of bins) expect(bin.length).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(partition(files, weights, SHARD_COUNT)).toEqual(partition(files, weights, SHARD_COUNT))
  })

  it('balances the recorded load: heaviest shard within 1.25× of the lightest', () => {
    const known = Object.values(weights).sort((a, b) => a - b)
    const median = known[known.length >> 1]!
    const loads = partition(files, weights, SHARD_COUNT).map((bin) =>
      bin.reduce((s, f) => s + (weights[f] ?? median), 0),
    )
    expect(Math.max(...loads)).toBeLessThanOrEqual(Math.min(...loads) * 1.25)
  })

  it('names only files that exist — a rename carries its weight', () => {
    const stale = Object.keys(weights).filter((f) => !files.includes(f))
    expect(stale).toEqual([])
  })

  it('a file the table does not know gets the median, not zero', () => {
    const bins = partition(['a.test.ts', 'b.test.ts', 'c.test.ts'], { 'b.test.ts': 100 }, 2)
    // With b=100 and a,c at the median (100), LPT lands two on one side and one on the other.
    expect(bins.map((b) => b.length).sort((x, y) => x - y)).toEqual([1, 2])
  })
})
