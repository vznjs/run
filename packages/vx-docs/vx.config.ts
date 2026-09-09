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
        command: 'astro build',
        // astro's telemetry does `mkdir ~/.config` before anything else; a
        // sandboxed task may read HOME but not write it, so on Linux astro
        // threw EROFS at startup (exit 1 in 225 ms, no output) until the
        // telemetry was told to stay home.
        env: { define: { ASTRO_TELEMETRY_DISABLED: '1' } },
        sandbox: {
          allow: {
            read: ['**/*'],
            write: ['dist/**', '.astro/**', 'node_modules/.astro/**', 'node_modules/.vite/**'],
            systemInfo: ['vfs.disk-space', 'net.link.addr'],
            machLookup: ['com.apple.SystemConfiguration.DNSConfiguration'],
            localBinding: true,
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
        command: 'astro dev',
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
        command: 'astro preview',
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
