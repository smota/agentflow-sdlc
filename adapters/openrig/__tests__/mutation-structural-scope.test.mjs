import { describe, it, expect } from 'vitest'
import { planRigMutation, applyRigMutation, createRigMutationOperation } from '../mutation.mjs'
import { inspectProcessRuntime } from '../../../lib/verification/process-collector.mjs'
const rigText =
  'name: scope\npods:\n  - id: dev\n    members:\n      - id: build\n        runtime: codex\n        model: gpt-6.1-sol\n        effort: medium\n        profile: builder\n      - id: qa\n        runtime: codex\n        model: gpt-6.1-sol\n        effort: medium\n        profile: builder\n'
const configText =
  'recommended: keep\nseats:\n  dev.build:\n    runtimes: {codex: builder}\n  dev.qa:\n    runtimes: {codex: builder}\npresets:\n  keep: {dev.build: codex, dev.qa: codex}\n'
const workflow = {
  protocol: 'run-v1',
  runId: 'scope',
  owner: 'writer',
  revision: 'revision',
  sourceRevision: 'source',
  generation: 0,
  revocationEpoch: 0,
  oracleDigest: null,
  custody: null,
  checkpointDigest: 'a'.repeat(64),
  publicationHolds: ['human'],
}
function fixture() {
  const contracts = ['dev.build', 'dev.qa'].map((seat) => ({
    seat,
    runtime: 'codex',
    executionTarget: 'codex-cli',
    providerRoute: 'openai-codex',
    providerFamily: 'openai',
    model: 'gpt-6.1-sol',
    effort: 'medium',
    profile: 'builder',
    capabilityTier: seat === 'dev.qa' ? 'deep-reasoning' : 'balanced',
  }))
  const installed = {
    rigText,
    contracts,
    sourceRevision: 'spec',
    occupants: { 'dev.build': { sessionId: 'old', generation: 0 } },
  }
  const executorIdentity = inspectProcessRuntime(process.cwd(), {
    executable: process.execPath,
  }).identity
  const plan = planRigMutation({
    rigName: 'scope',
    desired: {
      rigText: rigText.replace('name: scope', 'name: scope\nenv: {MODE: changed}'),
      configText,
    },
    installed,
    workflow,
    executorIdentity,
  })
  return { plan, installed, executorIdentity }
}
describe('structural mutation blast radius (#523)', () => {
  it('marks every seat for restart on global non-tuple configuration changes', () => {
    const { plan } = fixture()
    expect(plan.affectedSeats).toEqual(['dev.build', 'dev.qa'])
    expect(plan.restarts).toEqual(['dev.build', 'dev.qa'])
    expect(plan.changes.every((c) => c.structuralConfigurationChanged)).toBe(true)
  })
  it('holds before dispatch when any affected incumbent lacks a source identity', async () => {
    const f = fixture(),
      operation = createRigMutationOperation({
        plan: f.plan,
        id: 'apply',
        policyDigest: 'b'.repeat(64),
        repository: 'test/repo',
        base: 'main',
        delegate: 'operator',
        candidateDigest: 'c'.repeat(64),
        workspaceDigest: 'd'.repeat(64),
        checks: [],
        review: {},
      })
    let dispatches = 0,
      admissions = 0
    const runService = {
      read: async () => ({
        revision: workflow.revision,
        sourceRevision: workflow.sourceRevision,
        state: { ...workflow, oracleCustody: null, admissions: {} },
      }),
      executeDelegatedOperation: async () => {
        admissions++
      },
    }
    const inspectContext = async () => ({
      verified: true,
      sourceRef: 'fixture://source',
      sourceRevision: f.installed.sourceRevision,
      installedRigText: rigText,
      workflow,
      workspaceDigest: operation.workspaceDigest,
      executorIdentity: f.executorIdentity,
      occupants: f.installed.occupants,
      checkpoint: {
        verified: true,
        digest: workflow.checkpointDigest,
        sourceRef: 'fixture://checkpoint',
      },
      priorWriters: { stopped: true, sourceRef: 'fixture://prior' },
      runtimeGuards: {
        version: 1,
        sourceRef: 'fixture://guards',
        sourceRevision: 'guard1',
        capabilities: ['source-revision-cas', 'occupant-cas', 'executor-digest'],
      },
    })
    await expect(
      applyRigMutation({
        plan: f.plan,
        runService,
        operation,
        authority: { owner: 'writer', generation: 0 },
        grantId: 'fixture',
        inspectContext,
        dispatch: async () => {
          dispatches++
        },
      }),
    ).rejects.toThrow(/occupant|observation/i)
    expect(admissions).toBe(0)
    expect(dispatches).toBe(0)
  })
  it('rejects YAML alias expansion before creating a mutation plan', () => {
    const f = fixture()
    expect(() =>
      planRigMutation({
        rigName: 'scope',
        desired: {
          rigText: rigText + 'extra: &shared {mode: example}\ncopy: *shared\n',
          configText,
        },
        installed: f.installed,
        workflow,
        executorIdentity: f.executorIdentity,
      }),
    ).toThrow(/alias/i)
  })
})
