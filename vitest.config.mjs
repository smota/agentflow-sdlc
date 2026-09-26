import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.test.mjs', 'lib/**/*.test.mjs'],
    // Historical feasibility evidence uses node:test; execute it with node --test.
    exclude: ['scripts/spikes/process-authority/delegation-grant.test.mjs'],
  },
})
