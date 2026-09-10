// `vx info` — workspace doctor printout. One screen of environment +
// workspace + cache facts for bug reports and quick sanity checks.
// `vx stats` is a deprecated alias (info absorbed it).

import { Cache, CACHE_VERSION, noteSchemaReset, SCHEMA_VERSION } from '../cache/index.js'
import { seeHelp } from './help.js'
import { VERSION } from '../version.js'
import { loadCliProjects, loadCliWorkspace, warnToStderr } from './workspace-config.js'
import {
  findWorkspaceRoot,
  listProjects,
  loadProjectConfig,
  loadWorkspace,
  lockfilePath,
  type ProjectMeta,
} from '../workspace/index.js'
import { formatBytes } from './format.js'

export async function infoCmd(args: readonly string[]): Promise<number> {
  if (args.length > 0) {
    process.stderr.write(`vx info: unknown argument: ${args[0]}${seeHelp('info')}\n`)
    return 1
  }
  const root = await findWorkspaceRoot(process.cwd())
  const metas = await listProjects(await loadWorkspace(root))
  const { cacheDir } = await loadCliWorkspace(root)
  const cache = new Cache(cacheDir)
  noteSchemaReset(cache, warnToStderr)
  let stats
  let orphans
  let taskCount = 0
  try {
    stats = cache.stats()
    orphans = await cache.orphanStats()
    // The run path's load — a plugin's `project` stage counts — so the
    // doctor's task count is the number a run would see. A broken config
    // must not take the doctor down with it: the count then falls back to
    // the configs that do load, one by one, the broken ones as zero.
    try {
      const loaded = await loadCliProjects(root, metas)
      for (const p of loaded.values()) taskCount += Object.keys(p.config.tasks ?? {}).length
    } catch {
      taskCount = await countLoadableTasks(metas)
    }
  } finally {
    cache.close()
  }

  const lockPresent = await Bun.file(lockfilePath(root)).exists()

  const rows: [string, string][] = [
    ['vx', VERSION],
    ['bun', Bun.version],
    ['git', gitVersion()],
    // The one `git status` walk per run is the warm path's critical path on
    // a large tree (~55 ms at 1000 projects, measured 2026-09-02). git's
    // own caches make it near-free after the first run, and they are OFF by
    // default — say so, since nothing else in a run would.
    ['git status cache', gitStatusCache(root)],
    ['workspace root', root],
    ['projects', `${metas.length} (${taskCount} task${taskCount === 1 ? '' : 's'})`],
    ['cache dir', cacheDir],
    // The two versions a bug report needs and the reset notice names: the
    // key prefix (a bump orphans every entry) and the index schema (a
    // mismatch drops every table).
    ['cache versions', `keys ${CACHE_VERSION} · index schema ${SCHEMA_VERSION}`],
    ['cache entries', `${stats.entryCount} (${formatBytes(stats.totalBytes)})`],
    // Only when there is something to say: the index is authoritative, so a
    // row-less artifact is bytes nothing will ever hit — and only `vx cache
    // prune` reclaims them (after an upgrade's schema reset, most often).
    ...(orphans.orphans > 0
      ? ([
          [
            'orphans',
            `${orphans.orphans} artifact${orphans.orphans === 1 ? '' : 's'} (${formatBytes(orphans.orphanBytes)}) the index does not know — \`vx cache prune\` reaps them`,
          ],
        ] as [string, string][])
      : []),
    ['runs (24h)', `${stats.runCountLast24h} (${stats.hitCountLast24h} cache hits)`],
    ['vx-lock.json', lockPresent ? 'yes' : 'no'],
  ]
  const labelW = Math.max(...rows.map(([label]) => label.length))
  const lines = rows.map(([label, value]) => `${`${label}:`.padEnd(labelW + 1)} ${value}`)
  process.stdout.write(`${lines.join('\n')}\n`)
  return 0
}

/**
 * Whether git's fsmonitor / untracked cache are on. Reported as a fact,
 * not a remedy: interleaved A/B at 1000 projects measured neither moving
 * the warm run (STATUS, waves 5 and the 2026-09-03 refutations) — the
 * status walk's cost is git's own, and vx already overlaps it.
 */
function gitStatusCache(root: string): string {
  try {
    const p = Bun.spawnSync({
      cmd: ['git', 'config', '--get-regexp', '^core\\.(fsmonitor|untrackedcache)$'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = p.exitCode === 0 ? new TextDecoder().decode(p.stdout) : ''
    const on = (key: string): boolean =>
      new RegExp(`^core\\.${key} (true|1|yes|on)$`, 'im').test(out)
    const fsmonitor = on('fsmonitor')
    const untracked = on('untrackedcache')
    if (fsmonitor && untracked) return 'fsmonitor + untrackedCache on'
    const missing = [
      ...(fsmonitor ? [] : ['core.fsmonitor']),
      ...(untracked ? [] : ['core.untrackedCache']),
    ]
    return `${missing.join(', ')} off`
  } catch {
    return '(unknown)'
  }
}

function gitVersion(): string {
  try {
    const p = Bun.spawnSync({ cmd: ['git', '--version'], stdout: 'pipe', stderr: 'pipe' })
    if (p.exitCode !== 0) return '(not found)'
    return new TextDecoder()
      .decode(p.stdout)
      .trim()
      .replace(/^git version /, '')
  } catch {
    return '(not found)'
  }
}

async function countLoadableTasks(metas: readonly ProjectMeta[]): Promise<number> {
  let count = 0
  await Promise.all(
    metas.map(async (meta) => {
      if (meta.configPath === null) return
      try {
        const config = await loadProjectConfig(meta.configPath)
        count += Object.keys(config.tasks ?? {}).length
      } catch {
        // counted as zero
      }
    }),
  )
  return count
}
