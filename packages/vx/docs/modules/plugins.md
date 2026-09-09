# `src/plugins/` — core-provided plugins, each isolated

## Purpose

Core applies NO plugin on its own. Running a command here and caching it in
`.vx/cache` are not plugins but core's FLOOR: `resolveExecutors` appends
`localExecutor()` (`src/exec/local-executor.ts`) to the tail of every
executor list and `resolveCache` appends the host's local `Cache` to the
tail of every chain (`src/orchestrator/plugin-host.ts`). A workspace with no
`vx.workspace.ts` therefore runs and caches, and a plugin executor whose
`accepts()` declines hands the task back to this machine.

What lives under `src/plugins/<name>/` is a complete plugin a workspace
declares like any third-party one:

```ts
// vx.workspace.ts
import { defineWorkspace } from '@vzn/vx'
import { scheduleHistoryPlugin } from '@vzn/vx/plugins/schedule-history'

export default defineWorkspace({ plugins: [scheduleHistoryPlugin()] })
```

## Isolation contract

- A plugin imports core ONLY through the bare public specifier `'@vzn/vx'`
  (resolved inside this repo by the workspace link, exactly as `packages/*`
  do) and never reaches relatively outside its own directory.
- `src/index.ts` does not re-export them; they are published as subpath
  exports (`package.json` `exports`: `./plugins/<name>`), with a root shim
  under `plugins/<name>/index.ts` for the compiled binary, which resolves
  packages by directory convention and ignores `exports`.
- Consequence: any directory can be moved into its own package with zero
  edits. Pinned by `tests/module-boundaries.test.ts` (`plugins` module: no
  relative cross-module import) and `tests/package-boundaries.unsafe.test.ts`
  (each plugin imports from `'@vzn/vx'` and nothing else non-relative).

## `schedule-history` — `@vzn/vx/plugins/schedule-history`

`scheduleHistoryPlugin({ window? })` → `vx/schedule-history`. The
reference `schedule` stage: orders ready tasks by their expected
REMAINING critical-path duration (own p50 + the longest chain of
dependents), learned from the last `window` invocations (default 20) of
the local run history through
`LocalHistoryProvider(ctx.localCache.dbHandle(), window)`. Fails open — a broken
history read warns and leaves the baseline order. This was core's
opt-in `predictive` mode until 2026-09-02; as a plugin its history read
is paid only by the workspaces that declare it. `criticalPathPriorities`
is exported for tests and for policies that want the same scoring over
another history source.

## Tests

`tests/local-fallbacks.test.ts` (the floor: a workspace with no workspace
file runs and caches; a declining executor falls back), `tests/schedule-history.test.ts`,
the `NO PLUGINS` / `CONTROL` e2e pins in `tests/plugin-capabilities.test.ts`.
