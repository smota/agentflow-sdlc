import { describe, expect, it } from 'vitest'
import { resolveCollaborationPlan, selectCollaborationMode } from '../collaboration-plan.mjs'

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
  })

  it('uses council for high uncertainty', () => {
    expect(selectCollaborationMode({ requestedMode: 'auto-minimal', uncertainty: 'high' })).toBe(
      'council',
    )
  })

  it('resolves package-backed pi advisory plan', () => {
    const result = resolveCollaborationPlan({
      requestedMode: 'advisory',
      executionTarget: 'pi-parent',
    })
    expect(result.ok).toBe(true)
    expect(result.plan.collaborationMode).toBe('advisory')
    expect(result.plan.helpers).toHaveLength(1)
    expect(result.plan.writer).toBe('parent')
  })

  it('fails closed when delegated subagents are required but unavailable', () => {
    const result = resolveCollaborationPlan({
      requestedMode: 'advisory',
      executionTarget: 'codex-cli',
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/delegated-subagents/)
  })
})
