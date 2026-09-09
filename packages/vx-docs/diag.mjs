// TEMPORARY CI DIAGNOSTIC — reverted with the next commit.
const realExit = process.exit.bind(process)
process.exit = (code) => {
  console.error('[diag] process.exit', code, new Error('exit called here').stack)
  return realExit(code)
}
process.on('uncaughtException', (e) => console.error('[diag] uncaughtException', e))
process.on('unhandledRejection', (e) => console.error('[diag] unhandledRejection', e))
process.on('exit', (c) => console.error('[diag] exit event', c))
console.error('[diag] TMPDIR=', process.env.TMPDIR, 'HOME=', process.env.HOME, 'node=', process.versions.node, 'bun=', process.versions.bun)
const m = await import('./node_modules/astro/dist/cli/index.js').catch((e) => (console.error('[diag] import failed', e), null))
if (m) {
  console.error('[diag] imported; calling cli --version')
  await m.cli(['bun', 'astro', '--version']).catch((e) => console.error('[diag] cli threw', e))
  console.error('[diag] cli returned')
}
