# `src/orchestrator/signals.ts` — a signal reaches every child

## Purpose

A SIGINT or SIGTERM to the vx process mid-run forwards SIGTERM to every
live child and every ready persistent task, closes the cache handle,
and exits 128 + signo (130 / 143). Without it, a programmatic signal to
the process alone — CI cancellation, `kill <pid>` — orphaned every
running child; terminal Ctrl-C only worked through the process group.
Split from `run.ts` on 2026-09-10 (pure motion).

## Public surface

```ts
export function forwardSignals(args: {
  enabled: boolean // RunOptions.handleSignals
  log: Logger
  cache: { close(): void }
  liveChildren: ReadonlySet<Subprocess> // the runner's in-flight children
  persistentRegistry: ReadonlyMap<string, Subprocess>
}): { remove(): void }
```

The two registries stay with `run()`, which hands them to the runner
around every spawn; this module only reads them when a signal lands.
`remove()` runs in `run()`'s finally so repeated runs in one process (a
test suite, an embedder) never stack listeners. An embedder that owns
the process's signals passes `handleSignals: false`.

## What it does NOT do

- Wait for the children to exit: the process is leaving. The
  end-of-run graceful shutdown with its bounded SIGKILL escalation is
  `persistent.ts`.
- Run under a custom logger's control beyond `runEnd()`: the status
  region is cleared so a TTY is not left with a frozen frame.

## Tests

`tests/signal-handling.test.ts` (SIGINT → 130 and SIGTERM → 143 with
the one-shot child and the ready persistent child dead; the in-process
lifecycle: handlers removed after every run, `handleSignals: false`
installs none); `tests/cache-hygiene.test.ts` (an interrupted run
publishes nothing).
