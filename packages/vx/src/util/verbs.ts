/**
 * The verbs the CLI dispatcher (`cli/index.ts`) owns; `stats` is a
 * deprecated alias of `info` and stays out of hints but is still matched
 * first. Lives in util rather than cli because the workspace VALIDATOR
 * refuses a plugin verb that names one of these — a verb core matches
 * first could never run — and the workspace module cannot import cli.
 */
export const CORE_VERBS = [
  'run',
  'watch',
  'cache',
  'lock',
  'migrate',
  'init',
  'upgrade',
  'show',
  'info',
  'why',
  'last',
  'prune',
  'help',
  'version',
] as const

/** Every word the dispatcher matches before consulting plugins. */
export const DISPATCHED_VERBS: readonly string[] = [...CORE_VERBS, 'stats']
