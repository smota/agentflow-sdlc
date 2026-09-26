import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

it('preserves and runs the historical authority spike with its native node:test runner', () => {
  const testFile = fileURLToPath(
    new URL('../spikes/process-authority/delegation-grant.test.mjs', import.meta.url),
  )
  const result = spawnSync(process.execPath, ['--test', testFile], {
    encoding: 'utf8',
    timeout: 10000,
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
})
