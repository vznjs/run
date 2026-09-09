/**
 * Levenshtein distance, capped: anything past two edits reads as 3. Used
 * by the "did you mean" hints for task names and flags, where a hint
 * beyond two edits would guess rather than help.
 */
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return Math.min(prev[b.length]!, 3)
}

/**
 * The ONE near-miss rule every "did you mean" hint applies: the closest
 * candidate within two edits of `name`, or undefined — an exact match is
 * not a hint, and anything further would guess rather than help. Task
 * names, `pkg#task` halves, project names, flags and verbs all go through
 * here so a typo is hinted the same way wherever it is typed.
 */
export function nearest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestD = 3
  for (const c of candidates) {
    const d = editDistance(name, c)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best === name ? undefined : best
}

/**
 * Up to `limit` candidates worth offering for `name`: the nearest by edit
 * distance first, then any that contain it (or that it contains), case-
 * insensitively — the inspection verbs (`why`, `prune`) list a few rather
 * than pick one, since a partial name is as common a query there as a
 * typo. Never includes `name` itself.
 */
export function nearMatches(name: string, candidates: Iterable<string>, limit = 3): string[] {
  const all = [...new Set(candidates)].filter((c) => c !== name)
  const q = name.toLowerCase()
  const byDistance = all
    .map((c) => [c, editDistance(name, c)] as const)
    .filter(([, d]) => d < 3)
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c)
  const out = [...byDistance]
  for (const c of all) {
    if (out.length >= limit) break
    if (out.includes(c)) continue
    const n = c.toLowerCase()
    if (n.includes(q) || q.includes(n)) out.push(c)
  }
  return out.slice(0, limit)
}
