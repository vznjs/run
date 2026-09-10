// `--cache-dir` reaches every cache a run verb opens — the selection
// paths too. `--affected` owners, the picker and the watch sweep load the
// staged configs through the same evaluation cache a run uses; opening it
// at the workspace's default dir created `.vx/cache/cache.db` beside the
// one the user pointed at, and printed the schema notice against the
// wrong index.

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { addProject, gitIn, makeWorkspace } from './helpers/workspace.js'
import { loadCliProjects } from '../src/cli/workspace-config.js'
import { listProjects, loadWorkspace } from '../src/workspace/index.js'

const BIN = path.resolve(import.meta.dir, '..', 'src', 'bin.ts')
const TIMEOUT = 30_000

const CONFIG = `
  export default {
    tasks: {
      build: {
        exec: { command: 'echo built' },
        cache: { inputs: { files: ['src/**'], workspaceFiles: ['shared/**'] }, outputs: { files: [] } },
      },
    },
  }
`

describe('the run’s --cache-dir reaches selection', () => {
  let root: string
  let elsewhere: string
  beforeEach(async () => {
    root = await makeWorkspace({ prefix: 'vx-cache-dir-sel-' })
    elsewhere = await mkdtemp(path.join(os.tmpdir(), 'vx-cache-dir-elsewhere-'))
    await addProject(root, 'app', { config: CONFIG, files: { 'src/index.js': 'export {}\n' } })
    await Bun.write(path.join(root, 'shared', 'schema.json'), '{}')
    const git = gitIn(root)
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(elsewhere, { recursive: true, force: true })
  })

  it('loadCliProjects opens the given dir, not the workspace default', async () => {
    const metas = await listProjects(await loadWorkspace(root))
    const staged = await loadCliProjects(root, metas, 'all', elsewhere)
    expect([...staged.keys()]).toEqual(['app'])
    expect(existsSync(path.join(elsewhere, 'cache.db'))).toBe(true)
    expect(existsSync(path.join(root, '.vx', 'cache'))).toBe(false)
  })

  it(
    'an --affected run over an orphan change keeps every cache under --cache-dir',
    async () => {
      // An uncommitted edit to a path no project owns: `--affected` asks the
      // staged configs which task's workspaceFiles glob claims it.
      await Bun.write(path.join(root, 'shared', 'schema.json'), '{"v":2}')
      const proc = Bun.spawn(
        [process.execPath, BIN, 'run', 'build', '--filter', '[HEAD]', '--cache-dir', elsewhere],
        { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1' } },
      )
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(`${code}\n${err}${out}`).toStartWith('0\n')
      expect(out + err).toContain('app')
      expect(existsSync(path.join(elsewhere, 'cache.db'))).toBe(true)
      expect(existsSync(path.join(root, '.vx', 'cache'))).toBe(false)
    },
    TIMEOUT,
  )
})
