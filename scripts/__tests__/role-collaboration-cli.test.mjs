import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRoleHandoff } from '../../lib/role-catalog.mjs'
import {
  createAcceptanceContract,
  createAcceptanceDecision,
  createDeliveryReceipt,
} from '../../lib/core/role-collaboration.mjs'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

describe('role collaboration CLI', () => {
  it('verifies delivery and gates advancement against source evidence and the rework ledger', () => {
    const target = mkdtempSync(join(tmpdir(), 'agentflow-role-gate-'))
    try {
      writeFileSync(
        join(target, 'sdlc.config.json'),
        readFileSync(new URL('../../defaults/sdlc.config.json', import.meta.url)),
      )
      const ref = {
        kind: 'validation',
        system: 'local',
        uri: 'validation.json',
        authority: 'working-copy',
        relationship: 'verifies',
        digest: 'c'.repeat(64),
      }
      const contract = createAcceptanceContract({
        id: 'contract',
        subject: 'issue:188',
        ownerRole: 'agentflow:implementation-planner',
        deliveryRole: 'agentflow:developer',
        candidateDigest: 'a'.repeat(64),
        criteria: [
          { id: 'tests', description: 'tests pass', verification: 'deterministic', required: true },
        ],
      })
      const handoff = createRoleHandoff({
        id: 'handoff',
        subject: contract.subject,
        state: 'issued',
        fromRole: contract.ownerRole,
        toRole: contract.deliveryRole,
        rolePassId: 'planning-pass',
        profile: 'standard',
        actionBoundary: 'propose',
        inputRefs: [ref],
        outputRefs: [ref],
        validationRefs: [ref],
        expectedAction: 'implement',
        acceptanceCriteria: ['tests pass'],
        acceptanceContract: contract,
        openQuestions: [],
        methodPlays: [],
        provenance: {
          platform: 'codex',
          executor: 'codex-cli',
          transport: 'local-cli',
          delegationBoundary: 'current-session',
        },
      })
      const delivery = createDeliveryReceipt({
        id: 'delivery',
        handoffDigest: handoff.digest,
        contractDigest: contract.digest,
        producerRole: contract.deliveryRole,
        candidateDigest: contract.candidateDigest,
        criteriaResults: [{ criterionId: 'tests', status: 'pass', evidenceRefs: [ref] }],
        evidenceRefs: [ref],
        provenance: handoff.provenance,
      })
      const decision = createAcceptanceDecision({
        id: 'decision',
        handoff,
        contract,
        delivery,
        decidedByRole: contract.ownerRole,
        state: 'accepted',
        provenance: handoff.provenance,
      })
      for (const [name, value] of Object.entries({ handoff, delivery, decision, rework: [] })) {
        writeFileSync(join(target, `${name}.json`), JSON.stringify(value))
      }
      const run = (command, extra = []) =>
        spawnSync(
          process.execPath,
          [
            cli,
            'collaboration',
            command,
            '--target',
            target,
            '--handoff',
            'handoff.json',
            '--delivery',
            'delivery.json',
            '--json',
            ...extra,
          ],
          { encoding: 'utf8' },
        )
      const verification = run('verify')
      expect(verification.status, verification.stderr || verification.stdout).toBe(0)
      const flags = ['--decision', 'decision.json', '--rework', 'rework.json']
      const advancement = run('advance', flags)
      expect(advancement.status, advancement.stderr || advancement.stdout).toBe(0)
      writeFileSync(join(target, 'rework.json'), JSON.stringify([{ id: 'unresolved' }]))
      expect(run('advance', flags).status).toBe(1)
      expect(run('advance', ['--decision', 'decision.json']).status).toBe(1)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })
})
