# `src/orchestrator/resources.ts` — declared reservations → scheduler costs

## Purpose

Turn `exec.resources` declarations into the absolute per-task costs
the scheduler's two-dimensional admission gate packs against. Pure;
the loader has already validated every form, so nothing unparseable
reaches it.

## Public surface

```ts
resolveCpu(v: number | undefined): number      // cores; absent → 0
resolveMem(v: number | undefined): number      // megabytes → bytes; absent → 0
resolveResourceCosts(nodes: ReadonlyMap<string, TaskNode>): Map<string, ResourceCost>
```

Units are CPU cores and megabytes — the same numbers on this machine
and on a remote worker, which is why `TaskPlacement.resources` hands an
executor the declaration verbatim. Percent forms were removed
(2026-08-30): a percentage names a fraction of THIS run's budget, and an
executor placing the task elsewhere has no way to mean anything by it.

`resolveResourceCosts` OMITS zero-cost tasks: an empty map means "no
reservations declared", the one gate the scheduler and `run()`'s
option threading key off to keep every run without declarations
byte-identical to before the feature existed.

## Tests

`tests/resources.test.ts` (both axes, absent forms, the empty-map
gate); `tests/util-size.test.ts` (the size parsing the loader does
before this runs).

## Replacing this module

Nothing to replace — a different cost model (weights, time) changes
`ResourceCost` in `graph/scheduler.ts` first; this module is the
single conversion site.
