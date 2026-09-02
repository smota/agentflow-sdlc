import { describe, expect, it } from 'vitest'
import {
  createExecutionIntent,
  validateExecutionIntent,
  validateExecutionIntentEvidence,
} from '../core/execution-intent.mjs'

describe('execution intent', () => {
  it('keeps portable behavior separate from controls and provider facets', () => {
    const intent = createExecutionIntent({
      subject: 'issue:188',
      requirements: [
        { id: 'plan-before-edit', required: true },
        { id: 'delegated-work', required: false },
      ],
      controls: ['single-writer', 'review-independence'],
    })
    expect(validateExecutionIntent(intent)).toEqual({ ok: true, errors: [] })
    expect(intent.requiredFacets).toEqual(['execution', 'evidence'])
    expect(intent.requirements[0]).toMatchObject({ id: 'plan-before-edit', required: true })
  })

  it('rejects provider facets and legacy subagent names as intents', () => {
    const intent = createExecutionIntent({
      requirements: [{ id: 'delegated-subagents' }, { id: 'execution' }],
    })
    expect(validateExecutionIntent(intent).errors).toEqual(
      expect.arrayContaining([
        'requirements[0].id is unsupported: delegated-subagents',
        'requirements[1].id is unsupported: execution',
      ]),
    )
  })

  it('validates bounded loop and planning evidence', () => {
    const valid = validateExecutionIntentEvidence({
      executionIntentsUsed: [
        {
          id: 'bounded-loop',
          implementation: 'emulated',
          fidelity: 'full',
          evidence: 'contract-tested',
          required: true,
          status: 'satisfied',
          parameters: { maxIterations: 3, stopConditions: ['tests pass'] },
        },
        {
          id: 'plan-before-edit',
          implementation: 'native',
          fidelity: 'full',
          evidence: 'probed',
          required: true,
          status: 'satisfied',
          artifact: '.agent-runs/plan.md',
        },
      ],
    })
    expect(valid).toEqual({ ok: true, errors: [] })
  })

  it('rejects missing loop guardrails and plan evidence', () => {
    const result = validateExecutionIntentEvidence({
      executionIntentsUsed: [
        { id: 'bounded-loop', status: 'satisfied', parameters: {} },
        { id: 'plan-before-edit', required: true, status: 'satisfied' },
      ],
    })
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'executionIntentsUsed[0] bounded-loop must record maxIterations >= 1',
        'executionIntentsUsed[0] bounded-loop must record stopConditions',
        'executionIntentsUsed[1] required plan-before-edit must record an artifact',
      ]),
    )
  })
})
