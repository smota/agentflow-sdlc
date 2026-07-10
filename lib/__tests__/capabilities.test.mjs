import { describe, expect, it } from 'vitest'
import { resolveCapability, validateCapabilityEvidence } from '../capabilities.mjs'

describe('capability resolution', () => {
  it('resolves native Claude plan support', () => {
    expect(
      resolveCapability({
        capability: 'plan-before-edit',
        executionTarget: 'claude-cli',
        required: true,
      }),
    ).toMatchObject({ ok: true, mode: 'native', adapter: 'claude-code', status: 'satisfied' })
  })

  it('fails closed for required unavailable delegation', () => {
    expect(
      resolveCapability({
        capability: 'delegated-subagents',
        executionTarget: 'codex-cli',
        required: true,
      }),
    ).toMatchObject({ ok: false, mode: 'required-unavailable', status: 'blocked' })
  })

  it('allows optional unavailable delegation', () => {
    expect(
      resolveCapability({ capability: 'delegated-subagents', executionTarget: 'codex-cli' }),
    ).toMatchObject({ ok: true, mode: 'optional-unavailable', status: 'skipped' })
  })

  it('uses project config overrides', () => {
    const config = {
      capabilities: {
        'delegated-subagents': {
          executionTargets: {
            'codex-cli': 'package',
          },
        },
      },
    }

    expect(
      resolveCapability({
        capability: 'delegated-subagents',
        executionTarget: 'codex-cli',
        required: true,
        config,
      }),
    ).toMatchObject({ ok: true, mode: 'package', status: 'satisfied' })
  })
})

describe('capability evidence validation', () => {
  it('accepts bounded loop and delegated subagent evidence', () => {
    const result = validateCapabilityEvidence({
      capabilitiesUsed: [
        {
          name: 'bounded-loop',
          mode: 'framework-emulated',
          required: true,
          status: 'satisfied',
          maxIterations: 3,
          stopConditions: ['tests pass', 'human decision required'],
        },
        {
          name: 'delegated-subagents',
          mode: 'package',
          status: 'satisfied',
          transport: 'pi-subagent',
          delegationBoundary: 'child-subagent',
          contextBoundary: 'fresh-session',
          singleWriterRule: true,
        },
      ],
    })

    expect(result).toMatchObject({ ok: true, errors: [] })
  })

  it('rejects missing loop guardrails and missing required plan artifact', () => {
    const result = validateCapabilityEvidence({
      capabilitiesUsed: [
        { name: 'bounded-loop', mode: 'framework-emulated', status: 'satisfied' },
        {
          name: 'plan-before-edit',
          mode: 'framework-emulated',
          required: true,
          status: 'satisfied',
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'capabilitiesUsed[0] bounded-loop must record maxIterations >= 1',
        'capabilitiesUsed[0] bounded-loop must record stopConditions',
        'capabilitiesUsed[1] required plan-before-edit must record an artifact',
      ]),
    )
  })
})
