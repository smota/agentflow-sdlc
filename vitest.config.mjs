import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.test.mjs', 'lib/**/*.test.mjs', 'adapters/**/*.test.mjs'],
    // Historical feasibility evidence uses node:test; execute it with node --test.
    exclude: ['scripts/spikes/process-authority/delegation-grant.test.mjs'],
    // Many tests spawn git and node child processes. With one worker per core on a large machine
    // they starve each other and hit the 5 s default, so bound the workers and allow slower spawns.
    testTimeout: 30_000,
    poolOptions: { forks: { minForks: 1, maxForks: 8 } },
  },
})
