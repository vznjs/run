# `src/workspace/lockfile.ts` — vx-lock.json

## Purpose

`vx lock` freshly evaluates every project config and freezes
`{ configPath, configHash, config }` per project into `vx-lock.json`.
`vx run --frozen` loads configs FROM the lock (zero eval, no staleness
check of its own); `vx lock --check` reports changed files from the
stored hashes and re-evaluates to catch env-drift the hashes can't
see.

## Invariants

- Deliberate asymmetry: `--frozen` runs TRUST the lock outright — a
  config edited since `vx lock` runs as locked (owner, 2026-06-13: a
  byte-hash re-check cannot see import closures or env, so it would be
  a weaker guarantee pretending to add safety); only `--check` pays the
  full re-evaluation, and the CI recipe is `vx lock --check && vx run
--frozen`. `configHash` exists for `--check`'s file-changed report.
- A missing entry (or a missing lock) under `--frozen` is a hard
  `UserError` — never a silent fallback to evaluation.
- `vx-lock.json` is globally excluded from cache inputs and
  `--affected` (it's vx's own metadata, never a task input).
