# `src/workspace/turbo.ts` — the Turbo → vx mapping

## Purpose

Read a Turbo workspace — the root `turbo.json` (`tasks` in Turbo 2,
`pipeline` in Turbo 1), per-package `turbo.json` overlays and each
package's `scripts` — and emit one `TaskConfig`-shaped object per
(package, task). One mapper, two consumers, so they cannot drift:

- `vx migrate --from turbo` (`src/cli/migrate-turbo.ts`) renders the
  objects to `vx.config.ts` files, splicing Turbo's global fields in as
  imports of a generated `vx-preset.ts`;
- `@vzn/vx-turbo` hands them to the `project` stage live, globals
  inlined, so a Turbo repo runs under vx with no file written.

## Public surface

```ts
export interface MapTurboOptions {
  splice(kind: TurboGlobal, values: readonly string[]): readonly unknown[]
  persistentTodo: string
}
export async function mapTurboWorkspace(
  root: string,
  metas: readonly ProjectMeta[],
  opts: MapTurboOptions,
): Promise<TurboMapping>
// TurboMapping = { projects: TurboMappedProject[]; notes: string[];
//                  globals: { inputs; env; pass } }
// TurboMappedTask = { name; todos: string[]; task: Record | null;
//                     uses: ReadonlySet<TurboGlobal> }
export type TurboGlobal = 'inputs' | 'env' | 'pass'
```

`splice` is the seam between the consumers: what a task's array holds
for one of Turbo's three global fields (`globalDependencies`,
`globalEnv`, `globalPassThroughEnv`). The migrator answers with an
opaque preset spread (`{ raw: '...globalInputs' }`); the plugin answers
with the values themselves. `uses` names which globals a task drew on,
so the renderer imports exactly those.

## Rules

- **A task exists for a package only when the package declares the
  script** — Turbo's own rule. An absent script is silent; a script
  key whose value cannot be a command (a number, `null`, an empty
  string, an array) produces a `task: null` entry whose todo says why,
  rather than a config that fails to load.
- **Definition order**: root `name`, then root `pkg#name`, then the
  package's own `turbo.json` — later overlays win field by field.
- `dependsOn`: `^x` passes through; `pkg#task` is kept only when `pkg`
  emits `task` (else a todo: edge dropped); a same-package name the
  package lacks simply has no edge; `$TURBO_ROOT$` deps are a todo (vx
  has no workspace-root tasks, and root `//#` tasks become a note).
- `inputs`: absent → `**/*` (Turbo's default); `$TURBO_DEFAULT$` →
  `**/*`; `$TURBO_ROOT$/<path>` → `cache.inputs.workspaceFiles`
  (negation kept); any other `$TURBO_ROOT$` use is a todo.
  `globalDependencies` land in `workspaceFiles` too.
- `outputs`: `$TURBO_ROOT$/<path>` → `cache.outputs.workspaceFiles`;
  a negated output is a todo (vx outputs have no negation).
- `env` / `passThroughEnv`: explicit names go to `cache.inputs.env`
  (env only) and `exec.env.passThrough` (both, plus both globals); a
  wildcard is a todo. A name both a global list and the task's own
  list carry is listed once.
- `cache: false` or `persistent: true` → no `cache` block; a
  persistent task gets `exec.persistent: {}` and the consumer's
  `persistentTodo`.
- An unknown Turbo key is a todo naming it; `extends` is accepted and
  ignored (the overlay order above is what it means).

## What it does NOT do

- Write anything, or decide what a global becomes — that is `splice`.
- Read `.env` files or Turbo's `envMode`; env handling is names only.
- Guess a missing script from a task's name.

## Tests

`tests/migrate.test.ts` (through `migrateTurbo`: every rule above has a
fixture, including the malformed-script and dropped-edge cases);
`packages/vx-turbo/tests/` (the live consumer, globals inlined, once-
listed names).

## Replacing this module

An Nx twin would be a second mapper with the same shape, consumed by
`migrate-nx.ts` and a `project`-stage plugin; it is deliberately not
built (STATUS § Improvement loop, item 10).
