import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
it('public liveness help succeeds without evaluating a missing result', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url)), 'steer', 'liveness', '--help'],
    { encoding: 'utf8', timeout: 10000 },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Usage:')
  expect(result.stderr).not.toContain('ReferenceError')
})
