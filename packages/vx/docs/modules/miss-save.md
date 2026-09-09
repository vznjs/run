# `src/orchestrator/miss-save.ts` — what a miss leaves behind

## Purpose

Once a cached task's command exited 0 and the task will save, one call
does everything a later hit depends on: resolve the declared outputs,
say so if they matched nothing, save the artifact with its output rows
and input-fingerprint rows in one transaction, record the whole-subtree
output prefixes the next hit's skip-restore reads, and mark the exact
written paths against the git snapshot so a same-project consumer
re-spawns git only when its globs can see them. Moved out of
`execute-task.ts` on 2026-09-09 as pure code motion.

**Stale-hit-critical.** A line changed here changes what a later run
replays under a green result; treat edits like `execute-task.ts` ones.

## Public surface

```ts
export interface SaveMissArgs {
  node: TaskNode
  hash: string
  cache: CacheLayer
  log: Logger
  workspaceRoot: string
  nestedProjectDirs: string[]
  gitFilesCache?: GitFilesCache
  outputs: string[] // declared cache.outputs.files
  wsOutputs: string[] // declared cache.outputs.workspaceFiles
  captured: readonly TaskInputComponent[] // Tier-3 rows from the pre-exec describe
  command: string
  durationMs: number
  stdout: string
}
export function saveMiss(a: SaveMissArgs): Promise<void>
```

## Order, and why it is the order

1. `resolveOutputs` / `resolveWorkspaceOutputs` — the files as they are
   NOW, after the command.
2. The empty-set warning (`cache.outputs matched no files`) — a status
   line, once, on this miss; `outputs: []` is a deliberate cached no-op
   and says nothing.
3. `cache.save` — entry, output rows and `entry_inputs` rows in one
   transaction; no exit code, because the contract accepts none and the
   caller's `exitCode === 0` gate is the invariant.
4. `recordOutputDirs` — whole-subtree prefixes for the hit path's
   directory-mtime check.
5. `markOutputsChanged` / `markWorkspaceOutputsChanged` /
   `invalidateWorkspacePartition` — the git snapshot learns the exact
   paths, not "everything changed"; on a 1,000-package cold run that
   is one `git ls-files` spawn per project not made.

Not here: the deferred-download path (`--download=none`), which saves
no artifact and registers a closure instead (`execute-task.ts`).

## Tests

`tests/cache*.test.ts`, `tests/outputs-*.test.ts`, the stale-hit pins
in `tests/execute-task*.test.ts`, and the git-marking pins in
`tests/inputs.test.ts`; the split itself is covered by the whole gate
passing unchanged.
