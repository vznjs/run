# @vzn/vx-turbo

Run a Turbo repository under [`@vzn/vx`](https://github.com/vznjs/vx) with nothing written: the plugin fills vx's `project` stage from `turbo.json` and each package's `package.json` scripts, using the same mapper `vx migrate --from turbo` renders files from. What runs is what a migration would have written, minus the file — a trial that commits nothing. Zero dependencies.

## Usage

```ts
// vx.workspace.ts — the only file vx needs
import { defineWorkspace } from '@vzn/vx'
import { turbo } from '@vzn/vx-turbo'

export default defineWorkspace({ plugins: [turbo()] })
```

Then `vx run build --all` runs every package's `build` script the way `turbo run build` would: `dependsOn` edges (`^build`, same-package deps, `pkg#task`), `inputs` / `outputs` as the cache block, `env` / `passThroughEnv`, `cache: false`, `persistent`. Turbo's global fields (`globalDependencies`, `globalEnv`, `globalPassThroughEnv`) are inlined into every task; per-package `turbo.json` overlays apply.

## Locking

`vx lock` freezes the evaluation of written `vx.config.*` files only.
A package that has none gets its tasks from `turbo.json` on every
load — under `--frozen` too — so the lock records nothing for it and
`vx lock --check` does not audit it; `turbo.json` is its source of
truth, committed like one.

## What it does not do

- A task the package's own `vx.config` already declares is left alone — the plugin fills, it never overwrites. Migrate a package by writing its config; the rest of the repo keeps running from `turbo.json`.
- The mapping's gaps are the migration's gaps, reported as warnings on every run instead of `TODO(vx-migrate)` comments: `$TURBO_ROOT$` tasks, wildcard env names, negated outputs, unknown turbo keys. `vx migrate --dry` lists the same set once.
- Nothing is cached, run or resolved differently from a written config: the key a task derives here equals the key the written config would derive.

## Options

| Option | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| `root` | Directory holding `turbo.json`. Defaults to the workspace root. |
