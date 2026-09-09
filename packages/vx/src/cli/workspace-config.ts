// The workspace as every verb must see it: the config with the plugin
// `config` stage applied, and the cache dir derived from THAT. The stage
// is documented to shape `cacheDir`; a verb that read the file raw opened
// a directory the run never used — `vx last` found no runs, `vx cache
// prune` pruned nothing, `vx watch` ignored the wrong path.

import type { WorkspaceConfig } from '../config.js'
import { loadWorkspacePlugins } from '../orchestrator/index.js'
import type { VxPlugin } from '../orchestrator/index.js'
import { resolveCacheDir } from '../workspace/index.js'

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
