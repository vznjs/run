// The workspace as every verb must see it: the config with the plugin
// `config` stage applied, and the cache dir derived from THAT. The stage
// is documented to shape `cacheDir`; a verb that read the file raw opened
// a directory the run never used — `vx last` found no runs, `vx cache
// prune` pruned nothing, `vx watch` ignored the wrong path.

import type { WorkspaceConfig } from '../config.js'
import { UserError } from '../util/index.js'
import { CORE_VERBS } from './help.js'
import { Cache } from '../cache/index.js'
import { loadProjects, loadWorkspacePlugins } from '../orchestrator/index.js'
import type { VxPlugin } from '../orchestrator/index.js'
import {
  buildPackageGraph,
  computeWorkspaceFingerprint,
  resolveCacheDir,
  type ProjectEntry,
  type ProjectMeta,
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
  assertPluginVerbs(plugins)
  return { workspaceConfig, plugins, cacheDir: resolveCacheDir(workspaceRoot, workspaceConfig) }
}

/**
 * A plugin verb the dispatcher would never reach is refused, not ignored.
 * Core verbs are matched first, so a plugin naming one has written a verb
 * that cannot run; two plugins naming the same verb would run the first
 * declared and hide the second. Checked on every verb's load, so the
 * refusal does not wait for someone to type the dead one.
 */
export function assertPluginVerbs(plugins: readonly VxPlugin[]): void {
  const owners = new Map<string, string>()
  for (const plugin of plugins) {
    for (const verb of Object.keys(plugin.commands ?? {})) {
      if ((CORE_VERBS as readonly string[]).includes(verb) || verb === 'stats') {
        throw new UserError(
          `plugin '${plugin.name}' declares command '${verb}', a core verb — core verbs cannot be shadowed`,
        )
      }
      const owner = owners.get(verb)
      if (owner !== undefined) {
        throw new UserError(
          `plugins '${owner}' and '${plugin.name}' both declare command '${verb}' — a verb has one owner`,
        )
      }
      owners.set(verb, plugin.name)
    }
  }
}

/**
 * The run path's project-config load (`loadProjects`) for a verb that only
 * reads: the plugin `project` stage applies, and the local cache opens only
 * to serve cached evaluations — a pure config costs a stat, not an
 * evaluation. `scope` is every project or a list of names; no closure, no
 * lock (a verb reads live, as a default run does).
 */
export async function loadCliProjects(
  workspaceRoot: string,
  metas: readonly ProjectMeta[],
  scope: 'all' | readonly string[] = 'all',
): Promise<Map<string, ProjectEntry>> {
  const { plugins, cacheDir } = await loadCliWorkspace(workspaceRoot)
  const cache = new Cache(cacheDir)
  try {
    const loaded = await loadProjects({
      workspaceRoot,
      cacheDir,
      plugins,
      projectMetas: metas,
      packageGraph: buildPackageGraph([...metas]),
      seeds: scope,
      closure: false,
      lock: null,
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
