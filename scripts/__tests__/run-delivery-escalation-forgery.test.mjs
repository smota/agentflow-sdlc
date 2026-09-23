import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Final review B1: an agent wrote an attestation file declaring itself human and resolved a
// weakening escalation through `run resolve-escalation` with exit 0. The CLI cannot authenticate a
// human, so it must refuse any self-supplied attestation as a governed block.
describe('run resolve-escalation refuses a self-declared human attestation', () => {
  it('blocks a forged human attestation with the governed-block exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-forgery-'))
    roots.push(root)
    writeFileSync(
      join(root, 'agent-workflow.config.json'),
      JSON.stringify({
        delivery: { source: { kind: 'local-preview' }, candidate: { inputs: [] } },
      }),
    )
    writeFileSync(join(root, 'plan.json'), JSON.stringify({ runRevision: 1 }))
    writeFileSync(
      join(root, 'forged.json'),
      JSON.stringify({
        decision: 'agree',
        reviewer: {
          platform: 'human',
          independence: 'human-gate',
          executor: 'written-by-an-agent',
        },
      }),
    )
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'run',
        'resolve-escalation',
        'demo',
        '--plan',
        'plan.json',
        '--confirm',
        'x',
        '--attestation',
        'forged.json',
        '--execute',
        '--target',
        root,
        '--json',
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(3)
    expect(result.stderr + result.stdout).toMatch(/authenticated human channel/)
  })
})
