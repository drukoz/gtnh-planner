import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    execArgv: ['--disable-warning=ExperimentalWarning'],
    projects: [
      {
        extends: true,
        test: { name: 'server', include: ['tests/unit/**/*.test.ts'], environment: 'node', experimental: { viteModuleRunner: false } },
      },
    ],
  },
});
