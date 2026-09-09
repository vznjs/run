import { defineProject } from '@vzn/vx'

export default defineProject({
  tasks: {
    ci: {
      dependsOn: ['build', 'test'],
    },

    test: {
      description: 'bun test — the guide and sidebar pins (needs the imported content)',
      dependsOn: ['install'],
      exec: {
        command: 'bun test',
        sandbox: {
          allow: {
            read: ['**/*'],
            systemInfo: ['vfs.disk-space'],
          },
        },
      },
      cache: {
        inputs: {
          files: [
            'tests/**',
            'src/content/docs/**',
            'astro.config.*',
            '.gitignore',
            'package.json',
          ],
        },
        outputs: { files: [] },
      },
    },

    install: {
      dependsOn: ['^build'],
    },

    build: {
      description: 'astro build → dist/',
      dependsOn: ['install'],
      exec: {
        // Under Bun, not the host's Node: `bun --bun` runs astro's bin on
        // Bun's runtime, which builds the same 133 pages in half the time
        // (18.5 s against 37 s under Node 22, 2026-09-09) and leaves no
        // dependency on whichever Node a CI image ships — astro 6 refuses
        // anything below 22.12, and the Linux gate's docs build had been
        // exiting 1 in 61 ms with no output at all.
        // TEMPORARY CI DIAGNOSTIC (reverted in the next commit): the build
        // exits 1 with no output on the Linux gate and nowhere else.
        command: [
          'echo "TMPDIR=$TMPDIR"; ls -ld /tmp "$TMPDIR" "$HOME" "$HOME/.config" 2>&1',
          'touch "$TMPDIR/.vx-probe" && echo write-ok TMPDIR',
          'node --version 2>&1; echo "node-exit=$?"',
          'bun --bun diag.mjs; echo "diag-exit=$?"',
          'bun --bun node_modules/astro/bin/astro.mjs --version; echo "astro-direct-exit=$?"',
          'exit 1',
        ].join('; '),
        // astro's telemetry does `mkdir ~/.config` before anything else; a
        // sandboxed task may read HOME but not write it, so it is told to
        // stay home.
        env: { define: { ASTRO_TELEMETRY_DISABLED: '1' } },
        sandbox: {
          allow: {
            read: ['**/*'],
            write: ['dist/**', '.astro/**', 'node_modules/.astro/**', 'node_modules/.vite/**'],
            // A static build binds no port; `localBinding` belongs to `dev`
            // and `preview` below, which serve.
            systemInfo: ['vfs.disk-space', 'net.link.addr'],
            machLookup: ['com.apple.SystemConfiguration.DNSConfiguration'],
          },
        },
      },
      cache: {
        inputs: {
          files: ['**/*'],
          workspaceFiles: ['docs/**'],
        },
        outputs: { files: ['dist/**'] },
      },
    },

    dev: {
      description: 'astro dev server (persistent)',
      dependsOn: ['install'],
      exec: {
        command: 'bun --bun astro dev',
        env: { define: { ASTRO_TELEMETRY_DISABLED: '1' } },
        persistent: { readyWhen: 'Local' },
        timeout: 120000,
        sandbox: {
          allow: {
            read: ['**/*'],
            write: ['.astro/**', 'node_modules/.astro/**', 'node_modules/.vite/**'],
            systemInfo: ['vfs.disk-space', 'net.link.addr'],
            machLookup: ['com.apple.SystemConfiguration.DNSConfiguration'],
            localBinding: true,
          },
        },
      },
    },

    preview: {
      description: 'serve the built dist/ (persistent)',
      dependsOn: ['build'],
      exec: {
        command: 'bun --bun astro preview',
        env: { define: { ASTRO_TELEMETRY_DISABLED: '1' } },
        persistent: { readyWhen: 'Local' },
        timeout: 120000,
        sandbox: {
          allow: {
            read: ['**/*'],
            systemInfo: ['vfs.disk-space', 'net.link.addr'],
            machLookup: ['com.apple.SystemConfiguration.DNSConfiguration'],
            localBinding: true,
          },
        },
      },
    },
  },
})
