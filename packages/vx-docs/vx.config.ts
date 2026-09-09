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
