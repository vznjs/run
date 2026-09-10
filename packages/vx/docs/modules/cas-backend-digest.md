# `src/cache/cas-backend.ts` + `digest.ts` — pluggable CAS (internal)

## Purpose

`Digest { hash, sizeBytes }` as a first-class content address, and
`CASBackend` separating "where bytes live" from the SQL entries index.

## Status

**Internal, not exported from the package façade, no consumer.** The
type left the façade in 2026-07 and nothing has taken a dependency on
it since: `Cache.save` / `restoreOutputs` read and write the artifacts
directory directly, and `@vzn/vx-reapi` speaks Bazel's CAS over its own
wire without this type. `FsCASBackend` and `MemoryCASBackend` are the
reference implementations; `Cache.contentBackend()` exposes the local
store's view over the same directory. A write through that view lands
`<digest.hash>.tar.zst` with no index row: under a hash no row references
it is an orphan `vx cache prune` reaps after the in-flight grace window;
under a hash a live row references it REPLACES that entry's bytes, and
the next lookup serves them. It is a raw bytes view, not a save path —
nothing in core writes through it, and a consumer that does owns that
risk. Nothing distributed ships in this repo; a blob store behind this
seam is something a consumer builds on top, and the seam stays only
because it is small, tested, and costs the run path nothing.
