import { describe, expect, it } from 'vitest'
import {
  resolveCollaborationPlan,
  selectCollaborationMode,
  planBoundExecution,
} from '../collaboration-plan.mjs'
import { createLocalCliProvider } from '../providers/local-cli.mjs'
import { createManualProvider } from '../providers/manual.mjs'

function provider(intentSupport = [], id = 'test-cli') {
  return createLocalCliProvider({
    id,
    platform: 'codex',
    executable: 'test-cli',
    executionTarget: 'codex-cli',
    intentSupport: [
      {
        id: 'workflow-orchestration',
        implementation: 'emulated',
        fidelity: 'full',
        evidence: 'contract-tested',
        limits: {},
      },
      ...intentSupport,
    ],
    spawn: () => ({ status: 0, stdout: 'test-cli 1.0.0', stderr: '' }),
  })
}

describe('collaboration plan', () => {
  it('keeps low-risk work single-agent', () => {
    expect(
      selectCollaborationMode({
        requestedMode: 'auto-minimal',
        profile: 'bounded',
        risk: 'low',
        effort: 'low',
        uncertainty: 'low',
      }),
    ).toBe('single-agent')
  })

  it('uses human gate for sensitive surfaces', () => {
    expect(
      selectCollaborationMode({
        requestedMode: 'auto-minimal',
        profile: 'standard',
        changeSurface: ['security'],
      }),
    ).toBe('human-gated')
    expect(
      selectCollaborationMode({ requestedMode: 'single-agent', profile: 'high-assurance' }),
    ).toBe('human-gated')
    expect(
      selectCollaborationMode({ changeSurface: ['security'], policy: { sensitiveSurfaces: [] } }),
    ).toBe('human-gated')
  })

  it('uses council for high uncertainty', () => {
    expect(selectCollaborationMode({ requestedMode: 'auto-minimal', uncertainty: 'high' })).toBe(
      'council',
    )
  })

  it('resolves a provider-backed advisory plan', async () => {
    const result = await resolveCollaborationPlan({
      requestedMode: 'advisory',
      preferredProvider: 'test-cli',
      providers: [
        provider([
          {
            id: 'delegated-work',
            implementation: 'native',
            fidelity: 'full',
            evidence: 'probed',
            limits: { maxDelegates: 2 },
          },
        ]),
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.plan.collaborationMode).toBe('advisory')
    expect(result.plan.helpers).toHaveLength(1)
    expect(result.plan.writer).toBe('parent')
  })

  it('degrades delegation to the explicit sequential fallback', async () => {
    const executor = provider()
    const result = await resolveCollaborationPlan({
      requestedMode: 'council',
      preferredProvider: 'test-cli',
      providers: [executor],
    })
    expect(result.ok).toBe(true)
    expect(result.plan.binding.status).toBe('degraded')
    expect(result.plan.environment).toBe('current-session')
    expect(result.plan.binding.intentResolutions).toContainEqual(
      expect.objectContaining({ id: 'delegated-work', fallback: 'sequential', status: 'degraded' }),
    )
    const execution = planBoundExecution({
      provider: executor,
      collaborationPlan: result.plan,
      request: { args: ['review'] },
    })
    const receipt = executor.execute(execution, { confirm: execution.token })
    expect(receipt.degraded).toBe(true)
    expect(receipt.executionIntentSource.resolutions).toEqual(result.plan.binding.intentResolutions)
  })

  it('fails closed when isolated workspace is required for a spike', async () => {
    const result = await resolveCollaborationPlan({
      requestedMode: 'spike',
      preferredProvider: 'test-cli',
      providers: [provider(), createManualProvider()],
    })
    expect(result.ok).toBe(false)
    expect(result.plan.binding.status).toBe('blocked')
    const manual = await resolveCollaborationPlan({
      requestedMode: 'spike',
      preferredProvider: 'manual',
      providers: [createManualProvider()],
      config: {},
    })
    expect(manual.ok).toBe(false)
    expect(manual.plan.binding.status).toBe('blocked')
  })

  it('uses project policy for configured helper roles and limits', async () => {
    const result = await resolveCollaborationPlan({
      requestedMode: 'council',
      preferredProvider: 'test-cli',
      providers: [provider()],
      config: {
        collaboration: {
          councilHelpers: ['architecture-scout', 'testability-scout'],
          maxDelegates: 2,
          maxDepth: 2,
          maxIterations: 4,
        },
      },
    })
    expect(result.plan.helpers.map((item) => item.role)).toEqual([
      'architecture-scout',
      'testability-scout',
    ])
    expect(result.plan.intent.execution.limits).toEqual({
      maxDelegates: 2,
      maxDepth: 2,
      maxIterations: 4,
    })
  })

  it('does not claim a forked context for manual fallback', async () => {
    const result = await resolveCollaborationPlan({
      requestedMode: 'council',
      preferredProvider: 'manual',
      providers: [createManualProvider()],
      config: {},
    })
    expect(result.plan.environment).toBe('human-handoff')
    expect(result.plan.executionStrategy).toBe('fallback')
  })

  it('rejects malformed project collaboration policy', async () => {
    await expect(
      resolveCollaborationPlan({ config: { collaboration: { maxDelegates: 0 } } }),
    ).rejects.toThrow('maxDelegates must be a positive integer')
  })

  it('does not use a fallback removed by project policy', async () => {
    const result = await resolveCollaborationPlan({
      requestedMode: 'council',
      preferredProvider: 'test-cli',
      providers: [provider()],
      config: { collaboration: { fallbackModes: [] } },
    })
    expect(result.ok).toBe(false)
  })

  it('prefers available full intent support over an automatic degraded candidate', async () => {
    const native = provider(
      [
        {
          id: 'delegated-work',
          implementation: 'native',
          fidelity: 'full',
          evidence: 'probed',
          limits: {},
        },
      ],
      'native-cli',
    )
    const result = await resolveCollaborationPlan({
      requestedMode: 'council',
      providers: [provider(), native],
      config: {},
    })
    expect(result.plan.binding.provider).toBe('native-cli')
    expect(result.plan.binding.degraded).toBe(false)
  })
})
