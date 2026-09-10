// CASBackend — a content-addressed view of where artifact bytes live,
// separate from the SQL index that knows what they are.
//
// Two reference implementations:
//   - MemoryCASBackend — holds raw bytes; tests and ephemeral runs.
//   - FsCASBackend     — one `<hash>.tar.zst` per digest in a directory,
//                        written temp-then-rename like `Cache.save`; the
//                        read path streams through Bun.file.
//
// Status: module-internal, no consumer. `Cache.save` and `restoreOutputs`
// write and read the artifacts directory directly and are not routed
// through this type; `Cache.contentBackend()` hands out an `FsCASBackend`
// over the same directory for code that wants a digest-keyed view of it.
// Nothing distributed ships in this repo, so a blob store behind this
// seam is something built on top, not a plan here.

import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Digest } from './digest.js'

/** Per-process counter for put() temp names; uniqueness only. */
let casTmpSeq = 0

export interface CASBackend {
  /** Write bytes under `digest`. Idempotent — putting the same digest twice is a no-op. */
  put(digest: Digest, bytes: Uint8Array): Promise<void>
  /** Read bytes under `digest`, or null if absent. */
  get(digest: Digest): Promise<Uint8Array | null>
  /** Cheap existence probe — no bytes round-tripped if possible. */
  has(digest: Digest): Promise<boolean>
  /** Drop one entry (eviction). No-op if absent. */
  remove(digest: Digest): Promise<void>
}

/** In-memory backend, useful for tests and ephemeral runs. */
export class MemoryCASBackend implements CASBackend {
  private readonly store = new Map<string, Uint8Array>()

  async put(digest: Digest, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength !== digest.sizeBytes) {
      throw new Error(
        `MemoryCASBackend.put: sizeBytes mismatch (digest=${digest.sizeBytes}, actual=${bytes.byteLength})`,
      )
    }
    this.store.set(digest.hash, bytes)
  }

  async get(digest: Digest): Promise<Uint8Array | null> {
    return this.store.get(digest.hash) ?? null
  }

  async has(digest: Digest): Promise<boolean> {
    return this.store.has(digest.hash)
  }

  async remove(digest: Digest): Promise<void> {
    this.store.delete(digest.hash)
  }

  /** Test-only: how many entries are held. */
  size(): number {
    return this.store.size
  }
}

/** Filesystem-backed backend writing `<rootDir>/<hash>.tar.zst` files. */
export class FsCASBackend implements CASBackend {
  constructor(private readonly rootDir: string) {}

  private pathFor(digest: Digest): string {
    return path.join(this.rootDir, `${digest.hash}.tar.zst`)
  }

  async put(digest: Digest, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength !== digest.sizeBytes) {
      throw new Error(
        `FsCASBackend.put: sizeBytes mismatch (digest=${digest.sizeBytes}, actual=${bytes.byteLength})`,
      )
    }
    // Temp + rename, the same shape `Cache.writeArtifactAndIndex` and the
    // archive extractor use: two writers of the SAME content-addressed
    // blob are expected (that is what content-addressing invites), and a
    // plain write lets a reader observe a half-written file under a name
    // that promises complete bytes. rename(2) is atomic, so a concurrent
    // reader sees either the old file or the whole new one.
    const final = this.pathFor(digest)
    const tmp = `${final}.tmp-${process.pid.toString(36)}-${(casTmpSeq++).toString(36)}`
    await mkdir(this.rootDir, { recursive: true })
    try {
      await Bun.write(tmp, bytes)
      await rename(tmp, final)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  }

  async get(digest: Digest): Promise<Uint8Array | null> {
    const file = Bun.file(this.pathFor(digest))
    if (!(await file.exists())) return null
    return new Uint8Array(await file.arrayBuffer())
  }

  async has(digest: Digest): Promise<boolean> {
    return Bun.file(this.pathFor(digest)).exists()
  }

  async remove(digest: Digest): Promise<void> {
    await rm(this.pathFor(digest), { force: true })
  }
}
