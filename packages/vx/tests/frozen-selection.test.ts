// `--frozen` reaches selection: the `--affected` owners a frozen run selects
// from are read from `vx-lock.json`, as the run's own configs are. Before,
// they were evaluated live, so a `workspaceFiles` glob that depends on the
// environment could select in one environment what the run then keyed by
// the lock's other one.

import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { addProject, gitIn, makeWorkspace } from './helpers/workspace.js'

const BIN = path.resolve(import.meta.dir, '..', 'src', 'bin.ts')
const TIMEOUT = 30_000

// The shared-file glob exists only when SHARED names it.
const CONFIG = `
  export default {
    tasks: {
      build: {
        exec: { command: 'echo built' },
        cache: {
          inputs: {
            files: ['src/**'],
            ...(process.env.SHARED ? { workspaceFiles: [process.env.SHARED] } : {}),
          },
          outputs: { files: [] },
        },
      },
    },
  }
`

async function vx(
  root: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
  // SHARED must be ABSENT, not empty, in the runs that prove the live path.
  const { SHARED: _inherited, ...inherited } = process.env
  const proc = Bun.spawn([process.execPath, BIN, ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...inherited, NO_COLOR: '1', ...env },
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out, err }
}

describe('--frozen selection reads the lock', () => {
  let root: string
  beforeEach(async () => {
    root = await makeWorkspace({ prefix: 'vx-frozen-sel-' })
    await addProject(root, 'app', { config: CONFIG, files: { 'src/index.js': 'export {}\n' } })
    await Bun.write(path.join(root, 'shared', 'schema.json'), '{}')
    // Lock with the glob present; every run below has SHARED unset.
    const lock = await vx(root, ['lock'], { SHARED: 'shared/**' })
    expect(`${lock.code}\n${lock.err}`).toStartWith('0\n')
    const git = gitIn(root)
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
    await Bun.write(path.join(root, 'shared', 'schema.json'), '{"v":2}')
    git('add', '-A')
    git('commit', '-q', '-m', 'bump shared')
  })
  afterEach(async () => {
    await Bun.$`rm -rf ${root}`.quiet()
  })

  it(
    'a frozen --affected run selects the task whose LOCKED glob claims the change',
    async () => {
      const r = await vx(root, ['run', 'build', '--frozen', '--affected=HEAD~1'])
      expect(`${r.code}\n${r.err}`).toStartWith('0\n')
      expect(r.out).toContain('app#build')
    },
    TIMEOUT,
  )

  it(
    'the same run without --frozen evaluates live, where the glob does not exist, and selects nothing',
    async () => {
      const r = await vx(root, ['run', 'build', '--affected=HEAD~1'])
      expect(r.code).toBe(0)
      expect(r.out + r.err).not.toContain('app#build')
      expect(r.out + r.err).toContain('nothing affected')
    },
    TIMEOUT,
  )

  it(
    'a frozen run with no lock is refused by selection with the run’s own message',
    async () => {
      await Bun.$`rm ${path.join(root, 'vx-lock.json')}`.quiet()
      const r = await vx(root, ['run', 'build', '--frozen', '--affected=HEAD~1'])
      expect(r.code).not.toBe(0)
      expect(r.err).toContain('--frozen requires vx-lock.json')
    },
    TIMEOUT,
  )
})
