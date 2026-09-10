// A SIGINT/SIGTERM mid-run forwards SIGTERM to everything live, closes
// the cache handle, and exits 128+signo (130/143). Without this, a
// programmatic signal to the vx process alone (CI cancellation,
// `kill <pid>`) orphans every running child — terminal Ctrl-C only worked
// via process-group propagation. Split from run.ts on 2026-09-10 (pure
// motion); the registries it reads stay with `run()`, which hands them
// to the runner around every spawn.

import { signalExitCode } from '../exec/index.js'
import type { Logger } from './logger.js'

export interface SignalForwarding {
  /** Detach the handlers — in `run()`'s finally, so repeated runs never stack listeners. */
  remove(): void
}

export function forwardSignals(args: {
  /** `RunOptions.handleSignals` — an embedder that owns the process's signals opts out. */
  enabled: boolean
  log: Logger
  cache: { close(): void }
  /** In-flight children; the runner adds and removes each around its spawn. */
  liveChildren: ReadonlySet<ReturnType<typeof Bun.spawn>>
  /** Ready persistent tasks the orchestrator owns until the graph finishes. */
  persistentRegistry: ReadonlyMap<string, ReturnType<typeof Bun.spawn>>
}): SignalForwarding {
  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    // Clear the live worker/status region BEFORE exiting so a TTY isn't
    // left with a frozen region in the scrollback. runEnd is idempotent
    // and a no-op for non-TTY loggers.
    try {
      args.log.runEnd?.()
    } catch {
      // teardown must not throw on the way out
    }
    for (const child of args.liveChildren) child.kill('SIGTERM')
    for (const child of args.persistentRegistry.values()) child.kill('SIGTERM')
    try {
      args.cache.close()
    } catch {
      // double-close race with the normal path; we're exiting anyway
    }
    process.exit(signalExitCode(signal))
  }
  const onSigint = (): void => onSignal('SIGINT')
  const onSigterm = (): void => onSignal('SIGTERM')
  if (args.enabled) {
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
  }
  return {
    remove: () => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    },
  }
}
