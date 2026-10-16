import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDelivery } from '../run-delivery.mjs'
const roots = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
it('reports a missing configured run honestly without creating a source or counting metadata as errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'incident-cli-'))
  roots.push(root)
  writeFileSync(
    join(root, 'agent-workflow.config.json'),
    JSON.stringify({ delivery: { source: { kind: 'local-preview' }, candidate: { inputs: [] } } }),
  )
  const emitted = []
  const code = await runDelivery(['incidents', 'absent', '--target', root, '--json'], {
    emit: (value) => emitted.push(value),
  })
  expect(code).toBe(0)
  expect(emitted[0].result).toMatchObject({
    version: 1,
    status: 'unknown',
    assurance: 'cooperative',
    failures: 0,
    incidents: [],
    oracles: [],
  })
  expect(emitted[0].result.unknowns).toContain('source-unavailable-or-invalid')
  expect(existsSync(join(root, '.agent-runs/runs/absent/events.json'))).toBe(false)
})
