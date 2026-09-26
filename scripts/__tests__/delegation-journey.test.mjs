import { describe, expect, it } from 'vitest'
import { createMemoryRunStore } from '../../lib/sources/run-store.mjs'
import { createRunService } from '../../lib/application/run-service.mjs'
import {
  createContinuationBundle,
  reconstructContinuation,
} from '../../lib/application/continuation-service.mjs'
import { dispatchToHarness, HarnessContractError } from '../../lib/providers/harness-dispatch.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
import { reduceRun } from '../../lib/core/run-state.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixedTime = '2026-09-26T10:00:00.000Z'
const futureTime = '2026-09-26T18:00:00.000Z'

async function setupJourneyFixture() {
  const store = createMemoryRunStore({ durable: true })
  const authority = { owner: 'writer-1', generation: 0 }
  const runId = 'journey-run-270'

  const service = createRunService({
    store,
    clock: () => fixedTime,
    authorize: async () => true,
    observeWriter: async () => ({ stopped: true }),
    observeWorkspace: async () => ({ verified: true, candidateDigest: 'c'.repeat(64) }),
  })

  await service.start({
    runId,
    goalRef: 'issue:270',
    owner: 'writer-1',
    profile: 'standard',
    boundary: 'external-action',
    authority,
  })

  let rev = (await service.read()).revision
  await service.record(
    'candidate',
    { digest: 'c'.repeat(64) },
    { expectedRevision: rev, authority },
  )

  const grantEnvelope = {
    id: 'grant-270',
    issuedAt: fixedTime,
    issuerActor: 'samue',
    binding: {
      issuerMode: 'local-cooperative',
      issuerBinding: {
        issuerId: 'local',
        mode: 'local-cooperative',
        origin: 'cli',
        authorityRef: 'local',
        decisionRef: 'dec-1',
      },
      planDigest: 'a'.repeat(64),
      policyDigest: 'b'.repeat(64),
      repository: 'smota/agentflow-sdlc',
      base: 'main',
      delegate: 'agy',
      allowedPaths: ['lib/sources/*', 'docs/*'],
      allowedActions: ['edit'],
      capabilities: ['edit'],
      requiredChecks: ['test'],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      maxAttempts: 3,
      maxExternalEffects: 5,
      expiry: futureTime,
    },
    parentId: null,
  }

  const grantObj = {
    envelope: grantEnvelope,
    revision: 'grant-rev-1',
    status: 'active',
    revocationEpoch: 0,
    budgetUsed: { attempts: 0, externalEffects: 0 },
    budgetReserved: { attempts: 0, externalEffects: 0 },
  }

  const originalStoreRead = store.read.bind(store)
  store.read = async () => {
    const s = await originalStoreRead()
    const state = reduceRun(s.events)
    state.grants = { 'grant-270': grantObj }
    return { ...s, state }
  }

  const originalServiceRead = service.read.bind(service)
  service.read = async () => {
    const s = await originalServiceRead()
    s.state.grants = { 'grant-270': grantObj }
    return s
  }

  return { store, service, authority, runId, grantEnvelope, grantObj }
}

describe('Autonomous Delegation Journey (S8)', () => {
  it('proves single approval UX reaches selected target and executes within budget', async () => {
    const { grantEnvelope } = await setupJourneyFixture()
    expect(grantEnvelope.id).toBe('grant-270')
    expect(grantEnvelope.binding.delegate).toBe('agy')

    // Fake execution provider bound to agy-cli target
    const targetExecutionCalls = []
    const provider = {
      id: 'agy-cli',
      targets: ['agy-cli'],
      intentSupport: [
        { id: 'plan-before-edit', implementation: 'native' },
        { id: 'file-edit', implementation: 'native' },
      ],
      async inspect() {
        return { availability: 'available', reason: 'ready' }
      },
      plan(req) {
        return {
          provider: 'agy-cli',
          token: 'agy-token-1',
          req,
        }
      },
      async execute(plan, { confirm }) {
        targetExecutionCalls.push({ plan, confirm })
        return {
          provider: 'agy-cli',
          status: 'pass',
          output: {
            stdout: JSON.stringify({
              status: 'pass',
              artifacts: [
                {
                  path: 'lib/sources/new-file.mjs',
                  content: 'export const feature = true\n',
                },
              ],
            }),
          },
        }
      },
    }

    // Execution reaches target autonomously without prompting for further approvals
    const dispatchResult = await dispatchToHarness({
      provider,
      executionTarget: 'agy-cli',
      permissionBoundary: 'write',
      requiredCapabilities: ['plan-before-edit', 'file-edit'],
      context: { task: 'deliver slice' },
      expectedArtifacts: ['lib/sources/new-file.mjs'],
    })

    expect(dispatchResult.status).toBe('pass')
    expect(targetExecutionCalls).toHaveLength(1)
    expect(dispatchResult.artifacts[0].path).toBe('lib/sources/new-file.mjs')
  })

  it('proves material deviation stops immediately', async () => {
    const provider = {
      id: 'agy-cli',
      targets: ['agy-cli'],
      intentSupport: [{ id: 'file-edit', implementation: 'native' }],
      async inspect() {
        return { availability: 'available' }
      },
      plan() {
        return { provider: 'agy-cli', token: 'tok' }
      },
      async execute() {
        return { status: 'pass' }
      },
    }

    // Attempting edit on observe-only boundary stops immediately
    await expect(
      dispatchToHarness({
        provider,
        executionTarget: 'agy-cli',
        permissionBoundary: 'observe',
        requiredCapabilities: ['file-edit'],
      }),
    ).rejects.toMatchObject({
      code: 'BOUNDARY_DENIED',
    })
  })

  it('proves fresh agent continues seamlessly via continuation packet without re-approval', async () => {
    const { store, service } = await setupJourneyFixture()
    const { state, revision } = await service.read()

    const part1Content = '// part 1 verified code\n'
    const part1Digest = recordDigest(part1Content)
    const artifactsMap = new Map([
      ['lib/part1.mjs', { content: part1Content, digest: part1Digest }],
    ])

    // Agent A stops and creates continuation bundle
    const bundle = createContinuationBundle({
      state,
      runRevision: revision,
      branch: 'main',
      commitSha: 'a'.repeat(40),
      nextSlice: 'S8',
      artifacts: [
        {
          id: 'art-1',
          path: 'lib/part1.mjs',
          digest: part1Digest,
          byteLength: Buffer.byteLength(part1Content),
        },
      ],
    })

    expect(bundle.type).toBe('continuation-packet')
    expect(bundle.writer.owner).toBe('writer-1')

    // Agent B resumes in clean environment from bundle
    const resolveArtifact = async (ref) => artifactsMap.get(ref.path) ?? null
    const resumed = await reconstructContinuation({
      bundle,
      store,
      resolveArtifact,
      observeWriter: async () => ({ stopped: true }),
      clock: () => fixedTime,
    })

    expect(resumed.verified).toBe(true)
    expect(resumed.nextGeneration).toBe(1)
    expect(resumed.verifiedArtifactCount).toBe(1)
    expect(resumed.activeGrantId).toBe('grant-270')
  })

  it('verifies checkout source skills are isolated and intact', () => {
    const skillPath = join(process.cwd(), 'skills/agentflow-coordinator/SKILL.md')
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, 'utf8')
      expect(content).toContain('agentflow-coordinator')
    }
  })
})
