// The out-of-project half of doc-references.test.ts: the site guides and
// CLAUDE.md name core files too, and live outside packages/vx, which a
// sandboxed shard cannot read (the cross-project law). Same rule, the
// unsafe suite.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

const pkg = path.resolve(import.meta.dir, '..')
const repo = path.resolve(pkg, '..', '..')

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, ext, out)
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

describe('every core file path the guides and CLAUDE.md name exists', () => {
  it('src/, tests/ and docs/ paths resolve under packages/vx', () => {
    const files = [
      ...walk(path.join(repo, 'packages', 'vx-docs', 'src', 'content', 'docs', 'guides'), '.md'),
      path.join(repo, 'CLAUDE.md'),
    ]
    const missing: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/`((?:src|tests|docs)\/[A-Za-z0-9_./-]+\.(?:ts|md|mjs))`/g)) {
        const ref = m[1]!
        if (!existsSync(path.join(pkg, ref))) missing.push(`${path.relative(repo, file)}: ${ref}`)
      }
    }
    expect(missing).toEqual([])
  })
})
