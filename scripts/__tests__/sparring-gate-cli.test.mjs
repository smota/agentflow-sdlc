import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  computeTargetIdentityDigest,
  createReviewTargetIdentity,
} from '../../lib/core/sparring.mjs'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))
const gateScript = fileURLToPath(new URL('../validate-sparring-gate.mjs', import.meta.url))

describe('sparring gate CLI & harness intelligence', () => {
  it('generates a sparring brief with deterministic slice hash', () => {
    const res = spawnSync(
      process.execPath,
      [
        gateScript,
        '--brief',
        '--objective',
        'Authentication Security Audit',
        '--contract-slice',
        'export function authenticate() {}',
        '--json',
      ],
      { encoding: 'utf8' },
    )
    expect(res.status).toBe(0)
    const data = JSON.parse(res.stdout)
    expect(data.objective).toBe('Authentication Security Audit')
    expect(data.contractSliceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(data.requiredTaxonomy).toEqual(['blocker', 'structural', 'nit'])
  })

  it('applies review round receipts to a resolution ledger and gates advancement', () => {
    const target = mkdtempSync(join(tmpdir(), 'agentflow-sparring-cli-'))
    try {
      const identity = createReviewTargetIdentity({
        workItemId: 'ISSUE-50',
        cycle: 'C-01',
        contractDigest: '1'.repeat(64),
        sliceManifestDigest: '2'.repeat(64),
        policyDigest: '3'.repeat(64),
      })
      const targetDigest = computeTargetIdentityDigest(identity)

      const identityPath = join(target, 'target-identity.json')
      writeFileSync(identityPath, JSON.stringify(identity, null, 2))

      const ledgerPath = join(target, 'review-ledger.json')

      // Round 1: Changes required (blocker found)
      const receipt1 = {
        round: 1,
        cycle: 'C-01',
        targetIdentityDigest: targetDigest,
        fencingToken: 1,
        reviewer: {
          platform: 'codex',
          executor: 'codex-cli',
          model: 'gpt-6-astra',
        },
        delegationTopology: 'cli-process',
        independenceClassification: 'independent',
        disposition: 'changes-required',
        findings: [
          {
            id: 'B-1',
            severity: 'blocker',
            citation: 'src/auth.mjs:42',
            description: 'Token replay vulnerability',
            status: 'open',
          },
        ],
      }
      const receipt1Path = join(target, 'receipt-1.json')
      writeFileSync(receipt1Path, JSON.stringify(receipt1, null, 2))

      // Apply round 1
      const apply1 = spawnSync(
        process.execPath,
        [
          gateScript,
          '--apply',
          '--target',
          target,
          '--ledger',
          ledgerPath,
          '--receipt',
          receipt1Path,
          '--target-identity',
          identityPath,
          '--json',
        ],
        { encoding: 'utf8' },
      )
      expect(apply1.status).toBe(0)
      const apply1Data = JSON.parse(apply1.stdout)
      expect(apply1Data.status).toBe('open')
      expect(apply1Data.currentRound).toBe(1)

      // Evaluate gate: should be locked (exit 1)
      const eval1 = spawnSync(
        process.execPath,
        [gateScript, '--target', target, '--ledger', ledgerPath, '--json'],
        { encoding: 'utf8' },
      )
      expect(eval1.status).toBe(1)
      const eval1Data = JSON.parse(eval1.stdout)
      expect(eval1Data.ok).toBe(false)
      expect(eval1Data.errors.some((e) => e.includes('unresolved blockers'))).toBe(true)

      // Round 2: Blocker verified closed and approved
      const receipt2 = {
        round: 2,
        cycle: 'C-01',
        targetIdentityDigest: targetDigest,
        fencingToken: 2,
        reviewer: {
          platform: 'codex',
          executor: 'codex-cli',
          model: 'gpt-6-astra',
        },
        delegationTopology: 'cli-process',
        independenceClassification: 'independent',
        disposition: 'approved',
        findings: [
          {
            id: 'B-1',
            severity: 'blocker',
            citation: 'src/auth.mjs:42',
            description: 'Token replay vulnerability',
            status: 'verified_closed',
          },
        ],
      }
      const receipt2Path = join(target, 'receipt-2.json')
      writeFileSync(receipt2Path, JSON.stringify(receipt2, null, 2))

      const resolutions = {
        'B-1': 'Fixed token replay vulnerability in commit abc1234 by adding nonce cache.',
      }
      const resolutionsPath = join(target, 'resolutions.json')
      writeFileSync(resolutionsPath, JSON.stringify(resolutions, null, 2))

      // Apply round 2
      const apply2 = spawnSync(
        process.execPath,
        [
          gateScript,
          '--apply',
          '--target',
          target,
          '--ledger',
          ledgerPath,
          '--receipt',
          receipt2Path,
          '--target-identity',
          identityPath,
          '--resolutions',
          resolutionsPath,
          '--json',
        ],
        { encoding: 'utf8' },
      )
      expect(apply2.status).toBe(0)
      const apply2Data = JSON.parse(apply2.stdout)
      expect(apply2Data.status).toBe('approved')
      expect(apply2Data.currentRound).toBe(2)

      // Evaluate gate: should now unlock (exit 0)
      const eval2 = spawnSync(
        process.execPath,
        [gateScript, '--target', target, '--ledger', ledgerPath, '--json'],
        { encoding: 'utf8' },
      )
      expect(eval2.status).toBe(0)
      const eval2Data = JSON.parse(eval2.stdout)
      expect(eval2Data.ok).toBe(true)
      expect(eval2Data.unlocked).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('scaffolds and inspects harness intelligence 4-pillars via CLI', () => {
    const target = mkdtempSync(join(tmpdir(), 'agentflow-harness-cli-'))
    try {
      // 1. Inspect unconfigured directory
      const inspect1 = spawnSync(
        process.execPath,
        [cli, 'harness', 'inspect', '--target', target, '--json'],
        { encoding: 'utf8' },
      )
      expect(inspect1.status).toBe(0)
      const data1 = JSON.parse(inspect1.stdout)
      expect(data1.configuredCount).toBe(0)
      expect(data1.totalPillars).toBe(4)

      // 2. Scaffold pillars
      const scaffold = spawnSync(
        process.execPath,
        [cli, 'harness', 'scaffold', '--target', target, '--json'],
        { encoding: 'utf8' },
      )
      expect(scaffold.status).toBe(0)
      const scData = JSON.parse(scaffold.stdout)
      expect(scData.created.length).toBe(4)

      // 3. Inspect configured directory
      const inspect2 = spawnSync(
        process.execPath,
        [cli, 'harness', 'inspect', '--target', target, '--json'],
        { encoding: 'utf8' },
      )
      expect(inspect2.status).toBe(0)
      const data2 = JSON.parse(inspect2.stdout)
      expect(data2.configuredCount).toBe(4)
      expect(data2.status['orchestration-model.json'].exists).toBe(true)
      expect(data2.status['execution-policy.json'].exists).toBe(true)
      expect(data2.status['model-catalog.json'].exists).toBe(true)
      expect(data2.status['harness-parameters.json'].exists).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })
})
