# `src/util/settle.ts` — the end-of-run settle bound

## Purpose

A plugin's flush or teardown is I/O a third party wrote; it must not
hold the run's exit hostage. This is the deadline every end-of-run
await goes through (`plugin-host.ts`, `telemetry-host.ts`).

```ts
teardownTimeoutMs(): number                       // default 3000
settleWithin(p: Promise<unknown>, ms): Promise<boolean>
```

- `teardownTimeoutMs` reads `VX_TEARDOWN_TIMEOUT_MS` per call (a test
  drives the deadline instead of waiting it out). Out-of-range falls
  back to the default rather than clamping: this is a BOUND, not a
  duration — clamping to `MAX_TIMEOUT_MS` would honour "wait 24.8
  days", which defeats it, and past the ceiling the delay becomes 1 ms
  and every flush times out.
- `settleWithin` returns whether `p` settled before the deadline; the
  caller decides whether a lost result is worth a warning. A rejection
  landing after the deadline won is swallowed rather than surfacing as
  an unhandled-rejection crash.

## Tests

`tests/util-settle.test.ts`; `tests/timeout-bounds.test.ts`.
