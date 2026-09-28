import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDelivery } from '../run-delivery.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { fingerprintCandidate } from '../../lib/verification/workspace.mjs'
import { createHostIntentConsent } from '../../lib/core/intent-consent.mjs'
import {
  createAcceptanceContract,
  createAcceptanceDecision,
  createDeliveryReceipt,
} from '../../lib/core/role-collaboration.mjs'
import { createRoleHandoff } from '../../lib/role-catalog.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function project() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'af-intent-cli-'))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/candidate.js'), 'export const candidate = true\n')
  const candidate = { inputs: ['src/candidate.js'] }
  const check = {
    id: 'test',
    criterionId: 'test',
    executable: process.execPath,
    args: ['-e', 'process.exit(0)'],
    assertions: ['works'],
    timeoutMs: 5000,
    format: 'exit-code',
  }
  const digest = fingerprintCandidate(root, candidate).digest
  const bilateral = createAcceptanceContract({
    id: 'handover-policy',
    subject: 'issue:301',
    ownerRole: 'agentflow:product-manager',
    deliveryRole: 'agentflow:product-manager',
    collaborationClass: 'linear',
    candidateDigest: digest,
    criteria: [
      { id: 'test', description: 'Observed check', verification: 'deterministic', required: true },
    ],
    councilPolicy: { required: false, seats: [], decisionOwner: 'agentflow:product-manager' },
  })
  const handoff = createRoleHandoff({
    id: 'handover',
    subject: 'issue:301',
    state: 'issued',
    fromRole: bilateral.ownerRole,
    toRole: bilateral.deliveryRole,
    acceptanceContract: bilateral,
  })
  const evidenceRef = {
    kind: 'validation',
    system: 'local',
    uri: 'observed:test',
    authority: 'working-copy',
    relationship: 'verifies',
  }
  const delivery = createDeliveryReceipt({
    id: 'delivery',
    handoffDigest: handoff.digest,
    contractDigest: bilateral.digest,
    producerRole: bilateral.deliveryRole,
    candidateDigest: digest,
    criteriaResults: [{ criterionId: 'test', status: 'pass', evidenceRefs: [evidenceRef] }],
    evidenceRefs: [evidenceRef],
    provenance: { platform: 'codex', executor: 'test-fixture' },
  })
  const decision = createAcceptanceDecision({
    id: 'accepted',
    handoff,
    contract: bilateral,
    delivery,
    decidedByRole: bilateral.ownerRole,
    state: 'accepted',
    provenance: { platform: 'codex', executor: 'test-fixture' },
  })
  const contract = {
    version: 2,
    goalRevision: 'goal:301',
    ownerRole: bilateral.ownerRole,
    collaborationContractDigest: bilateral.digest,
    criteria: [
      {
        id: 'test',
        definitionDigest: recordDigest({ ...check, ...candidate }),
        assertions: ['works'],
      },
    ],
  }
  const configuration = {
    posture: 'assisted',
    delivery: {
      source: { kind: 'local-preview' },
      candidate,
      checks: { test: check },
      contracts: { 'product-manager': 'contract.json' },
      collaboration: { 'product-manager': 'collaboration.json' },
    },
  }
  writeFileSync(join(root, 'agent-workflow.config.json'), JSON.stringify(configuration))
  writeFileSync(join(root, 'contract.json'), JSON.stringify(contract))
  writeFileSync(
    join(root, 'collaboration.json'),
    JSON.stringify({ handoff, contract: bilateral, delivery, decision }),
  )
  return { root, configuration }
}

async function call(root, command, options = []) {
  const output = []
  const code = await runDelivery(
    [command, 'run', '--target', root, '--json', '--writer', 'writer', ...options],
    { emit: (value) => output.push(value) },
  )
  return { code, result: output.at(-1)?.result }
}

it('public intent plan and exact typed relay advance phase zero, while no receipt denies', async () => {
  const { root, configuration } = await project()
  await call(root, 'start', ['--execute', '--goal', 'issue:301'])
  await call(root, 'freeze', ['--execute'])
  await call(root, 'verify', ['--execute', '--check', 'test'])
  const next = await call(root, 'next')
  const plan = next.result.advancePlan
  const planPath = join(root, 'advance.json')
  writeFileSync(planPath, JSON.stringify(plan))
  const options = ['--execute', '--plan', 'advance.json', '--confirm', recordDigest(plan)]
  const consentPlan = await call(root, 'intent-plan', options)
  const request = consentPlan.result.request
  expect(request.gateClass).toBe('adequacy-of-intent')
  expect(request.scope.expiry.effectGrant).toBe('separate-typed-grant-required')
  await expect(call(root, 'advance', options)).rejects.toThrow(/intent consent/)
  const receipt = createHostIntentConsent({
    request,
    decision: 'agree',
    observerRuntime: 'codex',
    sessionDigest: '1'.repeat(64),
    turnDigest: '2'.repeat(64),
    evidenceDigest: '3'.repeat(64),
    decisionRef: '4'.repeat(64),
    observedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })
  writeFileSync(join(root, 'consent.json'), JSON.stringify(receipt))
  await expect(
    call(root, 'advance', [
      ...options,
      '--consent',
      'consent.json',
      '--consent-confirm',
      '0'.repeat(64),
    ]),
  ).rejects.toThrow(/digest confirmation/)
  configuration.delivery.budget = { level: 'advisory', limit: 1, unit: 'attempts' }
  writeFileSync(join(root, 'agent-workflow.config.json'), JSON.stringify(configuration))
  await expect(
    call(root, 'advance', [
      ...options,
      '--consent',
      'consent.json',
      '--consent-confirm',
      recordDigest(receipt),
    ]),
  ).rejects.toThrow(/intent consent/)
  delete configuration.delivery.budget
  writeFileSync(join(root, 'agent-workflow.config.json'), JSON.stringify(configuration))
  const advanced = await call(root, 'advance', [
    ...options,
    '--consent',
    'consent.json',
    '--consent-confirm',
    recordDigest(receipt),
  ])
  expect(advanced.result.role).toBe('analyst')
  const events = JSON.parse(readFileSync(join(root, '.agent-runs/runs/run/events.json'), 'utf8'))
  expect(events.at(-1).payload.intentConsent.requestDigest).toBe(request.digest)
  expect(JSON.stringify(events.at(-1))).not.toContain(root)
  expect(configuration.delivery.source.kind).toBe('local-preview')
})

it('does not let standard posture start with an external-action business ceiling', async () => {
  const { root } = await project()
  await expect(
    call(root, 'start', ['--execute', '--goal', 'issue:301', '--boundary', 'external-action']),
  ).rejects.toThrow(/Business boundary exceeds/)
})
