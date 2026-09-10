// The sandbox-unavailable message tells the user which config field fixes
// it. That field has to be one the loader accepts: the hint once named the
// runtime's own option (`enableWeakerNestedSandbox`), and a user who put it
// in `exec.sandbox` met an unknown-field refusal instead of a fix.

import { describe, expect, it } from 'bun:test'
import { unavailableReason } from '../src/exec/index.js'
import { validateProjectConfig } from '../src/workspace/index.js'

type Config = Parameters<typeof validateProjectConfig>[0]

// Built as `unknown`: this is the boundary the loader validates, and the
// point is what IT accepts, not what TypeScript does.
const withSandbox = (sandbox: Record<string, unknown>): Config =>
  ({ tasks: { t: { exec: { command: 'true', sandbox } } } }) as unknown as Config

describe('the sandbox-unavailable hint names a field the loader accepts', () => {
  const nested = unavailableReason(
    1,
    'apply-seccomp: write /proc/self/uid_map: Operation not permitted',
  )

  it('names the nested-namespace remedy as a config field', () => {
    expect(nested).toContain('sandbox.weakerWhenNested: true')
    expect(nested).not.toContain('enableWeakerNestedSandbox')
  })

  it('every `sandbox.<field>` the hint names validates on a task', () => {
    const named = [...nested.matchAll(/`sandbox\.([A-Za-z]+): true`/g)].map((m) => m[1]!)
    expect(named.length).toBeGreaterThan(0)
    for (const field of named) {
      expect(() => validateProjectConfig(withSandbox({ [field]: true }), 'hint')).not.toThrow()
    }
    // Control: the runtime option's own name is exactly what the loader refuses.
    expect(() =>
      validateProjectConfig(withSandbox({ enableWeakerNestedSandbox: true }), 'hint'),
    ).toThrow(/unknown field "enableWeakerNestedSandbox"/)
  })

  it('a failure that is not the nested namespace carries no remedy', () => {
    const other = unavailableReason(127, 'bwrap: No such file or directory')
    expect(other).toBe('a sandboxed `true` failed (exit 127): bwrap: No such file or directory')
  })
})
