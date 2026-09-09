// The flakiness verdict, in ONE place. Two readers classify `runs` rows —
// the all-time per-task query here and `LocalHistoryProvider`'s bounded
// window — and they used to encode the rule independently, which let them
// drift into opposite verdicts on identical data. Both build on
// `mixedOutcomeKeysSql` + `failureModeOf`, so the rule cannot fork again.

import type { Database } from 'bun:sqlite'
import { KEYED_RUNS_SQL } from '../cache/index.js'
import { isCacheHit, TASK_STATUSES } from './telemetry.js'

// SQL hit set derived from the predicate — never a hand-typed list and never
// a prefix LIKE (a prefix counts any status merely NAMED cache-hit-*). The
// status-vocabulary tripwire greps both wrong forms.
const HIT_STATUSES = `(${TASK_STATUSES.filter(isCacheHit)
  .map((s) => `'${s}'`)
  .join(', ')})`

export type FailureMode = 'stable' | 'flaky-recoverable' | 'flaky-fatal'

/**
 * Per-key outcome subquery: the distinct cache keys under `source` (a
 * relation with `project`, `task`, `hash`, `status`, `cache_hit` columns)
 * that produced BOTH a failure and a success — the definitional flake:
 * identical inputs, different outcomes. A failure whose key never succeeded
 * is a legitimate break (a changed input that fails), which belongs to the
 * regressions surface, not flakiness. One projection of the rule serves the
 * all-time query below and the windowed one in `history.ts`.
 */
export function mixedOutcomeKeysSql(source: string, where = ''): string {
  return `SELECT project, task FROM ${source}
       WHERE ${KEYED_RUNS_SQL}${where}
       GROUP BY project, task, hash
       HAVING SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN status = 'success' OR status IN ${HIT_STATUSES} OR cache_hit = 1
                  THEN 1 ELSE 0 END) > 0`
}

/** Mixed-outcome keys of one (project, task) over its WHOLE recorded history. */
export function mixedOutcomeKeyCount(db: Database, project: string, task: string): number {
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM (${mixedOutcomeKeysSql('runs', ' AND project = ? AND task = ?')})`,
    )
    .get(project, task) as { n: number }
  return row.n
}

/**
 * The verdict. Flaky requires a NONDETERMINISM signal: a within-run retry,
 * or a cache key that both failed and succeeded (`mixedKeys`). Failures
 * alone — each on its own key — are legitimate breaks, however many there
 * are. `mixedKeys` is a thunk so a task that never failed is stable without
 * the key count being computed at all.
 */
export function failureModeOf(
  counts: { total: number; failures: number; retried: number },
  mixedKeys: () => number,
): FailureMode {
  const flakySignal = counts.retried > 0 || (counts.failures > 0 && mixedKeys() > 0)
  if (!flakySignal) return 'stable'
  return counts.failures < counts.total / 5 ? 'flaky-recoverable' : 'flaky-fatal'
}

/** `failureModeOf` over a task's whole recorded history (the DB is not touched unless it failed). */
export function classifyFailureMode(
  db: Database,
  project: string,
  task: string,
  counts: { total: number; failures: number; retried: number },
): FailureMode {
  return failureModeOf(counts, () => mixedOutcomeKeyCount(db, project, task))
}
