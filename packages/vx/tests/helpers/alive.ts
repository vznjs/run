// Is a child process still running? Defined ONCE for the suites that kill
// children and wait for them to go — three copies of this rule had
// diverged into three copies of the same blind spot.
//
// Signal 0 alone is not the answer on Linux: a child whose parent (a vx
// process the test SIGTERMed) exited before reaping it is reparented to
// init and stays a zombie — signal 0 still lands — until init gets around
// to it, ~1.5 s in a container. That wait was two thirds of the
// signal-handling suite and was never vx's doing. Dead is dead: read the
// state.

import { readFileSync } from 'node:fs'

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // `<pid> (<comm>) <state> …` — comm may hold spaces and parens, so the
    // state is the field after the LAST ')'.
    const state = stat.charAt(stat.lastIndexOf(')') + 2)
    if (state === 'Z' || state === 'X') return false
  } catch {
    // No procfs (macOS): signal 0 is the only answer, and launchd reaps fast.
  }
  return true
}

export async function waitForDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await Bun.sleep(20)
  }
  return !isAlive(pid)
}
