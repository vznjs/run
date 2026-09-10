# `src/orchestrator/placement.ts` — where each task runs

## Purpose

The placement of a task graph over the resolved executors, and the
plan-mode view of it. Split from `run.ts` on 2026-09-10 (pure motion):
`run()` decides what to run and in what order; this module decides
where each task lands, and `--dry` asks it the same question without
running anything.

## Public surface

```ts
export function pinnedLocalSet(nodes): Set<string>
export interface Placements { executors; remoteOnly; remoteOnlyNoop }
export function placeTasks(nodes, executors, ...): Placements
export async function planExecutorOf(prepared, log, policy): { executorOf?, downloadOf?, downloadDowngrades? }
export function hasPooledExecutor(executors): boolean
export function poolOfPlacement(placements): (id) => { name; capacity } | undefined
export const UNPLACED_EXECUTOR: TaskExecutor
```

## Rules

- **Pinned to this machine**: a persistent task, a task that
  transitively depends on one (a worker cannot reach a port on the
  submitter), or `exec.remote: false`. Pinned tasks never reach a
  remote executor.
- Everything else asks the executors in declaration order
  (`selectExecutor`); the local floor takes what nothing claimed.
- `exec.remote: 'only'` with a remote executor that accepts it runs
  there and its outputs stay remote (`remoteOnly`); with no remote
  executor it is a **no-op** on this machine — never executed, outputs
  never cleaned or restored (`remoteOnlyNoop`) — and the run says so.
- A pooled executor (one with `capacity`) hands the scheduler its pool
  through `poolOfPlacement`, so it can run more tasks at once than the
  local worker count.
- `UNPLACED_EXECUTOR` is the sentinel behind a task that reached an
  executor without being placed: an internal error, never a fallback.
- `planExecutorOf` resolves the executors for a plan and places the
  graph; a failing hook does not fail the plan (a plan never fails
  over a label) but is said on the status line in the plugin's name.

## Tests

`tests/plugin-capabilities.test.ts` (placement end to end: pins,
decline-and-fall-through, `'only'` taken / no-op / said, pools, `--dry`
labels and the failure notice); `tests/download-policy.test.ts` (the
download modes placement feeds); `tests/plan-predict.test.ts`.
