import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  planDistributionChange,
  applyDistributionChange,
  undoDistributionChange,
} from '../../lib/config/distribution-change.mjs'
import { defaultDistributionSelection } from '../../lib/config/execution-distribution.mjs'
describe('explicit distribution migration', () => {
  it('previews and applies exact policy only, rejects drift, and restores original bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'distribution-'))
    try {
      const file = join(root, 'agent-workflow.config.json'),
        original =
          JSON.stringify({
            routing: { defaultMode: 'single-agent' },
            delivery: { runId: 'existing', generation: 0 },
            adapters: {
              openrig: {
                executionPolicy: {
                  activation: 'held',
                  seats: { 'dev.build': { model: 'qwen/qwen3.8-27b' } },
                },
              },
            },
          }) + '\n'
      writeFileSync(file, original)
      const plan = planDistributionChange(root)
      expect(readFileSync(file, 'utf8')).toBe(original)
      expect(() => applyDistributionChange(root, plan, 'yes')).toThrow(/confirmation/)
      const receipt = applyDistributionChange(root, plan, plan.digest),
        applied = JSON.parse(readFileSync(file, 'utf8'))
      expect(applied.executionDistribution).toEqual(defaultDistributionSelection())
      expect(applied.delivery).toEqual({ runId: 'existing', generation: 0 })
      expect(applied.adapters.openrig.executionPolicy).toEqual({ activation: 'held' })
      expect(() => applyDistributionChange(root, plan, plan.digest)).toThrow(/changed/)
      const r = JSON.parse(readFileSync(join(root, receipt.receipt), 'utf8'))
      undoDistributionChange(root, receipt.receipt, r.digest)
      expect(readFileSync(file, 'utf8')).toBe(original)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('rejects an unrelated config edit after preview and never resets it', () => {
    const root = mkdtempSync(join(tmpdir(), 'distribution-'))
    try {
      const file = join(root, 'agent-workflow.config.json')
      writeFileSync(file, '{}')
      const plan = planDistributionChange(root)
      writeFileSync(file, '{"owner":"changed"}')
      expect(() => applyDistributionChange(root, plan, plan.digest)).toThrow(/changed/)
      expect(readFileSync(file, 'utf8')).toBe('{"owner":"changed"}')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('exposes the complete policy through the public CLI without writes', () => {
    const p = spawnSync(process.execPath, ['bin/cli.mjs', 'distribution', 'catalog', '--json'], {
      encoding: 'utf8',
    })
    expect(p.status).toBe(0)
    const x = JSON.parse(p.stdout)
    expect(x.roles['dev.build'].options[0].model).toBe('gemini-3.8-flash')
    expect(x.roles['dev.build'].options).toHaveLength(3)
  })
})
