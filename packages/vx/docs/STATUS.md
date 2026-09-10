# STATUS — the living handoff

**Read this first.** It is the one file a fresh session needs to pick the
project up: the direction, what shipped, what is in flight, what is next.
Update it in the SAME commit as the work it describes. Newest state wins;
delete stale lines rather than appending corrections.

## Direction (owner, 2026-09-02)

> "VX should be the Vite of task orchestration. Perf first, then
> modularity. Slim core; add features with plugins or replace
> functionality. Remove DTE / VX Cloud / agents — vx ships none of it, but
> gives people a way to implement it on top. Consider everything before
> this date legacy."

Concretely:

1. **Performance is the first decision driver.** Every change to the run
   path is measured (`packages/vx-bench/`), and a slower core is a regression even if
   it is prettier. Targets: the fastest warm no-op run and the lowest
   scheduler/hash overhead of any JS-monorepo task runner.
2. **Core is a pipeline with seams, not a product.** Core owns:
   discovery, config evaluation, the task graph, cache keys, scheduling,
   and the seams. Plugins own: WHERE a task runs (`executor`), WHERE
   artifacts live (`cache`), WHO observes (`telemetry`/reporters), and —
   as the seams widen — how the graph is shaped and prioritised and which
   CLI verbs exist.
3. **No distribution in the repo.** No agents, synchronizers, controllers,
   cloud, dashboards. The executor seam is the extension point for all of
   it; `@vzn/vx-reapi` (Bazel Remote Execution API) stays as the proof
   that the seam is wide enough.
4. **Native first.** Bun APIs over dependencies. A dependency needs a
   reason written down next to it.
5. **Adoption ready.** Docs, site, and design describe the product that
   exists — verified against the code, not remembered.

Process: push directly to `main`, no PRs. Gate before every push:
`bun packages/vx/src/bin.ts run ci --all`. Small, focused commits.

## Shipped in this arc

A digest, newest last; the commits carry the detail. Numbers are the
1000-project bench (`packages/vx-bench/run.ts`, warm, whole process, best of 5)
unless a shape is named; "interleaved A/B" means arms alternated against
an immutable `git worktree` of the previous commit.

**Scope reset (2026-09-02).** Compact `CLAUDE.md`; removed
`@vzn/vx-agents`, predictive scheduling, the mcp-only queries, the
decision-log archive, `docs/progress/` and the removed products' design
docs. `bench/` fixed for the `packages/vx` layout.

**Perf waves, warm run 400 → ~172 ms at 1000 projects** (100 projects
105 → 74–79 ms):

- W1: unscoped runs start git before configs load; config-eval cache
  for provably-pure configs (`config_evals`). 400 → 270 ms.
- W2: `VX_TIMING=1` stage table; one worktree walk (`ls-files -s -v` +
  `status --porcelain -uall`, 4 spawns not 5); `.git/HEAD` read directly
  (−10 ms); discovery via readdir not glob (25 → 2 ms); code-unit sort
  (−28 ms ICU). 270 → 242 ms. REFUTED: sync fs on the hit path (40 ms
  slower under concurrency); one `bun build --target=bun` bundle (start
  25 → 36 ms).
- W3: `CacheLayer.getMany?` + `CacheEntry.outputRows`; memoised globs.
  2000-task `run test --all` 328 → 311 ms.
- W4: `vx info` reports git's fsmonitor/untracked-cache; the eval key
  folds `VERSION` (a stored evaluation must not outlive its validator).
- W5: the classify pass runs for flat graphs too (one batched `getMany`).
  100 tasks 84 → 78 ms, 1000 → 249 → 237. REFUTED: fsmonitor at 100
  projects; lazy-loading modules (`--version` is 13 ms of module load).
- W6: `output_dirs` — the output glob walk left the warm hit (0.36 ms/hit,
  365 ms CPU); directory mtimes prove the set. 224 → 204 ms, run graph
  98 → 18 ms. Racy-clean rule `OUTPUT_DIRS_RACY_MS` = 50 (Linux coarse
  timestamps; a racy snapshot is dropped whole).
- W7: git starts right after `findWorkspaceRoot`: 195 → 172 ms (−12%).
- Unread `runs_hash` index dropped: 1000 inserts 11.5 → 3.9 ms. Eval
  lookups one `IN` query per round (3.6 → 0.7 ms). Discovery stats the
  config names (9.6 → 6.3 ms). Warm config load keys from stat
  identities via ordered closures (`config_closures`,
  `CONFIG_EVAL_VERSION` 2): load configs 27 → 20 ms in-process.
- REFUTED as leads: fsmonitor (57.6 vs 59.1 ms), git's untracked cache,
  `status -unormal` (a clean matrix reads equal; the 18.8 ms was a
  probe's residue in the index — clear it with
  `update-index --no-untracked-cache`), the `getMany` artifact stats
  (2.7 ms), lookahead scheduling. The git walk is git's fixed cost.
- Floors and the stage table live under Next § 5.

**Pipeline v2.** Stages `config` / `project` / `graph` (in-place edits,
re-validated, zero cost undeclared); `commands` (plugin verbs, core
wins, `vx help` lists them; a verb resolving a non-integer fails
naming the plugin); `key` (material folded as `plugin` components, no
`CACHE_VERSION` bump) and `schedule` (weights over the baseline); the
predictive mode returned as `@vzn/vx/plugins/schedule-history`. The
`eventSink` seam is gone. `@vzn/vx-mcp` is back as a plugin on
`commands` (no SDK; a streaming decoder per session after a split-`é`
bug). README, site intro and the extensibility guide reframed on the
stage table.

**Distribution and the binary.** Bun 1.4.0 compiled binaries are
SIGKILLed on this macOS until `codesign -s - --force` (release and CI
re-sign). The binary resolves packages by directory convention only, so
root shims `packages/*/index.ts` + `plugins/<name>/index.ts` exist and
are pinned. The npm manifest exported only `"."` and the darwin platform
binaries were unsigned — both fixed in `npm.yml`; the version stamp
targeted the wrong manifest (every release would have said `0.0.0`) —
all stamp steps hit `packages/vx/package.json` and assert `--version`.
The npm launcher is pinned through `node`. `isUserError` classifies by
name across the binary's second copy of core (the copy itself, ~12 ms,
stays parked — see Next § 3, incl. the refuted resolve-hook route).

**Cache container, streamed (waves 9–10, 2026-09-03).** vx's own
streaming tar reader and writer (`src/cache/tar-stream.ts`) replaced
`Bun.Archive` on every side. Restore: one staging extractor (write
beside the target, rename after the WHOLE archive is read and the
index's outputs are present; abort unlinks temps and prunes only empty
directories). 150 MiB incompressible artifact, fresh process: restore
peak +644 → +49–60 MiB (same wall); save +705 → +241–269 MiB (160 →
~200 ms, the streamed compressor is ~2.4× per byte); ingest +448 → +318
MiB with the compressed bytes live. Artifacts ≤ 4 MiB compressed pack
and decode in one call (stream setup ~35 µs each; tiny-artifact A/B
inside noise). A sizeless zstd frame is decoded under the running 2 GiB
count instead of refused; the `trusted` flag went. Reader pins: pax
`path`/`size`, GNU `L`, base-256 sizes, checksums, truncation, strict
octal, ustar split at its exact limits (against libarchive and the
system `tar`), a poisoned trailing entry writing nothing, a concurrent
writer's file surviving abort, a cut compressed stream refused with no
temp. No `CACHE_VERSION` bump: same layout, readable either way. One
defect found by the audit rotation the same evening: a name over 100
bytes made of multibyte characters (a 141-byte Japanese path is
enough) threw "name too long for ustar" instead of writing its pax
record, because the header name under pax was sliced by characters;
it is the first 100 bytes now, pinned against vx and libarchive, and
the pin fails without the fix. Memory claim measured to its edge: vx
holds one chunk (a single 400 MiB entry restores at +30 MiB, the same
as 150 MiB), while 200 × 2 MiB entries read +90–180 MiB of per-entry
garbage the collector paces — identical configurations differed by
90 MiB run to run, so no code change is justified; the docs now say
"holds one chunk", not "bounded by a chunk". The in-flight write bound
and the buffering threshold were both varied and changed nothing. The
darwin CI job's compiled-binary step now declares an output, deletes
it and asserts the cached run restores it, so the container is
exercised through the binary on every push, not only locally.
Measurement traps recorded: a Blob source is not bounded; a one-process
memory probe with a large buffer live reads GC pacing (+315 vs +30 MiB
in a fresh process); piped oxlint prints one line per finding.

**Headline benchmark and site.** The landing page is the 1,090-package /
3,270-task shape again, with cold, warm, restore and CPU rows: vx 3m 46s
/ 510 ms / 777 ms / 34.6 s; Turbo 2.10.12 5m 13s / 760 ms / 1.17 s /
73 s; Nx 23.2.0 34m 44s / 3.59 s / 4.15 s / 114 min. Baseline is the
theoretical best case (cold = critical-path-first list schedule of the
exact DAG on 10 workers, 3m 38s, `packages/vx-bench/ideal.ts` with pins; the other
rows 0); bars are proportional with an outlier clipped past 10×.
`packages/vx-bench/update-site.ts` generates rows, tiles, note and
`benchmarks.md` from `results.json`; `site-check` gates drift.
`RUNNERS=vx` re-measures one runner in ~6 min; `BASELINE_ONLY=1` the
floors. Re-measured after waves 6–7, 9 and 10: no regression.

**`vx init` and first-run DX.** `migrate-scripts` maps `package.json`
scripts to tasks (pre/post hooks folded in npm order, `<pm> run x`
becomes a group, `build` gets a TODO showing the cache block to add —
until 2026-09-04 it got a block with EMPTY outputs, which is a cached
no-op, not an uncached task: the init walkthrough deleted `dist` and
the next run reported both builds `up-to-date` and rebuilt nothing;
pinned as a differential in the init suite). Same walkthrough, same day: a root with no
`vx.workspace.*` fails with `run \`vx init\``ahead of the plugin
snippet (a file that declares nothing keeps the plain error); a task
with no`cache`block reads`no-cache`on its row, in the legend and
in the report instead of`miss`(the column is eight wide; the Tally
and`--summarize`payloads are unchanged);`vx rnu`says`Did you mean
run?`. And `vx watch`on that fresh workspace re-ran forever: with no
declared outputs the build's own write to`dist/`was an event, and
each cycle wrote it again — watch now drops an event for a file whose
bytes did not change since it last hashed it (one redundant cycle, then
quiet; the e2e pin read 7 re-runs in 1.5 s without it).`init`on a workspace with no scripts writes the workspace file
and prints an example config and the next command; generated configs
carry`import type { ProjectConfig }`+`satisfies`(erased at runtime);
an unresolved config import is a`UserError`naming the file and, for`@vzn/vx`, the install command; a typo says `Did you mean build?`,
and a qualified one is hinted as a runnable spec on either half
(`ap#build`, `app#buidl`→`app#build`).
`vx watch` ignores a task's own declared outputs (one cycle per edit)
and proves each watcher delivers before saying "watching"
(`.vx-watch-probe`, re-written on a backoff; the e2e flake is NOT
proven closed — see Next § 4). The cache dir writes its own
`.gitignore`. Replayed and found working as documented: every verb,
the policy flags, a failing task, a persistent task, `--affected`, the
plugin author's first plugin from the guide (which gained § Testing
your plugin), the same first run through the compiled binary, and
`vx migrate`on a scratch Turborepo (negated outputs and the
persistent task get exact TODOs,`env`passes through, global inputs
become`vx-preset.ts`) and on a scratch Nx graph (named inputs expand,
`{workspaceRoot}` outputs map, chained commands join) — where the
common executors (`@nx/vite:\*`, `@nx/vitest:test`, `@nx/jest:jest`,
`@nx/eslint:lint`, `@nx/js:tsc`) now become their CLI under a TODO
naming the executor instead of an exit-1 placeholder; pinned with the
unknown-executor control, fails without the table. A mistyped flag
names the documented one within two edits (`--concurency`→`did you
mean --concurrency?`), the candidates read from the help text's
sections marked for the verb so no second list drifts and no other
verb's flag is ever suggested (`--older-tha`under`run`gets no hint;
found by probing);`editDistance`lives in`util/`. And the plugins
guide's promise that its code is real is pinned:
`packages/vx-docs/tests/plugins-guide-snippets.test.ts`type-checks
every block against the façade (the contract sketches are skipped by
rule) — a pin that no task ran and that did not pass`--type-check`until 2026-09-09; see the review entry. The other six guides'`ts`
blocks are prose excerpts by design — object fragments without a
wrapper — and stay unchecked.

**Audits with pins (each mutation fails exactly its pin).** Config-eval
purity gate closed against `\u0070rocess`, `global`/`self` aliases and
`Temporal` (`configEvalKey` refuses backslashes in code); `getMany`
parity with `get` (read gate, deleted artifact, LRU touch); the shard
dealer and an empty shard refused; sixteen dead `export`s and ten
test-only barrel names removed; comparison.md re-verified against Turbo
2.10.12 / Nx 23.2.0; two orphan site pages found and the sidebar
coverage pinned; generated site pages self-describe. The core suite
runs as eight shards (`bun test --shard=<i>/8`, Bun's own dealer since
2026-09-05; the descriptor tripwire test is kept for the day Bun fixes
the ~2 pins per import that make one process hit the macOS cap).

**Stale-claim sweep (2026-09-03, evening).** Six live docs described
a removed seam or a rejected approach as current: the fork map and the
execute-task and inputs module docs offered auto-input inference (a
rejected approach) as a plan; prepare.md offered `globalInputs` /
`globalEnv` and a telemetry handle; the module index, plugin.md,
plugin-host.md, orchestrator.md and the architecture walkthrough still
described the `eventSink` seam removed in pipeline v2. All corrected
to what exists; the grep for the class (`EventSink`, `inference`,
`globalInputs`, `predictive`, `dashboard`) is clean outside history.
The same evening: the dispatcher module doc was rebuilt from the verb
switch (it listed `mcp` as core, kept a service-package redirect row,
omitted `init`/`why`/`last`/`prune`, linked four module docs that do
not exist); four docs still named the removed service package's
coordinator (façade list, module index, scheduler, dispatcher); the
why-vx-is-fast page said vx has no config-eval cache and quoted June
numbers; the key-derivation list and the caching guide gained the
`key` stage's plugin material; the pipeline design doc's `commands`
shape was wrong; and three "upstream hash" phrasings now say input
key, never outputs.

**Stale-hit class, caught by CI on a docs-only commit (2026-09-03
evening).** The stat memo behind `Cache.hashFile` (mtime, size, ctime,
inode, all floored to ms) reused a digest after a rewrite that landed
in the same millisecond as the stat it had recorded — mtime restored,
same size, same inode, same ctime to the ms — the racy-clean class
git's index solves and the directory snapshot got in the morning. A
file changed within `FILE_HASH_RACY_MS` (50) of the stat is now hashed
but not memoised; pinned (a fresh file leaves no `file_hashes` row, an
aged one does; fails without the fix). The warm path never meets the
window. The pin first assumed the write and the hash land within the
window and failed under the loaded gate; it now retries until an
attempt provably lands inside it, measured from the file's own ctime.

**Red mains, each explained and pinned:** RED MAIN 638281d (2026-09-03,
mine): a pin's import never landed and the gate failed lint and a
shard, but the commit was chained after a gate piped through `grep`,
whose exit status is grep's — the rule CLAUDE.md states; fixed in the
next commit with the gate's own exit tested, and the memory carries it. an ms-mtime precondition
sampled the clock (stamped now); a 400-round guard past the 5 s
timeout under four shards (30 s + cost hint); Linux racy-clean (the
50 ms window); a darwin-only timing assumption in an e2e pin; a version
assertion written against `cd` (both jobs name the manifest from
`$GITHUB_WORKSPACE`). The macOS sandbox reporting-loss residual (~2%
under load) gates its reporting pins on `VX_REQUIRE_SANDBOX`. And one
gate that failed on every shard was the BOX (load 70–97, `diagnosticd`
pegged): HEAD failed identically; CI was the arbiter and the full gate
passed once the load fell.

- **The runtime bump to `@anthropic-ai/sandbox-runtime` 0.0.75 (owner,
  e924276) reds ubuntu; fixed 2026-09-04.** Six Linux cases failed with
  exit 1 and an empty stderr — every task that SUCCEEDS. Reproduced in
  a privileged OrbStack container (`oven/bun` + bwrap/socat/strace/rg,
  as a non-root user; the suite is the CI signature exactly). Cause:
  0.0.75 feeds SRT's violation store on Linux from its new seccomp
  helper's write observer, judged against the GLOBAL `allowWrite` from
  `initialize` (empty; the per-task list is in `customConfig`, which
  the monitor never sees), so a task's write to its own declared output
  arrived as `deny openat <output>` and fail-on-violation turned exit 0
  into 1. vx reads the store on macOS only now; Linux detection stays
  the strace pass. 28 pass / 1 darwin skip / 0 fail in the container.
  Second finding, same bump: as ROOT in a container the helper cannot
  create its nested user namespace under `--cap-drop ALL`
  (`write /proc/self/uid_map: EPERM`; a non-root user can), and the
  old probe's bare `bwrap … /bin/true` passed anyway. The Linux probe
  now runs ONE sandboxed `true` through SRT's own wrapper and refuses
  up front naming the fix (non-root, or `sandbox.weakerWhenNested` on
  every sandboxed task — `run()` probes the weaker mode only when all
  opt in); a Linux pin says available ⇒ a sandboxed `true` exits 0. The
  suite's `expectOk` prints `<task> <status> exit=<code>` and the
  collected output on failure, so the next red names itself.
- **A read grant on a directory shadows a write bind inside it, on
  Linux only (2026-09-04).** Granting the project directory as a read
  prefix (the "express the declaration, not vx's enumeration of it"
  change) made every write to a declared output fail with `Read-only
file system` under bwrap whenever the workspace root is denied, which
  is always. Reproduced minimally in a container: `read=[project]`
  fails, `read=[project/src]` passes, same command, same everything
  else. macOS never saw it because seatbelt rules are precedence-based
  rather than mounts, which is why it passed the local gate and failed
  CI. The grant existed to make `--verify=inputs` work on this repo's
  build and has no consumer now that verify is gone, so it is REVERTED
  rather than patched. If a `sandbox: {}` task ever needs to LIST a
  directory it declared, this is the problem to solve, and the fix
  belongs in mount ordering (deepest bind last), not in the allow
  lists.

- **`--verify` is gone (owner, 2026-09-04).** All of it: the
  determinism proof, the input-completeness proof, the cross-machine
  fingerprint feed, `--verify-allow`, the verdict vocabulary and the
  telemetry fields. The input half could only work by ENCLOSING a task
  in the OS sandbox, which means guessing right about everything a task
  might legitimately do — three separate fixes today and it still broke
  the docs-site build. Watch-only observation would not have that
  problem, but the runtime cannot do it: no dry-run, no report-only, no
  audit mode, and its violation model is denial-based. macOS has no
  usable alternative either (`sandbox-exec` has no trace flag here, the
  `(trace)` directive emits nothing, and everything else needs root or
  an entitlement). Determinism and fingerprint needed no sandbox, but
  the owner's call was to remove the feature whole rather than keep a
  flag that means part of what it says. Users get isolation by
  declaring `sandbox` on a task instead. Removed: 174 lines of
  orchestrator code, an 861-line suite, two design documents, the CLI
  flags, the scheduler's verdict types, and the verify prose across the
  docs and site guides. What survives is the sandbox itself, plus
  today's three fixes to it, which `sandbox: {}` still needs.
  NOTE: dated design documents still mention `--verify` as history;
  they are records of decisions, not current documentation.

- **`vx <verb> --help` works (2026-09-04).** It did not, for any verb:
  the first thing a user types answered `unknown flag: --help` and
  exited 1. Core verbs now print the reference and exit 0; args past a
  `--` still belong to the task, and plugin verbs still own their own.
  Pinned across every verb in the dispatcher. Every argument error now
  ends with `(see \`vx <verb> --help\`)`— there was nowhere to send a
user before — and`bin.ts`no longer prints`vx: vx why: …`, since it
owns the `vx: ` prefix and six messages already named the tool.
- **`vx migrate` walkthroughs, both sources (2026-09-04).** Turbo:
  clean on a realistic `turbo.json` — global fields become the
  imported `vx-preset.ts`, `dist/**` outputs and `env` survive, the
  root task `//#format` is reported as unmigratable, and the warm run
  is all up-to-date. Nx: correct from the resolved graph, but a
  dev-server executor became an ORDINARY task, so `vx run serve` would
  wait forever for an exit that never comes — while the turbo path
  (`persistent: true`) and the scripts path (the task name) both got it
  right. One rule now in `migrate-persistent.ts`, imported by all
  three: a known executor is authoritative about lifetime, anything
  else falls back to the name. Pinned differentially.
- **`@vzn/vx-turbo-cache` and `@vzn/vx-nx-cache` (owner's ask,
  2026-09-04).** Two zero-dependency `cache` plugins over the seam
  recipe, each against the OFFICIAL self-hosted API read from its spec:
  Turbo's `/v8/artifacts` (Bearer, `teamId`/`slug`, HEAD/GET/PUT, the
  batch POST for `hasMany`, `x-artifact-duration`, and the v2 artifact
  signature — HMAC-SHA256 over length-prefixed prefix/hash/team/body,
  base64 in `x-artifact-tag`, key ≥ 32 bytes raw, transcribed from
  `signature_authentication.rs`) and Nx's `/v1/cache/{hash}` (GET/PUT,
  Bearer, 404 miss, 409 = immutable record = done, 401/403). Nothing on
  by default: declared explicitly, options over the tools' own env
  vars, decline when unconfigured; a refused token warns once and turns
  the layer off. Each suite drives a strict in-memory server for its
  spec and a full `vx run` round trip (miss → upload → local wipe →
  `cache-hit-remote`): 8 + 6 tests. The wire is theirs; the artifacts
  are vx's. NOTE for the owner: no plugin package is on npm yet — the
  publish workflow ships core and the four platform packages only.
- **CI's Bun is pinned to 1.4.0 (2026-09-04).** The runners installed
  `latest` and Bun 1.4.1 landed under the fix above, breaking three
  things in one run: the darwin-x64 cross-compile in the site build
  (`bun-darwin-x64-v1.4.1 is not available for download` — 1.4.1's
  target binaries were not published yet), the descriptor tripwire on
  macOS (1.4.1 measured exactly 0 pins for 40 imports — the leak is
  fixed; the pin now reads both sides of the boundary and the isolate
  hint can go once the minimum Bun is 1.4.1), and the ubuntu job's
  diagnostic `bun -e` step, which prints the probe's verdict and waits
  for exit — the probe now initializes SRT on Linux, whose sockets kept
  the process alive to the 10-minute timeout (step exits explicitly;
  the probe's doc says so). Pinned in `ci.yml`, `docs.yml`, `npm.yml`;
  bump deliberately, with the gate.

**The sandbox becomes one capability interface (2026-09-05).** `sandbox`
moved under `exec` and stopped mirroring SRT's config: `allow` / `deny` /
`ignore` share one shape (`read`, `write`, `network`, `systemInfo`,
`unixSockets`, `localBinding`, `machLookup`, `pty`, `gitConfig`), and vx
translates it per platform. Every task in all eight projects now declares
one, with a single documented exception (below).

- **Cache no longer feeds the sandbox.** `cache.inputs` says what
  INVALIDATES a task, `allow` says what it may TOUCH; deriving one from
  the other widened the sandbox silently in one direction and forced
  paths through the cache key in the other. The only grant core still
  makes is dependencies — `node_modules` plus the real path of every
  workspace package symlinked there, so no project names a sibling to
  import what its `package.json` already depends on.
- **Enforce at the workspace root, report inside the project.** A task
  never leaves its project; being stopped at that wall is not a finding
  (every process walks `/` down to its cwd). Only denials on the
  project's own files are reported — those are the ones that make a
  cache key wrong.
- **Three visibility bugs, one report.** The live/focused frame never
  rendered the section (`violationSection` is now shared with the
  buffered renderer, unique lines verbatim, red header); the macOS
  settle window was removed (owner call — it cost 300 ms on EVERY clean
  sandboxed task against 26 ms for one that reports, and the store is
  lossy either way); `localBinding` / `unixSockets` / `machLookup` /
  `systemInfo` never reached the profile at all — SRT 0.0.75 reads the
  first three off `initialize()`'s config, never the per-call one, and
  has no field for the fourth. vx now appends the SBPL rules to the END
  of the seatbelt profile, the only position where last-match-wins puts
  a rule of ours above SRT's.
- **macOS cannot nest, proven.** An inner `sandbox-exec` with
  `(allow default)` still dies `sandbox_apply: Operation not permitted`
  (exit 71). `@vzn/vx#test.bun.shard-*` is therefore the one task in the
  repo with no sandbox block — its suite spawns sandboxes. Pinned by a
  test so the day macOS or SRT lifts it, the gate says so.
- **Globs in grants, per platform.** macOS passes the pattern into the
  policy (matches files created during the run); Linux expands it at task
  start, because a grant there is a mount. `<d>/**` and `<d>/**/*`
  collapse to `<d>` on both — without that, `read: ['**/*']` could not
  list its own cwd. A read grant that is an ANCESTOR of a write grant is
  punched into its children on Linux, where bwrap's ro-bind would
  otherwise shadow the write.
- **`network` domain lists were never enforced either, and cannot be
  per-task.** SRT runs ONE filtering proxy per run and checks every
  request against `initialize()`'s allowlist, so a per-task list silently
  allowed nothing (`vx run build` on a cold CI runner could not download
  its cross-compile target: `Network error … check your proxy settings`).
  `run()` now arms the proxy with the union of every domain any sandboxed
  task declared. Per-task enforcement survives where it counts: a task
  that declares none is never handed the proxy's port.
- **The report filters were seatbelt-only.** They parsed
  `deny(1) <op> <path>` and nothing else, so on Linux every strace-shaped
  denial skipped both the project scope and `ignore` — CI reported the
  workspace-root `package.json` as a finding and two tests failed for the
  same reason. Producers now describe their own records (`target`,
  `path`, which `ignore` lists apply) and `reportableViolations` is one
  exported, platform-free function with tests driving both shapes.
- **A `~` write grant created a literal `~` directory in the project.**
  Write grants are pre-created because bwrap cannot bind a path that does
  not exist, but only the ones the project owns; absolute and `~` grants
  are the user's own. Differential test.
- **Two configs were wrong and are fixed.** `lint.oxfmt.fix` carried a
  build task's grants (`write: ['dist/vx-darwin-arm64']`) and could not
  rewrite a single file; the prune install test staged into the host's
  TMPDIR and cached under HOME, and is now hermetic inside the subset it
  emits.

**Every project under `packages/`, and every task sandboxed (2026-09-05).**
`bench/`, `apps/docs/` and `docs/` were top-level trees that code lived in
and no project owned; they are `packages/vx-bench`, `packages/vx-docs` and
`packages/vx/docs` now, `scripts/build-npm.ts` moved under
`packages/vx/scripts`, and `workspaces` is just `packages/*`. 33 exec
tasks across 9 projects declare `exec.sandbox`; `@vzn/vx#test.bun.unsafe`
is the only one that does not, and it is named for the reason.

- **A permission is the last resort, not the first.** Four suites failed
  sandboxed and three needed no grant at all: the remote-cache stub and
  the upgrade downloader bound localhost ports, and now use an in-process
  `Request → Response` handler and a stubbed `fetch`; the doc-drift and
  boundary tests read the workspace, and follow their subject
  (`packages/vx/docs`) or move to the unsafe suite; the `cli -h` test ran
  `run()` against this repo and wrote `.vx/cache`, and now builds a
  throwaway workspace. Only `machLookup: ['com.apple.FSEvents']` was
  granted, by the owner, after the alternative shipped.
- **`vx watch` polls when the OS will not talk.** `fs.watch` on macOS is
  FSEvents; inside a sandbox without that mach-lookup the call SUCCEEDS
  and never fires — measured, 0 events recursive and 0 plain against 3
  and 2 for the same writes outside, while `watchFile` polling delivered
  in both. The loop already probed for delivery; a failed probe now swaps
  in `pollWatcher` instead of only warning, and `VX_WATCH_POLL=1` forces
  it. Network mounts and container binds fail the same way.
- **macOS cannot nest a sandbox, so `probeSandbox` says so.** An inner
  `sandbox-exec` with `(allow default)` still dies `sandbox_apply:
Operation not permitted` (exit 71). The probe answered `available:
true` inside a sandbox, which is how a suite that exercises the sandbox
  came to fail sixteen ways at once. `tests/*.unsafe.test.ts` is that
  suite plus the cross-project law; the shards exclude it with
  `--path-ignore-patterns` and `test.bun.unsafe` runs it.
- **Exposing a port from a sandboxed task: macOS yes, Linux not yet.**
  Measured — a sandboxed server on macOS is reachable from a DIFFERENT
  sandboxed task (200), and refused when that consumer has no
  `localBinding`. On Linux every sandboxed task gets its own netns
  (`--unshare-net` whenever a network config exists, which vx always
  sends), so nothing sees the port. Opening the netns works but costs
  full egress; the narrow answer is a per-port unix-socket bridge, which
  is blocked today because SRT reads `allowUnixSockets` off the config
  given to `initialize()` and never the per-call one. Unfinished.
- **Two bugs the move surfaced.** `${REPOSITORY}` interpolated an object,
  so every published platform README link, `homepage` and `bugs` URL said
  `[object Object]` — `scripts/` had never been under a tsconfig. And a
  LayeredCache test asserted a background upload had started after a
  fixed 20 ms, which a loaded gate does not respect; it waits on the
  condition now.

**Review pass (2026-09-09, a fresh session over the whole tree).** What
the previous sessions left claiming more than the code did, fixed in
place with pins:

- The local executor and cache became core's floor on 2026-09-05
  (d664ca5) and the docs never followed. The quickstart, the
  introduction, every plugin README and six site guides imported the
  removed local-executor and local-cache subpaths, so the first thing
  a new user hit was an unresolved import. Every page, every plugin
  doc comment, CLAUDE.md's layout and principle 7, and the vx init
  template now say what plugin-host.ts does: the local executor is
  the tail of every executor list, the local store the tail of every
  cache chain.
- The bench package did not run. run.ts and compare.ts resolved the
  repo root one level short after the move under packages/, so every
  bench spawned packages/packages/vx/src/bin.ts. Nothing had measured
  the warm run since the move. Fixed; the site check still passes.
- The plugin packages were never type-checked. Their lint was the bare
  linter and the test runner is transpile-only. All seven now lint
  with the type-aware and type-check flags, which found the otel and
  github plugins still reading the verify and outputFp telemetry
  fields removed with the verify feature, tests passing run-option
  fields that do not exist (all, colors), the nx-cache put method
  implementing the seam with one argument fewer, and the bench's
  schedule-policy script importing the deleted predict module
  (removed; its markdown stays as the record).
- The docs site's tests ran nowhere (no task, not in CI's package job)
  and both failed when run: the guide pin looked for oxlint in the
  wrong node_modules, walked a symlinked node_modules for minutes, and
  lacked the type-check flag (it accepted a string assigned to a
  number); the sidebar pin counted hand-authored pages as generated.
  With the check real the plugins guide had thirteen type errors. The
  docs project's test task is under its ci group now.
- Two stale-hit holes, both pinned differentially. (1) continue=always
  saved a dependent built on a failed upstream's partial outputs under
  the healthy key; the doc called it sound because the KEY is, but the
  bytes were not. Reproduced end to end: the second run restored the
  dependent's output holding the partial file of the failed run. A
  task behind a failure, directly or through successes built on it,
  runs but never saves (taintedUpstream on the execute args); a hit
  still restores. (2) The config purity gate matched Function as an
  identifier only, so reaching it through the constructor property,
  with the impure body inside a string literal the strip removes, was
  cached as pure. constructor and localeCompare (host locale) are
  refused now.
- Words that claimed too much. The landing page still sold the verify
  flag; the sandboxing guide told the reader to let verify=inputs
  arbitrate; the OTel guide described a fingerprint attribute the
  plugin no longer emits; four design documents cited from source do
  not exist; execute-task.ts explained a sandbox read as a proof
  failure reported via the verdict; vx info recommended fsmonitor as
  making the status walk near-free while this file records the A/B
  that refuted it; vx why on a task with no cache block said the entry
  was pruned when there never was one; cli.md filed the download flag
  under vx why and the continue flag under the programmatic API. All
  corrected; the eighteen docs links in the root README point under
  packages/ again.
- Perf, profiled rather than guessed (bun's cpu profiler plus the
  bench's profile-summary script, 1000 projects warm, this 4-core
  box): native stat is 21% of self time; the package graph's
  transitive bitset closures cost 12 ms, built eagerly for both
  directions and read by nobody on an unscoped run; 1,000 SQLite point
  reads identifying config closures cost 7.7 ms; two awaited empty
  runtime-input resolutions per task cost 3 ms. Closures are lazy, the
  expansion is skipped once every project is seeded, a batched
  hashFiles identifies a closure list with one query per 500 paths,
  and a task with no runtime inputs skips the fan-out. Interleaved A/B
  against an immutable worktree, 12 reps: min 319 to 299 ms, median
  340 to 323; stage table, min of 6: open cache 20.2 to 8.8 ms, load
  configs 34.6 to 23.2 ms. The docs site's Markdown stays outside
  oxfmt on purpose (restored in the root ignore list): the formatter
  rewrites code fragments in prose into multi-line objects, and moves
  spaces into inline code spans at wrap points, which is also why this
  entry carries no inline code.
- Two warm-path costs the profile put on the hit path and on the
  record stage, both taken the same day. (1) The up-to-date proof of a
  hit stat'ed its recorded directories and output files through the
  promise API, one thread-pool round trip each, and the scheduler's
  concurrency is the worker count, so 1,000 hits on four workers
  serialized those round trips: the run graph stage was 100 ms of a
  175 ms run. A wider admission for the restore tier was probed first
  and refuted (32 ties, 128 is worse): the cost was per-task CPU, not
  waiting. Synchronous stat for the handful of paths a hit checks
  (the 2026-09-02 measurement that chose the async form predates the
  directory short-circuit, when a hit walked its whole tree): run
  graph 100 to 54 ms, whole process 422 to 368 ms interleaved. The
  artifact-existence probes on the entry reads went the same way
  (1,000 probes: 7.5 to 2.9 ms). (2) The record stage wrote each run's
  1,000 rows through a (project, task) index, and every pair's entries
  sit on their own B-tree leaf once the table holds a few hundred runs
  per pair, so each insert dirtied a page: 57 to 79 ms at 166k rows
  against 14 to 19 ms without it, and growing with the table. A page
  cache four times larger and mmap were both measured as no help. The
  index served the history reader, and that reader was measured at 550
  ms for a full 1,000-pair set with the index or without (the ranking
  window sorts the pairs' rows either way). Both dropped, with the
  ended-at index that only the retention prune read: the reader now
  aggregates one rowid slice covering the last N invocations (rows are
  appended one contiguous block per invocation, so no sort, no
  ranking), 550 to 50 ms at window 50, and the schedule-history plugin
  reads the 20-invocation window its doc always claimed. The
  flakiness signal comes from the same window, keyed on one shared
  SQL fragment with the all-time query vx why uses. vx why on an exact
  id probes newest-first and stops at the first row. Whole-process
  A/B at 1,000 projects with a 166k-row history, each arm on its own
  workspace copy (the arms fight over one database: HEAD recreates
  the index every run and the new code drops it), both orders, 10
  reps: min 418 to 334 ms, median 443 to 355; the other order 441 to
  340 and 540 to 386. Restore and cold runs tie both ways. The bench
  harness cannot see the second half (it starts from an empty history
  table) and its rows swing 15% between reps on this box, so its
  figures are not the record here.
- A stale-hit hole in input resolution, found reviewing inputs.ts
  against a probe: a tracked symlink to a directory, or a dangling
  link, fell out of the input set entirely, because the existence probe
  asked Bun.file(p).exists(), which answers false for both. Retargeting
  the link — a change git reports as modified — replayed the old
  artifact; so did committing the retarget. A link to a file folded
  the bytes BEHIND it instead, which for a target outside the project
  folded a change that git diff and --affected cannot see. Symlinks
  fold as git folds them now: the blob of the target string, the
  mode-120000 index OID, so a clean link's OID is trusted like a
  file's and the fallback (lstat + readlink) computes the identical
  value; the probe is an lstat that admits files and links and refuses
  directories (a gitlink's path). Pinned: hashFile of a file, directory
  and dangling link equals the index OID and differs from the target's
  content; retargeting a tracked directory link moves the key dirty
  and committed, dangling is its own state, and the bytes behind a
  directory link are not inputs (git parity — declare them with
  workspaceFiles). Key-derivation fix, old keys were wrong for those
  projects only, self-healing, no CACHE_VERSION bump. The warm path
  ties (a clean tree reaches neither the probe nor the fallback):
  interleaved both orders, 8 reps, within the box's noise either way.
- The public schema's own comments, read against the loader and the
  graph builder: cache on a persistent task is rejected, not silently
  ignored; a persistent task's sandbox is enforced, not silently
  skipped; overlapping workspace outputs are refused at graph build,
  not left unpoliced; the plugins field cited a design document that
  does not exist. schema.md carried the unpoliced claim too. The
  plugin host's graph-stage comment blamed the last plugin as the one
  whose edit broke the graph; the check runs once after all of them.

## Improvement loop (2026-09-09, after the review pass merged)

Open-ended, owner-delegated: find flaws, widen seams, sharpen DX,
refactor toward cleaner layers. One coherent commit per step, gated,
recorded here as it lands. Layer map measured first (imports between
`src/<module>` directories): util ← workspace ← cache, exec ← graph ←
orchestrator ← cli, `config.ts` a leaf, no back edges — the boundaries
test is telling the truth.

1. DONE: the `project` stage reaches config-less packages (Next 3's
   seam gap). Zero cost without a `project` plugin: the `configPath`
   filter is unchanged there, so nothing new is loaded, fenced or
   seeded.
2. DONE: one near-miss rule. A DX probe through the CLI's typo paths
   found five copies of "within two edits" (task names, `pkg#task`
   halves, project filters, flags, verbs) and two verbs (`why`, `prune`)
   on a substring rule that found nothing for `vx why buld`; `vx run`'s
   hint also repeated itself when two typos pointed at one spec
   (`Did you mean app#build, app#build?`, pinned as-is). `nearest` /
   `nearMatches` in util are the rule now; every surface calls them,
   `why` matches a bare query against the task half and hints the
   runnable id, hints are deduped. The probe's other answers were
   right: scope errors before name errors at the root, `--cache` /
   `--continue` / `--concurrency` values refused by name.
3. DONE: cache.ts split by concern, pure moves. The file was 2,640
   lines, a thousand of them the contract and its records before the
   class began. `layer.ts` holds the contract (`CacheLayer` and every
   shape that crosses it), `policy.ts` the run-policy grammar, `zstd.ts`
   the artifact framing; cache.ts keeps the schema, the store and the SQL
   binders (1,850 lines) and re-exports the three, so no importer moved.
   The one reference from the contract to the implementation (`local?:
Cache`, the handle a layer may wrap) is a type import. Next candidate
   inside the class, not taken yet: the file-hash memo, the output
   fingerprints and the run history are each a cohesive slice over the
   same handle — a composition split, behaviour-preserving, when the
   class next needs touching. Warm path: a tie (interleaved against
   main, both orders, 8 reps: 216/231 vs 216/229 ms, 218/224 vs
   212/223), as three more module evaluations should be.
4. DONE: the first-run walkthrough, repeated on a fresh Bun workspace
   (two packages with scripts, no vx files). What held: the pre-init
   run names `vx init`; init's dry run and report; the generated
   config's TODO for the cache block; `show`, `info`, `last`. Two
   things did not. `vx init` reported itself as `vx migrate` — on the
   terminal and in the generated file's banner — because init is
   migrate with the scripts source; both say the verb the user typed
   now. And `vx why` on an UNCACHED task headlined "cache key changed
   between the previous run and this one (inputs differ)": the task
   has no cache block, so its key exists only for dependents to fold,
   and with no declared outputs its own `out.txt` lands in the default
   `**/*` input set and moves the key every run. The runs row could
   not tell an uncached task from a miss, so `runs.cached` records it
   (SCHEMA v25, analytics-only, key unchanged): `why` says the task
   declares no cache block, the fingerprint-unavailable note names
   pruning only when that is what happened, and `vx last` marks such
   rows `no-cache` the way the terminal summary already did. Pinned
   end to end for both; the walkthrough's remaining rough edge — a
   fresh workspace with no `.gitignore` folds `dist/` into every
   default input set until the user ignores it — is git's model, not a
   bug, and the TODO comment already tells the user to declare outputs.
5. DONE: the Linux gate no longer depends on apt sources it never
   uses. Two heads went red before any vx step ran: `apt-get update`
   exited 100 on a hash-sum mismatch from the runner image's Chrome
   repository. The step drops every source but Ubuntu's own first.
6. DONE: `@vzn/vx-turbo`, the zero-migration plugin the widened
   `project` stage was for (Next 3). The Turbo mapper left the CLI for
   `workspace/turbo.ts` — `cli/migrate-turbo.ts` is the renderer now,
   120 lines over a shared mapping the migrate suite proves unchanged
   — and the plugin is one `project` hook over it. Two things the
   first pins taught: the stage hands core an object it edits in place
   and the mapping outlives a run, so each fill is a copy; and a
   fixture without a `.gitignore` folds `dist/` into a sibling task's
   default inputs, the same finding as the walkthrough's.
   NOT its Nx twin, decided the same day: the Nx mapper reads a
   generated project-graph snapshot (`.nx/workspace-data/`), so it is
   not zero-setup, and every executor-backed target maps to a
   placeholder command that exits 1 — under a live plugin that is a
   run that fails by design, not a repo that runs. `vx migrate --from
nx` stays the Nx path.
7. DONE: the miss path's two output passes glob synchronously. A cold
   1,000-task run here (4 workers) spends, per task-slot, execute 4.7
   ms, save 1.8, clean outputs 0.83, resolve outputs 0.59 — the last
   two a glob over a one-file `dist/`, run through the async walker
   that was chosen on 2026-09-02 for the HIT path, which no longer
   globs. Synchronous, interleaved against the previous head on private
   workspace copies, 3 cold reps each order: min 2586 → 2467 ms and
   2830 → 2733, median 2699 → 2577 and 2831 → 2779; the restore path
   (which still globs after a wiped output) 814/942 → 798/870 and
   964/990 → 915/948, so no regression where the async form was meant
   to win. What is left on a cold slot is the shell and the process
   (execute) and the artifact save; the save's five spans are each
   under 0.6 ms.
8. DONE: `Cache` composed from four slices, behaviour-preserving. A map
   of every method to the private fields it touches showed the class
   was four stores sharing one handle: file hashes (two statements,
   the object format), config evaluations (two statements, the
   read/write axes), the output index (four statements), the run
   history (two statements, the binders). Each is its own class over
   the same `Database`, owning its statements; `Cache` keeps the
   schema — the one place every table is declared — the entry store,
   and thin delegates, so the `CacheLayer` contract and every importer
   are unchanged, and the save transaction still writes an entry and
   its output rows together (`OutputIndex.replaceFileRows` inside it).
   cache.ts 1,850 → 1,330 lines; the slices 260 / 90 / 210 / 150. Warm
   path ties both orders (211/219 vs 212/221, 218/222 vs 217/220).
9. DONE: a config that fails to PARSE names its file, line and column.
   A DX probe over broken configs: unknown field, `dependsOn` typo,
   `cache` without inputs, unresolved import, runtime throw — all name
   the file. The one that did not was a syntax error: `vx: Expected "}"
but found end of file`, nothing else, because Bun's `BuildMessage`
   keeps the location in `position`, not in the message, and the loader
   only rewrapped `ResolveMessage`. `configLoadError` now rewraps both;
   the file comes from the position (a preset the config imports fails
   the same way and is named as `config (in preset:line:col)`), and the
   config worker forwards the position so the repeat path — the second
   `vx watch` cycle — reports the same text as the first. Refuted on
   the way: the probe's "package silently dropped on a missing import"
   was the probe. A `.ts` config with an UNUSED import of a missing
   module loads fine because TypeScript elides unused imports, and
   that config declared `tasks: {}`, so "1 affected · 2 total" was
   correct. A used import of a missing module fails loud, as pinned.
10. DONE: `run()` composed from two more phase modules, behaviour-
    preserving. The 900-line body had two self-contained blocks that
    read as their own concerns: what a finished run leaves behind
    (`run-records.ts`: one pass over the outcomes builds the `runs`
    rows, the `invocations` header and the telemetry mirror, so the
    three task counts agree by construction) and the end-of-run
    disposition of persistent children (`persistent.ts`:
    `selectKeepAlive` + bounded `shutdownPersistent`). run.ts
    1,303 → 1,167 lines; the record and persistent suites pass
    unchanged. Warm path ties in both orders (min 296/296, 286/286;
    med 321/328, 294/299 ms on the 1000-project workspace).
11. DONE: `vx show` sees what a run sees. The verb documented itself
    as "what a live run would see", then read config files raw: under
    `@vzn/vx-turbo` it printed `(no vx config)` for a package `vx run`
    runs, and it hid `retries`, `env`, `remote`, `resources`,
    `sandbox`, workspace inputs and runtime probes. The staged load
    (config-less packages under a `project` plugin, seeds + closure,
    rounds to a fixpoint, lock or live, eval cache, the `project`
    stage + re-validation) moved out of `prepareRun` into
    `orchestrator/projects.ts:loadProjects`; `prepareRun`, `show` and
    `info`'s task count all call it, and `loadWorkspacePlugins` owns
    the `config` stage the same way. `show` gained the bare `<task>` form (every project
    declaring it), prints every field the run reads, and suggests by
    edit distance as well as partial name. Found on the way and
    fixed: the Turbo mapper listed a workspace file twice when both
    `globalDependencies` and a task's `$TURBO_ROOT$/` input named it
    (the same for an env name in `globalEnv` and a task `env`). Strings
    the mapper can see are listed once; the `vx migrate` renderer's
    opaque preset spread stays as written, so a generated config can
    still repeat one — the user's file to tidy.
12. DONE: the `config` stage reaches every verb. The stage is documented
    to shape `cacheDir`, and `vx run` honoured that — while `vx last`,
    `vx why`, `vx cache prune`, `vx watch` and plugin verbs resolved
    the directory from the raw file, so a plugin that moved the cache
    left `last` with no runs and `prune` pruning nothing (the very
    no-op the prune code's own comment warned about). One CLI loader
    (`cli/workspace-config.ts:loadCliWorkspace`) applies the stage
    and derives the directory from the result; every verb goes
    through it. Pinned end to end with a plugin that moves the cache:
    `last`, `why`, `info` and `prune` all find the run.
13. DONE: CI red on d295a90 was `tests/cache-hash-files.test.ts`, not
    the diff: the racy-window pin wrote a file and asserted no memo row,
    which holds only if both hash calls finish inside the 50 ms window —
    and the first miss in a store spawns `git rev-parse` for the object
    format. 417 ms on the loaded ubuntu job, row memoised. The pin now
    warms that spawn on an aged file and asserts only on an attempt the
    clock proves stayed inside the window, retrying with a fresh file
    otherwise; a runner that never manages it fails loudly.
14. DONE: the `vx watch` sweep sees what a run sees. It read config
    files raw for the outputs to ignore and the workspace-wide
    decision, so under a `project` plugin a config-less package's
    `dist/**` was an edit (one wasted cycle, the content check caught
    the second) and its `workspaceFiles` input did not widen the
    watch. `sweepConfigs` now calls `loadProjects` — the fourth
    consumer after prepareRun, show and info — with the eval cache, so
    the sweep's repeat loads of pure configs hit instead of paying a
    worker each; a load that fails drops to the raw per-file sweep it
    had before.
15. DONE: the last two raw config reads in the CLI went through the
    staged load too — `--affected`'s orphan-path owners (a
    `workspaceFiles` glob a `project` plugin gave a config-less
    package now selects it; before, an edit under that glob selected
    nothing) and the interactive picker's menu. The four copies of
    "open the cache, load the staged projects, close" collapsed into
    `cli/workspace-config.ts:loadCliProjects`; `lock.ts` stays raw on
    purpose — it freezes the file's own evaluation, and the stage runs
    on top of the frozen config at run time. The owners read live now
    (they preferred the lock when present, which a default run never
    consults); the eval cache makes live as cheap.
16. DONE: the sandbox request assembly (`sandboxRequestFor`, the
    workspace-link scan, the bind pre-creation) moved out of
    execute-task.ts into `orchestrator/sandbox-request.ts`, pure code
    motion: none of it touches a key or a save, and nothing outside the
    file referenced it. execute-task.ts 1,074 → 932 lines. The
    remaining body is the cached path, whose save block is the next
    candidate — it is stale-hit-critical, so it moves only with the
    execute suites and the unsafe suite green on CI.
17. DONE: two claims the code lacked, de-claimed. `frozenProjectConfig`'s
    doc comment promised a content-hash tripwire and a hard error on a
    changed file; its body skips both on purpose (owner, 2026-06-13),
    and `docs/modules/lockfile.md` repeated the promise ("hash
    tripwire", "stale file is a hard UserError"). A DX probe ran an
    edited config as locked under `--frozen` with no word — which IS
    the contract (`lock --check` is the audit; pinned in lock.test.ts),
    so the words moved, not the code. CLAUDE.md still named
    `--verify=inputs`, removed 2026-09-04; it now names the sandbox as
    the way a task proves what it touches.
18. DONE: a cache block whose globs match nothing is said out loud. A
    DX probe: `inputs.files: ['nope/**']` cached silently (the key
    never moves with the source — the quiet stale hit), and
    `outputs.files: ['out/**']` on a task that wrote nothing saved an
    empty artifact silently (a later hit "restores" a build that ran
    nowhere). Both are now one status line on the miss that saved,
    naming the task and the globs; a hit says nothing, `outputs: []`
    (the deliberate cached no-op) says nothing, and the warm path is
    untouched — the miss path already held both resolved lists.
19. DONE: sandbox-runtime.ts (1,318 lines, the largest file) split by
    concern, pure code motion: `sandbox-violations.ts` (the strace
    pass, the seatbelt record description, the report filters),
    `sandbox-binds.ts` (bwrap-honourable write grants, read-grant
    punching, the SRT custom config) and `sandbox-paths.ts` (the four
    path helpers all three share). runtime keeps probe, init, config
    resolution and the spawn: 844 lines. The sandbox suite cannot run
    here (no bwrap: 20 pass, 25 skip locally), so CI's
    `VX_REQUIRE_SANDBOX=1` job is the arbiter for this one.
20. DONE: `vx.workspace.ts` refuses an unknown top-level field. The
    project levels have rejected unknown keys since the review pass;
    the workspace validator checked its four fields and let anything
    else through, so `plugin: [...]` (singular) declared no plugins and
    ran the workspace bare, and `cacheDirectory` left the cache where
    it was — a file that loads and quietly does nothing it says. Same
    `assertKnownFields`, which now also names the nearest accepted
    spelling at every level (`did you mean plugins?`); pinned in the
    schema-doc drift table.
21. DONE: the project config's top level too. `task:` (singular) loaded
    as a project with no tasks — `vx show` said "(no tasks declared)",
    `vx run build` said "no projects declare" — and the loader's
    `assertKnownFields` had covered every level below it. Now
    `has unknown field "task" — did you mean tasks?`.
22. DONE: two flag probes. `--continue never` read `never` as a second
    TASK and failed with "No projects declare task(s): never" — true
    and useless; the space form is now refused naming the `=` form.
    `--retries` got no hint because `--retry` is three edits away (the
    `i`/`y`), one past the usual budget; a third edit is now allowed
    between flags sharing their first five characters. Two probes
    refuted on the way: `--retries` is NOT a prefix of `--retry` (a
    prefix rule was written and thrown out), and a plain three-edit
    budget hinted `--all` for `--zzz` (the existing pin caught it).
23. DONE: a plugin-authoring probe, four quiet failures. A `cache` or
    `executor` hook returning junk failed every task with an internal
    TypeError deep in the chain (`this.layers[0].key is not a
function`); the seam now checks the returned shape once and refuses
    by plugin and hook. A `project` edit that broke a task was refused
    "(after plugins)" — which one? — so the stage re-validates after
    each plugin and names it. Two plugins declaring the same verb ran
    the first and hid the second; a plugin naming a core verb loaded
    fine and sat dead (a pin even asserted it "never runs"). Both are
    refused wherever the workspace loads — every core verb that opens
    it, and the plugin-verb lookup, which reports why it could not
    finish — naming the plugins and the verb; the pin now asserts the
    refusal (`help` and `version` never load the workspace).
24. DONE: the same probe over the remaining stages. `key` returning a
    string folded its CHARACTERS into every cache key as parts named
    '0', '1', '2' (`Object.entries` over a string) — silent and
    permanent; `schedule` returning a string was a silent no-op (its
    characters matched no task); a telemetry hook returning `{}` was a
    valid sink that heard nothing. Non-record and non-Map returns are
    refused by plugin and stage; a sink with no handler is disabled
    with the same warning a throwing hook gets. `graph` was already
    right: a missing edge target and a cycle both name the plugin. The
    plugins guide gained a "What core refuses" list for items 23–24.
    Checked against the shipped plugins, since the REAPI suite cannot
    run here: every `cache` hook returns a `LayeredCache` (key, get,
    has, save, close all present) and the REAPI executor is named
    (`vx/reapi`) with `execute` — the shape checks refuse none of them.
25. DONE: `cli/run.ts` composed: what a run is asked to run (the
    `--filter` resolution, `--affected`'s orphan owners, the cwd
    project, the interactive picker) is `cli/select.ts`; run.ts keeps
    argument parsing, option resolution, the verb and the summary
    (837 → 659 lines). Pure code motion. Day-end warm A/B against
    main (c0b20ca), 1000 projects, interleaved both orders: min
    296/304 and 302/295, med 310/313 and 325/320; at 20 reps 310/313.
    Within this box's run-to-run jitter (the baseline itself moved
    296 → 310 between runs) and no `VX_TIMING` stage moved.
26. DONE: the cached path's save block is `orchestrator/miss-save.ts`
    (`saveMiss`), pure code motion: resolve outputs → the empty-set
    warning → `cache.save` → `recordOutputDirs` → the git marks.
    execute-task.ts 932 → 892 lines; the whole gate passed unchanged.
    Cold A/B (the path it sits on), 1000 tasks, both orders, min of 4:
    3592 → 3490 ms and 3518 → 3701 — mixed by ±200 on a 3.5 s run,
    i.e. a tie inside the cold path's noise on this box.
27. DONE: `@vzn/vx-mcp` gains `listTasks` — "what can I run here?" —
    the one tool over configs rather than the cache: every project and
    the tasks a run would see (command, `dependsOn`, cached,
    persistent), resolved like `vx run` resolves them. It reads through
    a new façade export, `loadResolvedProjects` (discovery, the
    `config` and `project` stages, cached evaluations served), the same
    view `vx show` prints; an embedder's task catalog is the other
    consumer. The façade pin gained the name.
28. DONE: `vx init` on a Turbo (or Nx) repo names the config it did
    not read. A probe on the Turbo fixture: `init` generated the
    scripts' configs with their TODOs and said nothing about the
    `dependsOn` / `inputs` / `outputs` that `turbo.json` already
    declares one directory up. It now prints one note naming both ways
    to use it (`vx migrate`, `plugins: [turbo()]`); `migrate` itself
    auto-detects, so the note is `init`-only (control pinned). Also
    probed and found right: `vx lock` / `--frozen` / `lock --check`
    under `@vzn/vx-turbo` — the lock records nothing for a config-less
    package and the plugin maps live under `--frozen`; the README now
    says so. Left alone by 8(d)'s rule: `logger.ts` is one 550-line
    terminal renderer and `framed-output.ts` one formatting concern —
    no seam to cut. A number for item 11's other half: `vx show` on
    the 1000-project workspace, main vs head, both orders, min of 8:
    209 → 141 ms and 197 → 129 — the staged load serves cached
    evaluations where the raw path evaluated every config.
29. DONE: probes that confirmed what is pinned, and one stale comment.
    A plugin `key` part is named in `vx why` (`plugin tool/node-major`,
    digest → digest — values are reduced to digests on purpose, the
    rows persist); `@vzn/vx-turbo` warns its mapping gaps on `run` and
    `show` alike; a reservation over the budget is admitted alone
    (schema.md § resources, scheduler.ts). The run.ts comment on
    resource costs still named the percent form removed 2026-08-30;
    it now points at resources.ts instead.
30. DONE: the plugin-verb refusal (item 23) moved from the CLI loader
    into `validateWorkspace`: `vx run` never went through the CLI
    loader, so a shadowing verb was refused by `vx show` and not by
    the run — half a rule. The core verb list moved to
    `util/verbs.ts` (the workspace module cannot import cli); the two
    messages joined the schema-doc drift table, and the pin now
    asserts `vx run` refuses too.
31. DONE: the scaffolded `vx.workspace.ts` no longer imports core at
    runtime. `import { defineWorkspace } from '@vzn/vx'` — an identity
    function — loaded a SECOND copy of core into every run: on the
    two-package walkthrough workspace the `workspace config` stage
    read 27–33 ms with it and 10–13 ms without, the whole run 81–100 →
    65–74 ms (6 runs each). The 1000-project bench never saw it: its
    workspace file exports a plain object. `vx init` / `vx migrate`
    now write `import type { WorkspaceConfig }` + `satisfies`, the form
    the project configs already used; schema.md, the config module doc
    and the quickstart say what the helpers cost. Next-list item 4
    (the binary's second core) is thereby paid by no default scaffold;
    a workspace that declares plugins still loads their packages.
    Refuted on the way: the stage's remaining 11–12 ms is not the
    config — `loadWorkspace` + `loadWorkspaceConfig` measure 1.8 ms in
    isolation; the stage also holds the early `git ls-files` spawn.
32. DONE (a measurement, and a probe refuted): the shipped binary vs
    `bun bin.ts` on the two-package workspace, interleaved, min of 8.
    A flag-less `bun build --compile` read SLOWER than source (89 vs
    52 ms for `--version`, 148 vs 114 for a warm run) — refuted as a
    finding: the release tasks build with `--minify --bytecode`, and
    that binary reads 36 vs 53 ms and 71 vs 114. So the dev path pays
    ~40 ms of transpile per run that no user of the binary sees, and
    every small-workspace number in this file taken through
    `bun bin.ts` overstates the shipped wall time by about that much;
    the 1000-project figures are dominated by work the transpile does
    not touch. When a small-workspace number matters, time the
    bytecode binary: `VX_BIN=<binary> bun packages/vx-bench/run.ts`
    (added the same day; 20 projects, median of 3: warm 109 → 64 ms,
    restore 134 → 83, cold 203 → 143 through the binary). Inside the
    binary's 71 ms on two packages: startup 25–30 (the runtime's own),
    the early `git ls-files` spawn 9, the per-run git context spawn
    (commit + branch for the invocations row) ~4, the status walk, and
    ~13 for two cache hits — a floor of deliberate spawns, nothing to
    cut without a number.
33. DONE (fix shipped, cause half-proven): CI red on 1414cf2 (a
    help-text commit) in `@vzn/vx#lint.oxfmt`: `oxfmt --check .`
    failed with `Failed to read file: packages/vx/.mcp.json` — a file
    that exists nowhere in the repo. It exists INSIDE the sandbox:
    `@anthropic-ai/sandbox-runtime` 0.0.75 lists `.mcp.json` among its
    DANGEROUS_FILES and masks `<cwd>/.mcp.json` with a `/dev/null`
    ro-bind on Linux whether or not the file exists
    (`linuxGetMandatoryDenyPaths`), so the walker meets an entry it
    cannot read. `.oxfmtrc.json` now ignores `.mcp.json`, `.vscode`,
    `.idea` and `.claude` — every masked name oxfmt could take for
    input — so the sandboxed check never opens them. Not reproduced
    here (no sandbox as root): a device node and a directory named
    `.mcp.json` both pass locally, so the mask's exact shape inside
    bwrap, and why every earlier head passed the same task, are not
    known — the four heads after 1414cf2 passed the same task, so the
    walker meets the mask only sometimes (a race in the sandbox's
    mount setup is the likeliest shape). The ignore makes the check
    independent of it either way.
34. DONE: a persistent task that failed to become ready explained itself
    on the PROCESS's stderr — a bare write that a run with a custom
    logger (an embedder, the MCP server) never saw, and that the task's
    frame did not carry. It now goes through the task's own stderr
    stream; the pin that asserted the bare write asserts the stream,
    with the process stream as the control. The other direct stderr
    writes below the CLI (an observer that threw, an internal error,
    the bwrap symlink-punch warning, a nameless package at discovery)
    are last-resort paths where the logger may be the thing that
    failed, or have no logger in scope; left as they are.

35. DONE (a comment that claimed what the code lacked): the schema
    gate in `cache.ts` said artifacts orphaned by a `SCHEMA_VERSION`
    drop are "reaped by `vx cache prune`". `Cache.prune` evicted only
    hashes with an `entries` row — an orphan had none, so nothing ever
    reclaimed it, nor the `.tar.zst.tmp-*` a crashed save leaves. Prune
    now sweeps the cache directory after eviction: a row-less artifact
    or a temp older than an hour is unlinked and reported separately
    (`PruneResult.orphans` / `orphanBytes`; the CLI appends "reaped N
    orphaned artifacts"). The hour is the in-flight guard — a save
    renames before its row commits, and a temp exists while its bytes
    are written — so the pins keep a fresh row-less artifact, a fresh
    temp, and an aged INDEXED artifact as controls, and the
    schema-mismatch test now ends with the orphan it creates being
    reaped. Both pins failed before the sweep (`orphans` undefined).
    Cost: one `readdir` plus one `SELECT hash` per prune, and a `stat`
    only per candidate; the run path is untouched. Found by the same
    grep that caught item 34's class: `modules/cache.md` also still
    said entries are stored uncompressed and `SCHEMA_VERSION` is v22;
    both corrected.

36. DONE (de-claim): the CAS seam (`cache/cas-backend.ts`,
    `digest.ts`, `Cache.contentBackend()`) still carried its 2026-06
    plan in three places — "Cache.ts has NOT yet been rewired … a
    follow-up (Phase 1b)", "R2 mirror, REAPI CAS bridge, analytics
    scanners", "internal until the artifact store lands", "dev-flows
    roadmap Phase 3". None of it is true or planned: nothing distributed
    ships here, `vx-reapi` speaks Bazel's CAS over its own wire without
    the type, and no package imports it. The header, the method doc,
    the module doc, `architecture.md`, and the two module indexes now
    say what it is: a module-internal, consumer-less digest-keyed view
    of the artifacts directory that core's save/restore path does not
    go through, kept because it is small, tested and free on the run
    path — and that a write through it lands a row-less file item 35's
    sweep will reap. Not deleted: the façade snapshot and the
    integration test would go with it for no run-path gain, and the
    seam is the shape a blob store built on top would need.

37. DONE (a mechanical probe, then the rot it found): a script pulled
    every `tests/…`, `src/…`, `docs/…` path out of docs, comments and
    guides and checked it exists. Thirty-five misses; most were test
    fixtures (`src/a.ts`), the rest were real: seven pointers at
    `tests/package-boundaries.test.ts` (the file is `.unsafe.test.ts`,
    CLAUDE.md included), two at `tests/sandbox-runtime.test.ts`, one at
    `src/orchestrator.ts`, three at `apps/docs/vx.config.ts` importing
    core by relative path (the docs package moved and imports the bare
    `@vzn/vx` now), and eight at two design docs that no longer exist
    (`core-cloud-split-2026-06`, `native-cache-wire-2026-07`) — one of
    them from the retired `remote-cache.md`, which pointed at the other
    deleted doc as its successor. Each now points at the file that
    exists: the boundary law at `architecture.md`, the remote-cache
    seam at `modules/layered-cache.md` with the three wire packages
    named, the seams at `pipeline-2026-09.md`. `sandbox-gate.ts` also
    claimed two consumers; the `--verify` suite it named is gone.
    Refuted along the way: a `.vx-tmp-*` restore temp leaked by a kill
    mid-restore cannot reach the next artifact — the miss path wipes
    the declared outputs before it spawns and a hit wipes them before
    it restores, so a temp under an output glob is gone before anything
    packs; the extractor's own `abort()` covers the error path.

38. DONE (the sibling probe: identifiers): the same script for code
    identifiers in backticks across docs, module docs and guides,
    checked against every `src/` in the repo. Real misses: `RemoteCache`
    in `architecture.md`'s module map (the type is `RemoteCacheLayer`),
    `SandboxNetworkConfig` in the façade table (the schema exports are
    `SandboxConfig`, `SandboxGrants`, `SandboxDenials`; `ResourcesConfig`
    was missing from the row), and `optimizations.md` row 22 living in
    `cache/remote-cache.ts` — the wire that left core; the
    `AbortSignal.timeout` it describes lives in the turbo and nx cache
    packages now. The same catalog opened with "~3.9× faster than Turbo
    and ~5.4× faster than Nx", numbers `benchmarks.md` no longer
    carries (its table reads 1.9× and ~7× warm); the catalog now points
    at the benchmarks doc instead of restating a figure that moves.

39. DONE (DX: an upgrade that empties the cache says so): a
    `SCHEMA_VERSION` mismatch drops every table — entries, history,
    memos — on the first open, silently; the run after an upgrade was
    an all-miss run that looked like a bug, and `vx last` after it
    said "no recorded runs yet" with no reason. `Cache.schemaReset`
    now carries `{ from, to }` on the one open that did the drop (null
    on every later one, pinned), and `noteSchemaReset` prints one line
    at each opener that has a channel — the run's status line
    (`prepare`, `loadResolvedProjects`) and a verb's stderr (`last`,
    `why`, `info`, `cache prune`, the CLI project load): `[vx] cache
index reset: schema v0 → v25 (vx upgraded); every cached task
misses once and re-saves, and vx cache prune reclaims the old
artifacts`. Pinned end to end: the run after a poked version says
    it once and the run after that is quiet; `vx last` prints it before
    its own empty-history refusal. Cost: one property read per open.
    Refuted on the way: a CLI-flag drift probe (every `--flag` in
    `cli.md` against every string in `src/cli`, both directions) found
    only examples and git/bwrap flags — `cli-doc-drift.test.ts` already
    holds that line. And a rule re-learned: two commits before this one
    pushed three doc tables the formatter rejects, because the format
    check was read through `tail -1`, which hid the "issues found" line
    above the summary — exactly what CLAUDE.md's "never pipe a gate
    through tail" is about. Fixed in 377c00f; the check is read whole.

40. DONE (a swallow that hid a refusal): `planRun`'s placement helper
    caught every error from `resolveExecutors` and returned nothing —
    right that `--dry` must not fail over a label, wrong that it said
    nothing: the run the plan previews WOULD refuse on that plugin, and
    the plan read as "everything lands locally". It now puts one line
    on the status channel, in the plugin's name — `[vx] placement not
shown — plugin 'org/broken-exec' … exec boom (the run would refuse
on it)` — and still returns the plan. Pinned with a throwing
    executor factory; the pin fails on the old code (zero notices).
    Found by reading the 47 bare `catch {}` sites in core: the rest are
    teardown-must-not-throw, best-effort git probes, and ENOENT-means-no
    checks, each with its reason on the line. A run-context comment
    that explained a `HEAD` branch by "the dashboard's column" was
    reworded; there is no dashboard.

41. DONE (the doctor names the bytes nothing will hit): `vx info` now
    prints an `orphans` row — `3 artifacts (12.4 MB) the index does not
know — vx cache prune reaps them` — only when there are any, from
    the same scan item 35's sweep uses (`Cache.orphanStats()`, one
    readdir and a stat per row-less file past the hour). The reset
    notice (39) says an upgrade emptied the index; this says what it
    left on disk, before anyone prunes. Pinned end to end with an aged
    orphan and a fresh one as the in-flight control; the existing info
    pin holds the no-orphans control (no row at all).

42. DONE (the module index claimed one page per module; 34 files had
    none): a probe compared `src/**` against `docs/modules/README.md`.
    Eight modules had no page anywhere — the Turbo mapper both
    `vx migrate` and `@vzn/vx-turbo` run, the run-history queries
    behind `vx last` / `vx why` / the MCP tools, `resources`, the
    telemetry log buffer, and four util rules (edit distance, integer
    bounds, the settle deadline, the persistent tail); each has one
    now, written from the source, with its tests named. The rest were
    slices and helpers documented inside their owner's page (the cache
    slices, the sandbox helpers, `failure-mode`, `config-eval`,
    `local-executor`) or CLI verb parsers the README already routes to
    `cli.md` — they are indexed under their owner, and the README's
    first sentence says that is the rule. `task-log-buffer.ts` still
    described its consumers as the cloud client sink, the cloud serve
    sink and the dist scheduler, and sized its stubs against a cloud
    ingest cap: reworded to the one consumer that exists
    (`@vzn/vx-otel`) and to what a sink should size against.

43. DONE (owner's report: `vx lock` "raises schema issues … like some
    mock"): reproduced `vx lock`, `--check` and `--frozen` on a config
    using every schema form, on a `project`-stage plugin workspace with
    a config-less package, and on the walkthrough workspace — the lock
    round-trips all three (the frozen run re-validates the stored
    object and accepts it; the plugin still shapes a frozen run). What
    the report matches is two messages on the way there. (1) The
    unknown-field refusal from item 22 printed `did you mean
undefined?` whenever nothing was within two edits — `nearest`
    answers `undefined` and the template tested for `null`; a
    validator that prints `undefined` reads exactly like a stub. The
    message is now `has unknown field "x" (allowed: a, b)` with the
    hint appended only when there is one; the `resources` block had a
    second copy of the rule with no hint at all and goes through the
    one function now. Pinned: a field with nothing near gets the list
    and no guess (fails on the old code: `undefined` in the message).
    (2) The sandbox-unavailable message told the user to set
    `sandbox.enableWeakerNestedSandbox: true` — the runtime's option
    name, which the loader refuses as an unknown field; the config
    field is `weakerWhenNested`. The reason builder is a function now
    (`unavailableReason`), and `tests/sandbox-hint.test.ts` validates
    every `sandbox.<field>` the hint names against the loader, with
    the runtime name as the refused control. Also per the owner's ask
    that every fix carries a test: items 37 and 42 were probes without
    a law — `tests/doc-references.test.ts` now fails on a doc path
    that does not exist and on a source module the index does not
    name (it caught one more on landing: `plugin-commands.md` pointed
    at a `tests/server.test.ts` that lives in `packages/vx-mcp`).
    Items 35, 39, 40, 41 carried their pins when they landed.

44. DONE (the class behind item 43's second message, then a hole): a
    probe pulled every dotted config path core's messages and comments
    name (`exec.env.define`, `sandbox.ignoreViolations`, …) and checked
    each segment against the loader's field sets. Two comments named a
    `sandbox.ignoreViolations` that does not exist (the field is
    `sandbox.ignore`); corrected. The probe's control found the real
    thing: `exec.env` was the one object level with NO unknown-field
    check — `env: { set: { A: 'b' } }` loaded, defined nothing, and the
    task ran without `A` under a green run. `ENV_FIELDS` closes it.
    `tests/schema-unknown-keys.test.ts` is the law: it walks every
    object level of a full config, injects a key at each, and asserts
    the refusal names that level and its list — thirteen levels today,
    and the walk's own list is pinned so a new level cannot arrive
    without the check. The two env pins fail without `ENV_FIELDS`;
    `schema.md` now lists every level and shows the message form.

45. DONE (owner's ask: "why are the tests so slow"): measured with the
    JUnit reporter across the eight shards — 5,403 tests, ~95 s of
    test bodies, 102 s of shard wall run back to back on four cores.
    Per-file startup is 9–15 ms and 5,237 tests finish under 200 ms;
    the time sat in thirteen tests over a second, and none of them was
    doing work — they were WAITING: (a) six tests proving the
    SIGTERM→SIGKILL escalation each waited the full 2 s grace
    (`TIMEOUT_SIGKILL_GRACE_MS`, `PERSISTENT_SHUTDOWN_GRACE_MS`);
    (b) the signal-handling suite polled `process.kill(pid, 0)` for a
    child that was already dead — a zombie reparented to init, which a
    container reaps ~1.5 s later; three tests × 1.5 s, and three
    copies of that `isAlive` across suites; (c) two 8 s stdout floods
    in `output-memory` where a 1 s / 3 s pair separates a 100 MiB/s
    leak from flat just as well; (d) a fixed `Bun.sleep(1200)` in
    `cache-hygiene` standing in for "the task has started", and a
    1.5 s settle in a `vx watch` test for a loop that cycles in 30 ms.
    Fixes: `killGraceMs()` reads `VX_KILL_GRACE_MS` (bounded like the
    teardown deadline; pinned) and the escalation suites set 200 ms;
    `tests/helpers/alive.ts` defines child liveness ONCE and reads
    `/proc/<pid>/stat` so a zombie counts as dead; the marker file and
    the shorter windows. Before → after, one file per process:
    signal-handling 5.5 s → 0.5 s, task-timeout 5.1 → 3.3,
    persistent 3.0 → 1.1, output-memory 17.4 → 9.4, cli 4.0 → 3.2,
    cache-hygiene 1.24 → 0.14. What stays: `output-memory` is a rate
    measurement (4 s of flood is its floor), `scheduler`'s dense-graph
    pin builds 87k edges, `options-resolve` spawns a config Worker per
    deadline case, and ~130 end-to-end `bun bin.ts` spawns cost
    ~100 ms each — real work, not waits. Refuted on the way: the
    signal suite's 2 s was not the grace (vx exits in 4 ms and the
    child is a zombie 7 ms later); the zombie wait was the whole of it.
    Whole suite, eight shards back to back on four cores: 102 s → 80 s,
    and the longest shard — the critical path when they run in
    parallel — 28.5 s → 18.0 s.

46. DONE (a pin that proved nothing, found by taking its sleep away):
    `cache-baseline`'s "second restore touches no inodes" slept 1.1 s
    and compared whole-second mtimes. Replacing the sleep with the
    inode showed the claim false: `Cache.restoreOutputs` ALWAYS
    materialises (a `.vx-tmp-*` renamed over each target — new inode,
    same bytes, same sidecar mtime), so the old comparison passed a
    rewrite as readily as a skip. Skipping a current tree is the
    orchestrator's decision (`isOutputsCurrent`, pinned in
    `execute-task` and `output-dirs`), never the cache's. The test now
    says what the cache does — the recorded whole-millisecond mtime on
    every restore, a new inode on a re-restore, a deleted or
    wrong-sized file replaced — with no sleep; the file runs 2.4 s
    instead of ~7.7. The band under a second was otherwise real work
    or inherent waits: `options-resolve` spans two fixed sleeps to
    prove ordering, `config-eval` sleeps inside configs to prove a
    deadline, `inflight` needs the first task still running. The same
    file's millisecond-precision pin sat behind a same-second
    precondition (`if` the write landed in the recorded second, assert)
    — a skip is a silent pass — and now sets an mtime one millisecond
    off the recorded one explicitly, so the claim never rides on a
    second boundary.

47. DONE (pure motion): `project-loader.ts` was 1,022 lines, and 742
    of them were not loading — the validators for every config level,
    the field sets, the glob and timeout rules, the sandbox grant
    shapes. They are `workspace/config-schema.ts` now, with the loader
    at 281 lines deciding how a file is evaluated and the schema
    deciding what it may say. The `workspace/index.ts` contract is
    unchanged; `lockfile.ts` imports the validator from the schema; the
    loader re-exports it so the tests that reach it there keep
    working. Nothing crossed between the halves but the two calls.
    Module doc, index row and CLAUDE.md layout updated; the doc-index
    law names the new file. Warm A/B: see item 49 — the readings taken
    that evening reused workspace copies across schema versions; the
    clean protocol reads a tie.

48. DONE (pure motion, the sibling of 47): `cache/inputs.ts` was 1,257
    lines holding two concerns — which files a task declared (globs,
    boundaries, outputs, runtime values) and how git is asked about
    them (`GitFilesCache`, the `ls-files` / `status` / `check-attr`
    parsers, the start/apply enumeration). The git half is
    `cache/git-inputs.ts` (636 lines); the resolver keeps 627. Nothing
    crossed between them but the cache class and two calls — the only
    mentions of the resolver on the git side were comments. The
    `cache/index.ts` contract is unchanged; the resolver re-exports the
    cache for the tests that reach it there. Module doc, index row and
    CLAUDE.md layout updated. One lesson, paid in a red head (c7e9bf1,
    fixed next commit): the re-export list came from a grep of ONE-LINE
    test imports, and `stale-hit.test.ts` imports three git parsers in
    a multi-line block — shard 1 failed on the missing export while the
    targeted suites, which do not include that file, were green. A
    moved module re-exports its WHOLE public surface from the old path,
    and the import scan is multi-line (the script in this item's
    commit), not a one-line grep.

49. DONE (a regression that was the harness, then the harness rule):
    the A/B after item 48 read the head 8–12 ms slower than main by
    median in both orders at twenty reps, and swapping the workspace
    copies did not move it. Bisecting by `VX_TIMING` stage (main vs
    commits 31, 57, 44, then 44 vs 57 directly) gave inconsistent
    signs and one clean-looking +7.8 ms in `classify + probe` — until
    the accumulated counters showed the two arms proving their hits
    differently in the same run: one arm's minimum came from the rep
    right after a `SCHEMA_VERSION` flip. main is v24 and every PR head
    is v25, and the copies were reused across arms, so whichever arm
    did not match a copy's last index reset it, re-saved on rep 1, and
    proved rep 2's hits by the glob walk (which records the output-dir
    rows) — a rep whose stage split differs from steady state, and
    min-of-N picks exactly that rep. On a fresh index head and main
    behave identically (miss, walk-and-record, then the dirs proof
    from rep 3: 175–182 ms total vs 296–347 with the walk forced every
    rep — the dirs proof holds). The clean protocol — one copy per
    arm, pre-warmed by that arm, no flips inside the measured reps,
    twenty reps, both orders — reads main med 236 / head 232 in one
    order and head 229 / main 227 in the other: a tie by median with
    the sign flipping; the minimum reads head +5–6 ms in both orders,
    inside the harness's own spread but noted. No commit in the PR
    costs the warm path; the earlier readings under items 46–48 were
    taken with reused copies and are superseded by this one. Rule
    (CLAUDE.md): arms on different `SCHEMA_VERSION`s never share a
    workspace copy. Under the same protocol `vx show` at 1,000
    projects reads main min 132 / med 138 ms vs head 102 / 105 — the
    staged load's cached evaluations (item 13), re-measured.

50. DONE (DX, one row): `vx info` prints `cache versions: keys
vx-cache-v27 · index schema v25` — the two constants a bug report
    needs and the reset notice (39) names, read from the source
    constants (now exported from `cache/index.ts`), and pinned against
    those same constants so a bump shows up in the doctor without a
    second copy. Found while chasing item 49: the doctor had no way to
    say which schema an index was on.
    Seen and deferred: 26 test files carry their own `makeWorkspace`,
    23 an `addProject`, 9 a silent logger — the second-copy class at
    suite scale. A shared `tests/helpers/workspace.ts` would drop a few
    hundred lines, but each copy differs a little (git init, heredoc
    configs, extra packages) and the move is mechanical risk for no
    behaviour; do it file by file when a suite is touched for another
    reason, not as one commit.

51. DONE (DX, one row): `vx info` prints `plugins: 2 — @vzn/vx-reapi
(executor, cache); @vzn/vx-otel (telemetry)` — every plugin the
    workspace declares and the seams each fills, in pipeline order, or
    `none`. Nothing named the loaded plugins before; "why did this task
    run there / cache there / not at all" started with reading
    `vx.workspace.ts`. It reads the declarations (a plugin that
    declines at run time still lists its seam) and is pinned on the
    plugin fixture (`1 — gen (project)`) and the bare one (`none`).
    The Next list is exhausted of actionable items: 1–2 parked with
    reasons, 3 done, 4 refuted, 5 an instruction, 6 done as item 49,
    7 done but (c), 8 (a)–(h) done, decided or refuted with numbers.

52. DONE (pure motion): the placement of a graph over its executors —
    the pinned-local walk, `placeTasks`, the plan-mode `planExecutorOf`,
    the pool view and the unplaced sentinel, 170 lines — left `run.ts`
    for `orchestrator/placement.ts`; `run.ts` is 1,004 lines. The move
    found a doc comment orphaned above the wrong function (the
    "nearest declared name" text sat over `initHint`; it is back over
    `didYouMean`). Module doc, index row, `orchestrator.md` and the
    CLAUDE.md layout updated; the placement suites pass unchanged.
    Clean-protocol A/B (item 49's rule), twenty reps, both orders:
    main med 226 / head 229, head 236 / main 233 — +3 ms by median in
    both orders with the minimum flipping (+3 / −1), inside the
    harness's own spread as a pure move should read.

53. DONE (pure motion, the sibling of 52): the signal forwarding —
    SIGINT/SIGTERM to every live and persistent child, cache closed,
    exit 128+signo, handlers removed in the finally — left `run()` for
    `orchestrator/signals.ts` (`forwardSignals(...) → { remove }`).
    The registries stay with `run()`, which hands them to the runner
    around every spawn; the module only reads them when a signal
    lands. `run()` is 970 lines, the function itself ~750. Module doc,
    index row, `orchestrator.md` and the CLAUDE.md layout updated; the
    signal suites pass unchanged.

**Profiles after item 50 (2026-09-10).** `bun --cpu-prof` on the
pre-warmed 1,000-project copy, third run of three. `vx show` (93 ms
sampled): 28% in the discovery closure (`workspace.ts:303` — the
per-package readdir + manifest read, async continuation attributed to
the closure), 11% `JSON.parse` of manifests, 5% `listProjects`, then
the staged load and the eval-cache keys at 1–3% each. Warm `vx run`
(228 ms sampled): `statSync` 9% (the two output proofs, 2,000 stats,
chosen sync by the 2026-09-09 A/B: 100 → 54 ms on the run-graph
stage), `findConfigFile` 5%, `bun:sqlite` query 3.5%, package graph
2.5%, `hashProjectPackageJson` 2.4%, then a long tail under 2%. No
new hot spot: every frame over 2% is a measured decision already
recorded (discovery 8(e), the proofs' sync stats, the manifest hash).
The next warm-path gain is structural (8(e)'s stat-keyed discovery
memo), not a frame.

**Warm path after item 46 (2026-09-10).** Interleaved A/B, 1,000
projects, twelve reps, both orders, base = the immutable c0b20ca
worktree: main min 225 / med 242 ms vs head 231 / 246 in one order,
head 221 / 233 vs main 222 / 232 in the other — a tie inside
run-to-run jitter, the sign flipping with the order. The reset
property read (39), the env field check (44, on the eval path only)
and the orphan scan (35, prune only) cost the warm run nothing
measurable.

**Handoff after item 45 (2026-09-10, morning).** PR #265 carries the
loop, 70+ commits; every head is green on CI except the ones a
same-day commit fixed (d295a90 timing, 1414cf2 `.mcp.json`, f549719
unformatted tables, 92e1682/f4a0d48 a doc law reading outside the
sandbox — each recorded above). The shape since item 31: the owner's
two asks (item 43's `vx lock` report and item 45's suite speed) both
resolved to measurement first — a repro that round-trips, a JUnit
timing pass — and each fix carries a pin that fails on the old code;
three probes became laws (`doc-references`, `schema-unknown-keys`,
`sandbox-hint`); the reset notice (39), the orphan sweep (35) and the
doctor's orphans row (41) close the schema-bump story end to end. The
suite runs ~95 s of test bodies across eight shards on four cores;
what remains over a second is real work (rate floods, an 87k-edge
graph, Worker spawns, ~130 end-to-end CLI spawns at ~100 ms). Start
the next session from Next § 8: (e)/(f)/(g) are open with reasons;
(c) is done for every verb but `vx lock`, on purpose. The scratchpad
harnesses (`ab2.ts` warm, `ab3.ts` cold, `abshow.ts` for `vx show`,
`junit/` for suite timing) take two worktrees and two workspace
copies; recreate the copies with the bench generator.
Next-list 8(b) decided: `--max-size` keeps reading a bare integer
as bytes — it is pinned (`cli-arg-hygiene`: `--max-size 1` is one
byte), documented as `<bytes>`, and the zero bound is the guard;
refusing unitless there would reverse an earlier call for one
footgun the docs already name.

## In flight

**Open after the sandbox arc (2026-09-05).** Local `vx run ci --all` is
green, 36/36, no violations. CI is not, and every remaining item is
either a one-line decision or a known constraint, not a mystery:

1. DONE 2026-09-09: `@vzn/vx-docs#build` on Linux CI, red since
   2026-09-05 with exit 1 and nothing on either stream. Not the
   telemetry EROFS recorded before (real, but not what exited), not the
   runner's Node. A diagnostic frame from CI (hooking `process.exit` and
   both rejection channels) said `Cannot find package 'yargs-parser'
from …/node_modules/astro/dist/cli/index.js` — astro's OWN
   dependency, unresolvable because the task's write grants under
   `node_modules` (`.astro/**`, `.vite/**`) made `punchWritePaths` bind
   node_modules' children one by one, and bwrap mounts a SYMLINKED child
   (every package in Bun's isolated layout) as the directory it points
   at, so astro sat in a plain directory with no `.bun/` siblings.
   astro's and vite's caches now live under `.astro/` (astro.config.mjs)
   and the grants follow; `punchWritePaths` warns, naming the grant,
   whenever a punch meets a symlinked entry. The build also runs under
   `bun --bun` (half the wall time; no dependency on the runner's Node)
   and the telemetry define stays.
2. DONE 2026-09-09, and the diagnosis was wrong: the four perf baselines
   did not fail from eight-way contention but from ptrace. The Linux
   sandbox wraps every task in `strace -f -e trace=openat`, and without
   `--seccomp-bpf` strace stops the tracee on EVERY syscall and filters
   in userspace, so a stat-heavy micro-benchmark ran 2.5–7× over
   budget. Reproduced outside the sandbox: plain `bun test` 24/24, the
   same four fail under strace, 24/24 again under `--seccomp-bpf`. The
   flag is on (strace ≥ 5.3; older gets the slow form), which also
   takes that tax off every other sandboxed task on Linux — the gate's
   `time 138s · max 89s` on the last run is the number to compare.
3. **A sandboxed task cannot expose a port on Linux.** macOS works and is
   properly gated — measured, a sandboxed consumer reaches a sandboxed
   server (200) and is refused without `localBinding`. On Linux every
   sandboxed task gets `--unshare-net`, so nothing sees the port. Opening
   the netns costs full egress, which is the wrong price; the narrow
   answer is a per-port unix-socket bridge (socat, the same trick SRT
   uses for its own proxy), and it is blocked today because SRT reads
   `allowUnixSockets` off the config given to `initialize()` and never
   the per-call one — the probe dies on
   `socket(1, 1, 0): Operation not permitted`. Arming it from the union
   at `initSandbox`, as `allowedDomains` already is, is the way in.
4. DONE 2026-09-09: persistent tasks run inside their `exec.sandbox`.
   `wrapSandboxedCommand` is the enforcement half of `runSandboxed` on
   its own and the persistent path spawns through it; the violation
   report stays one-shot only, since it reads the trace after exit and a
   server exits at teardown. `vx-docs`'s `dev` and `preview` blocks mean
   what they say now. Pinned in the unsafe suite: a sandboxed server that
   reads a workspace-root file sees the denial, the same server without
   the block reads it.
5. **macOS violation reporting is lossy while any violation fails the
   task.** The unified log drops records under load, so the same task can
   pass or fail run to run. Enforcement is unaffected — the OS denied the
   operation either way — but the REPORT is not a reliable gate on that
   platform.

- **v0.0.18 is fully on npm; one owner step remains before the next
  release.** npm released the two held packages about ninety minutes
  after the publish: all five serve 0.0.18 as `latest` (2026-09-04
  00:20Z). `npm.yml` now publishes with trusted publishing only — no
  token read anywhere, `--provenance` explicit, the npm ≥ 11.5.1 +
  sigstore guard on both jobs, `permissions: {}` at the top, every
  action in `npm.yml` and `release.yml` pinned to a commit SHA, and the
  object-form `repository` npm was rewriting. OWNER STEP before the next
  release: on npmjs.com add the GitHub Actions trusted publisher (owner
  `vznjs`, repo `vx`, workflow `npm.yml`, no environment) to each of the
  five packages, then delete the `NPM_TOKEN` secret (it is no longer
  read; npm restricts it — v0.0.17's `E401`, v0.0.18's hold). The
  build half is PROVEN: a `workflow_dispatch` dry run of the new
  workflow (run 33812502741, 2026-09-04) succeeded on both jobs — pinned
  actions resolve, the npm ≥ 11.5.1 guard passes on macOS and ubuntu,
  all five packages build and assemble at the stamped version, and
  only the two publish steps were skipped, as `dry_run` intends. The
  auth half is proven by the next release. Documented in
  `docs/cli.md` § Releasing.

## Next (ordered)

1. **The live REAPI suites are green again (2026-09-04); the
   whole-graph run stays optional.** With OrbStack's docker back, the
   rehosted `vx-nativelink:bun-node` image on
   `tests/helpers/nativelink-exec.json5` ran all ten `@vzn/vx-reapi`
   files one process each with both endpoints set: 121 pass, 0 fail —
   the wire-level execution suite (15), the cache suite (16) and the
   `execute: true` composition proof (2) included, so the barrel
   narrowing and the by-name error classification (2026-09-03) changed
   nothing live. Not done: `vx run ci --all` of THIS repo at a worker —
   it needs a workspace that wires `reapi({ execute: true })` (none is
   checked in) and filesystem stores (the memory stores evict under a
   `node_modules` install, per the helper notes). An exercise, not a
   gap; do it when a worker-side change needs it.
2. **The remote seam still moves whole artifacts.** With save, ingest
   and restore bounded, `RemoteCacheLayer` is the last place a large
   artifact sits in memory: `put(hash, body: ArrayBuffer | Uint8Array)`
   gets the on-disk artifact via `Bun.file().bytes()`, and `get` returns
   an `ArrayBuffer` that ingest writes to its temp. Widening both to a
   `Blob` (a `BunFile` is one; bytes wrap in one) would let uploads
   stream from disk and downloads land in the temp directly — but
   `@vzn/vx-reapi` must digest the whole body before it can upload, so
   the plugin side needs a streaming digest and a chunked `writeBlob`
   first. A breaking seam change for plugin authors; do it with the
   plugins guide, the stub layers in the tests and `vx-reapi` in one
   commit, and measure a 150 MiB round trip through the stub before
   and after. Not started. Assessed 2026-09-04: the win is gated by the PLUGIN
   side — `@vzn/vx-reapi`'s wire zstd-compresses the whole body in
   memory and retries a wedged upload from it, so a core-side Blob alone
   measures nothing; streaming needs a two-pass digest and a chunked
   compressed upload through the adaptive-downgrade path. Do it when a
   real workspace uploads > 100 MiB artifacts, not before.
3. **DONE 2026-09-09 — zero-migration adoption as a plugin.** (Kept for the reasoning.)
   The Vite-shaped ecosystem lever: `plugins: [turbo()]` in a Turbo
   repo (or `nx()`) and `vx run build --all` works against `turbo.json`
   - `package.json` scripts with no generated files — a trial that
     commits nothing. The `project` stage is the right seam, and the
     mapping already exists in `migrate-turbo.ts` / `migrate-nx.ts`, but
     the seam gap that blocked it is CLOSED (2026-09-09): when any
     plugin declares `project`, a package without a config file is
     loaded as `{ tasks: {} }` for the stage to fill (pinned: a
     scripts-to-tasks plugin gives a config-less package a task that
     plans and runs; with no `project` plugin the package stays
     invisible, as before). DONE the same day: `@vzn/vx-turbo`. The
     mapper moved out of the CLI into `workspace/turbo.ts` (one mapping,
     two consumers — `vx migrate` renders it with preset splices, the
     plugin runs it live with the globals inlined), the façade exports
     it, and the plugin fills the `project` stage from it, never
     overwriting a written config. Pinned end to end over the migrate
     suite's Turbo fixture: plan shape, edges, cache blocks, inlined
     globals, second-run hits, `cache: false` uncached, hand-written
     config wins, gaps warned once. The maintenance-surface worry is
     answered by the shared mapper: there is one source of task truth
     for Turbo, and the plugin is 90 lines over it.
4. **The shipped binary's second core.** A compiled `vx` loading a
   `vx.workspace.ts` that imports `@vzn/vx` pulls a second copy of core
   from `node_modules` (~12 ms) on every run — and makes a binary user
   install the package at all. REFUTED 2026-09-03 as a runtime fix: a
   `Bun.plugin` `onResolve` hook registered by the binary never fires
   for a bare specifier imported by a dynamically imported user file
   (Bun 1.4.0, probed in plain `bun` with a `.ts` and a `.mjs` user
   file), so the binary cannot serve its bundled core to the workspace
   file that way. The user-visible half is
   closed (`isUserError` classifies by name across copies); what remains
   is the cost and the duplicate module state — and the cost is NOT
   measurable as an A/B from a workspace file (2026-09-03): a workspace
   importing plugins by absolute source path also loads source, since the
   binary cannot expose its bundled core to a workspace import, so both
   arms read equal (77 vs 74–81 ms at 100 projects). REFUTED as a
   runtime-plugin fix (Bun 1.4.0's `Bun.plugin` hooks never fire for
   bare specifiers or `.ts`); options left are rewriting the config
   source before import or a Bun fix. Parked.
5. **The watch e2e flake** — if `re-runs the task after a file change,
then exits on SIGINT` times out again, keep that run's stdout: the
   presence of `re-running...` separates a lost event from a slow
   re-run (see the 2026-09-03 watch entry).
6. **Re-measure the warm run after each day's work** — the hot path is
   the product. `bun packages/vx-bench/run.ts 100 5` and `1000 5`; an interleaved
   A/B against an immutable worktree settles any gap
   (`scratchpad/ab.ts`-style: alternate arms, min and median of N).
   Closing figures for 2026-09-09 on a noisy 4-core Linux container
   (late, after the improvement loop's 25 items): head vs main
   (c0b20ca), 1000 projects, both orders, min 296/304 and 302/295 ms,
   20 reps 310/313 — within run-to-run jitter, no `VX_TIMING` stage
   moved (loop item 25). Every warm-path step was A/B'd at its commit.
   (not the owner's box — compare against 2026-09-04 only by ratio):
   `run.ts` medians before the day's perf commit, 100 projects 109 ms
   warm / 180 ms restore, 1000 projects 281 / 1337; the commit's A/B is
   in the review entry. LEADS from the profile, not taken: (a) each
   `vx.config.ts` is stat'ed twice on the warm path — `findConfigFile`
   in discovery and again for its identity in the config load;
   threading the discovery stat into `hashFiles` saves ~1,000 stats.
   REFUTED on the cheaper half (2026-09-09): making discovery's stat
   synchronous ties (interleaved, 8 reps: min 57.6 vs 62.5 ms, median
   68 vs 67) because the async stats overlap the package.json reads.
   TAKEN another way the same day: on Linux each async stat is a
   thread-pool round trip and a `.mjs` config pays four of them per
   project, so one readdir per project dir replaces them there (12 ms
   against 43 at the last name, a tie at the first; the macOS stat loop
   stays, measured the winner there on 2026-09-03). Discover projects
   65–79 → 29–34 ms; whole process interleaved both orders, 10 reps:
   min 318 → 304 and 328 → 292 ms, median 368 → 325 and 358 → 320;
   (b) TAKEN 2026-09-09: the hit path's `output dirs` + `output stat`
   are ~2 stats per task and inherent to the proof, but they were
   thread-pool round trips; synchronous, the run graph stage halved
   (review entry); (c) TAKEN 2026-09-09: `record history` was ~10 ms
   on an empty table and 57–79 ms at 166k rows because of the
   (project, task) index; dropped (review entry). Remaining on the
   profile after both: discovery's async stat (42 ms native self time
   at 1,000 projects, the one lead (a) above leaves), and the history
   reader's slice scan for plugin users (~1 ms per 1,000 rows); after
   the readdir change, discovery's remaining cost is the manifest reads
   themselves. Closing figures for 2026-09-04 (load 5.7, best of 5): 1000
   projects 159 ms warm / 538 ms with restore, 100 projects 66 ms /
   104 ms — the sandbox and CI work touched nothing the warm path
   runs. Closing figures
   for 2026-09-03, after wave 6 and the discovery change, best of 5:
   1000 projects 193 ms (table says 204, measured before discovery
   changed), 100 projects 81 ms, on a box that had run the gate all day.
   Floors on the 1000-project bench (in-process, 2026-09-03): discover
   20 ms, load configs 21–23, git enumeration 21–47 exposed (the walk's
   own noise), classify + probe 23, run graph 19–21, record history
   11; total 151–184. What is left is the git walk (~60 ms, exposed by
   whatever it fails to overlap), 1,000 task hashes (11 ms), 1,000 file
   and directory stats (18 ms), 1,000 manifest reads (10 ms) and the
   batched inserts (4 ms after `runs_hash` went). The next real win is
   structural (not needing a walk), not another stage shave; fsmonitor,
   untracked cache and `-unormal` are refuted (see Shipped).
   COLD floors (same bench, cache wiped, `VX_TIMING=1` — the miss path
   carries spans since 2026-09-03): 2.06 s wall for 1,000 `echo` tasks at
   concurrency 10, i.e. ~20 ms per task-slot: execute 13.8 ms, save 3.6,
   resolve outputs 1.4, clean 0.6, task hash 0.01; cold config load 340
   ms (1,000 evaluations, no eval cache yet). Of the 13.8, the shell IS
   the floor on macOS: bare `sh -c 'echo built'` costs 9.2 ms per slot
   at 10 concurrent against 2.5 for `/bin/echo` spawned directly
   (stable over three rounds; `runCommand` adds 0.2 over the bare
   spawn). LEAD, not taken: spawning a shell-free command (`tsc -b`,
   `vitest run`) directly would save ~7 ms per task-slot on macOS and
   ~0 on Linux (dash starts in ~1 ms), against the principle that the
   shell is the API — PATH order, builtins, `command not found` → 127,
   scripts without a shebang all have to read identically. The headline
   shape's tasks use `&&`, so its rows would not move. Decide with the
   owner. The save's 3.8 ms splits (spans `save: *`): pack 1.25, write
   temp 0.63, rename 0.55, scan 0.46, index tx 0.17. Two trims measured
   as not worth their code (< 1 ms per task together, ~0.15% of the
   cold row): a synchronous compress for tiny buffers, and indexing a
   locally built artifact from its plan instead of re-scanning it.
   `vx watch` start on the same bench: the initial run plus a sweep of
   all 1,000 configs (repeat loads through the worker) — the sweep is
   35 ms, no visible pause.

7. **First-run DX follow-ups (candidates, from the 2026-09-04
   walkthrough).** (a) DONE 2026-09-09: `--summarize` task rows carry
   `noCache: true` for a task with no `cache` block (present only when
   true; documented in `docs/cli.md` § --summarize). (b) DONE 2026-09-04: `init` no longer makes `lint` wait for `build`
   (`test` / `typecheck` still do, the Turbo starter's convention). (c) watch still pays one redundant cycle on a
   task's first undeclared write (the bytes are unknown until seen);
   hashing what the cycle wrote before re-arming would zero it — only
   if a real workspace shows the cycle mattering. (d) DONE 2026-09-04: a filter set that matches nothing is one
   error line naming the patterns and the nearest project name.
8. **Improvement-loop candidates (2026-09-09, in order).** (a) The
   cached path's save block in `execute-task.ts` (resolve outputs,
   save, record output dirs, mark git outputs) as its own module —
   stale-hit-critical, so only with the execute suites and CI's
   unsafe job green, and behind a differential pin that a moved line
   would fail. (b) `vx cache prune --max-size 10` reads a bare number
   as 10 BYTES and evicts everything; `--older-than 5` refuses a bare
   number. Decide: refuse unitless sizes there (the zero bound is
   already refused for the same reason), or keep the documented
   `<bytes>` and say so louder. (c) Anything else that reads config
   files raw: only `vx lock` remains, on purpose (it freezes the
   file's own evaluation). Grep for `loadProjectConfig(` before
   adding a fourth consumer of the staged load. (d) `logger.ts` (716)
   and `framed-output.ts` (528) are the last large files; split only
   if a concern separates as cleanly as the three splits today did
   (assessed 2026-09-09: neither does — one renderer, one formatter).
   (e) Discovery is the largest fixed cost a warm run pays before any
   task: `listProjects` reads 19–28 ms for 1000 packages (2026-09-09,
   isolated). The manifest reads are 3–5 ms of it (async `Bun.file`
   wins over `readFileSync` 3.4 vs 6.3 ms, re-measured — the comment
   in workspace.ts stands); the rest is the member glob, the config
   probe and the loops. A memo keyed on each member directory's stat
   would skip the reads on a warm run, but a directory mtime does not
   move when a file INSIDE it is rewritten in place, so the key would
   have to be the manifest's own stat — one stat per package, which is
   most of the cost already. Do it only with a measured design.
   Measured 2026-09-10 on the pre-warmed 1,000-project copy, min of
   seven, all in flight: today's per-package I/O (readdir + manifest
   read + `JSON.parse`) is 8.6 ms; the memo's key (a stat of the
   directory — entries added or removed — and a stat of the manifest)
   is 3.3 ms async, 2.8 ms sync. But the memo must hand plugins and the
   package graph the whole manifest, so it stores the parsed JSON and
   parses it back — the `JSON.parse` share stays — and reads 1,000
   rows from SQLite (~1 ms). Net ≈ 3–4 ms of a 230 ms run for a second
   staleness surface (directory mtimes across platforms). REFUTED as
   not worth it; revisit only if discovery's share grows.
   (f) `--cache-dir` is a `vx run` flag only: a run under it leaves
   `vx last` / `vx why` / `vx cache prune` reading the default
   directory. `defineWorkspace({ cacheDir })` is the durable way and
   the docs call the flag per-run; add it to the reading verbs only if
   someone hits it.
   (g) `vx why` names a plugin `key` part but shows its digests
   (`plugin tool/node-major a2d9… → e893…`), because `entry_inputs`
   rows reduce every value to a digest — right for env values, which
   can be secrets, but a plugin's own material (`node-major: 22`) is
   what its author wants to read. Assessed 2026-09-09: a new column
   means a SCHEMA_VERSION bump, and a bump DROPS every table — every
   user's cache and history — for a nicety; storing the raw value in
   the `hash` column for `plugin` rows needs no bump but persists
   whatever a plugin returned (a secret, if a plugin ever folds one).
   Neither is worth it today; revisit when a plugin's part is the
   thing people debug.
   (h) Shard balance (measured 2026-09-10, after item 45): `bun test
--shard` splits by file count, so shard 5 carries `output-memory`
   (a 4 s rate measurement that spawns RSS probes) plus `task-timeout`
   and runs 18 s wall while the others run 5–13 s — the critical path
   when the shards run in parallel. Giving the memory probe its own
   task (every shard adds it to `--path-ignore-patterns`; one task
   runs the file alone) would cut the path to ~13 s. Nine config
   edits and a CLAUDE.md line for ~5 s; do it when the next slow file
   lands in the same shard, not before. Refuted alongside: pre-bundling
   the CLI for the ~130 end-to-end spawns. One `bun bin.ts --version`
   costs 45–47 ms (bun's own start is 4 ms); a `bun build
   --target=bun` bundle of the same entry costs 83–90 ms, slower, as
   the flag-less compile was in item 32, and the `--bytecode` form's
   ~17 ms gain would buy ~2 s of suite for a build step in every test
   run. The spawns stay on source.

## Decisions (this arc)

- **Gap audit vs Nx 23 / Turbo 2.10 (2026-09-04, owner's ask).** Core
  is at parity or ahead on every must-have a developer would miss
  (graph, filter DSL superset, affected, strict caching, env
  isolation, persistent readiness, watch, prune, migrate, init, dry /
  graph / summarize / profile). The one game changer left is
  zero-config adoption — scripts as tasks with no generated file —
  whose mapping is a `project`-stage plugin and whose core half is one
  seam widening (§ Next 3). `.env` loading, configurations, cache caps,
  graph UI, release, test splitting, boundaries: plugin or the
  language. Windows is the only must no plugin can supply; parked.
  Full table in `docs/comparison.md` § Gap audit 2026-09-04.
- **Agents removed.** `@vzn/vx-agents` (synchronizer + persistent
  workers, Nomad/K8s backends) was an in-repo distributed-execution
  product. It used only public core APIs (`run`, `createEventBus`, the
  executor seam), which is the proof the seam suffices — so it lives
  outside this repo, if anywhere.
- **Predictive scheduling removed.** Opt-in, measured at ~280 ms of
  history loading on a large cache (more than a warm run), and a
  scheduler-priority policy is exactly what a plugin hook should decide.
  The scheduler keeps its `priorities` input; a `schedule` seam will feed
  it.
- **`vx mcp` removed; `metrics.ts` trimmed.** The MCP server read the
  dashboard-era analytics queries and predictive history. An MCP server
  is a good plugin (`commands` seam), not core. The queries `vx why` /
  `vx last` need stay in `metrics.ts`; the rest went.
- **`vx why` / `vx last` stay.** Cache-miss explainability is a core
  promise; both read the local run history core already writes.

## Legacy map (what the old memory called things)

- `docs/design/decision-log-archive.md` held the full 2026-05→08 log; it
  is deleted from the tree (git history: `git log -- docs/design/decision-log-archive.md`).
- "waves" = the old audit cycles. Their standing rules survive in
  `CLAUDE.md` § Rules.
