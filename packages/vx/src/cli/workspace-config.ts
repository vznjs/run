// The workspace as every verb must see it: the config with the plugin
// `config` stage applied, and the cache dir derived from THAT. The stage
// is documented to shape `cacheDir`; a verb that read the file raw opened
// a directory the run never used — `vx last` found no runs, `vx cache
// prune` pruned nothing, `vx watch` ignored the wrong path.

import type { WorkspaceConfig } from '../config.js'
import { UserError } from '../util/index.js'
import { Cache, noteSchemaReset } from '../cache/index.js'
import { loadProjects, loadWorkspacePlugins } from '../orchestrator/index.js'
import type { VxPlugin } from '../orchestrator/index.js'
import {
  buildPackageGraph,
  computeWorkspaceFingerprint,
  FROZEN_WITHOUT_LOCK,
  type ProjectEntry,
  type ProjectMeta,
  readLockfile,
  resolveCacheDir,
} from '../workspace/index.js'

export interface CliWorkspace {
  workspaceConfig: WorkspaceConfig | null
  plugins: readonly VxPlugin[]
  cacheDir: string
}

export const warnToStderr = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

export async function loadCliWorkspace(workspaceRoot: string): Promise<CliWorkspace> {
  const { workspaceConfig, plugins } = await loadWorkspacePlugins(workspaceRoot, warnToStderr)
  return { workspaceConfig, plugins, cacheDir: resolveCacheDir(workspaceRoot, workspaceConfig) }
}

/**
 * The run path's project-config load (`loadProjects`) for a verb that only
 * reads: the plugin `project` stage applies, and the local cache opens only
 * to serve cached evaluations — a pure config costs a stat, not an
 * evaluation. `scope` is every project or a list of names; no closure, no
 * lock (a verb reads live, as a default run does).
 */
/** The run flags a verb's staged load must honour to see what the run sees. */
export interface CliLoadOptions {
  /** `--cache-dir`: where the cached evaluations live. */
  cacheDir?: string
  /** `--frozen`: configs come from `vx-lock.json`, not evaluation. */
  frozen?: boolean
}

export async function loadCliProjects(
  workspaceRoot: string,
  metas: readonly ProjectMeta[],
  scope: 'all' | readonly string[] = 'all',
  opts: CliLoadOptions = {},
): Promise<Map<string, ProjectEntry>> {
  const ws = await loadCliWorkspace(workspaceRoot)
  const { plugins } = ws
  // The cached evaluations live where the run's do: a verb given
  // `--cache-dir` must not open (and create) the workspace's default one.
  const cacheDir = opts.cacheDir ?? ws.cacheDir
  // A frozen run reads its configs from the lock; what it SELECTS must be
  // decided from the same configs, or an env-dependent `workspaceFiles`
  // glob could select live what the run then treats otherwise.
  const lock = opts.frozen === true ? await readLockfile(workspaceRoot) : null
  if (opts.frozen === true && lock === null) throw new UserError(FROZEN_WITHOUT_LOCK)
  const cache = new Cache(cacheDir)
  noteSchemaReset(cache, warnToStderr)
  try {
    const loaded = await loadProjects({
      workspaceRoot,
      cacheDir,
      plugins,
      projectMetas: metas,
      packageGraph: buildPackageGraph([...metas]),
      seeds: scope,
      closure: false,
      lock,
      evalCache: {
        store: cache,
        workspaceFingerprint: await computeWorkspaceFingerprint(workspaceRoot),
      },
      warn: warnToStderr,
    })
    return loaded.projects
  } finally {
    cache.close()
  }
}
