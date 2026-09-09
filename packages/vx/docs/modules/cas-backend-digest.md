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
store's view over the same directory. A write through that view lands a
file with no index row — never a hit, reaped by `vx cache prune` after
the in-flight grace window — so it is a bytes view, not a second save
path. Nothing distributed ships in this repo; a blob store behind this
seam is something a consumer builds on top, and the seam stays only
because it is small, tested, and costs the run path nothing.
