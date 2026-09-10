// `Cache.hashFiles` is `hashFile` over a list with one memo query. It must
// agree with the per-file form byte for byte, reuse the memo the per-file
// form wrote (and vice versa), see through a rewrite, and leave a missing
// path out rather than throwing the batch.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Cache, FILE_HASH_RACY_MS } from '../src/cache/index.js'

let dir: string
let cache: Cache
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vx-hash-files-'))
  cache = new Cache(path.join(dir, 'cache'), { read: true, write: true })
})
afterEach(async () => {
  cache.close()
  await rm(dir, { recursive: true, force: true })
})

/**
 * Write, then wait out the racy-clean window so the digest is memoised.
 * `utimes` cannot do this: it moves mtime but stamps ctime with now, and
 * ctime is the field the window reads.
 */
async function aged(file: string, content: string): Promise<void> {
  await writeFile(file, content)
  await Bun.sleep(FILE_HASH_RACY_MS + 10)
}

describe('Cache.hashFiles', () => {
  it('agrees with hashFile, memoises, and omits a path it cannot stat', async () => {
    const a = path.join(dir, 'a.txt')
    const b = path.join(dir, 'b.txt')
    await aged(a, 'alpha\n')
    await aged(b, 'beta\n')
    const single = await cache.hashFile(a)
    const batch = await cache.hashFiles([a, b, path.join(dir, 'missing.txt'), a])
    expect(batch.get(a)).toBe(single)
    expect(batch.get(b)).toBe(await cache.hashFile(b))
    expect(batch.has(path.join(dir, 'missing.txt'))).toBe(false)
    expect(batch.size).toBe(2)
    // Both paths are memoised now (b by the batch): a row each.
    const rows = cache
      .dbHandle()
      .query('SELECT path FROM file_hashes ORDER BY path')
      .all() as Array<{ path: string }>
    expect(rows.map((r) => r.path)).toEqual([a, b])
  })

  it('a rewrite is seen — the memo keys on the stat, never on the path alone', async () => {
    const a = path.join(dir, 'a.txt')
    await aged(a, 'one\n')
    const before = (await cache.hashFiles([a])).get(a)
    await aged(a, 'two — a different size\n')
    const after = (await cache.hashFiles([a])).get(a)
    expect(after).not.toBe(before)
    expect(after).toBe(await cache.hashFile(a))
  })

  it('a file changed within the racy window is hashed but not memoised', async () => {
    // The first miss in a store also spawns `git rev-parse` for the object
    // format; pay that on an aged file so the timed part below is only the
    // stat, the digest and the memo query.
    const warm = path.join(dir, 'warm.txt')
    await aged(warm, 'warm\n')
    await cache.hashFiles([warm])
    // The claim holds only while the calls complete inside the window of
    // the write — on a loaded CI runner one attempt can take longer (seen
    // 2026-09-09: 417 ms on ubuntu, the row memoised). The clock decides
    // whether an attempt can judge: assert only when the elapsed time
    // bounds `now - ctime` under the window, else try a fresh file again.
    let judged = false
    for (let attempt = 0; attempt < 20 && !judged; attempt++) {
      const a = path.join(dir, `fresh-${attempt}.txt`)
      const t0 = Date.now()
      await writeFile(a, 'fresh\n')
      const batch = (await cache.hashFiles([a])).get(a)
      const single = await cache.hashFile(a)
      const elapsed = Date.now() - t0
      expect(batch).toBe(single)
      if (elapsed >= FILE_HASH_RACY_MS) continue
      const rows = cache.dbHandle().query('SELECT path FROM file_hashes WHERE path = ?').all(a)
      expect(rows).toEqual([])
      judged = true
    }
    expect(judged).toBe(true)
  })
})
