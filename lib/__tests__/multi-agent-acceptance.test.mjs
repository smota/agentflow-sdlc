import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  validateClaudeAgyAcceptance,
  validateMultiAgentAcceptance,
} from '../multi-agent-acceptance.mjs'
import { loadSdlcConfig } from '../sdlc-state.mjs'

describe('Decoupled Multi-Agent Acceptance', () => {
  const config = loadSdlcConfig(process.cwd())

  const claudeFixture = JSON.parse(
    readFileSync(new URL('../../agents/evals/fixtures/claude-analyst.txt', import.meta.url)),
  )
  const agyFixture = JSON.parse(
    readFileSync(new URL('../../agents/evals/fixtures/agy-architect.txt', import.meta.url)),
  )

  it('maintains backward compatibility for validateClaudeAgyAcceptance', () => {
    const claude = structuredClone(claudeFixture)
    const agy = structuredClone(agyFixture)

    const report = validateClaudeAgyAcceptance({ claude, agy }, config)
    expect(report.ok).toBe(true)
  })

  it('validates generalized role pairs using validateMultiAgentAcceptance', () => {
    const claude = structuredClone(claudeFixture)
    const agy = structuredClone(agyFixture)

    const report = validateMultiAgentAcceptance(
      [
        { label: 'claude', envelope: claude },
        { label: 'agy', envelope: agy },
      ],
      config,
    )
    expect(report.ok).toBe(true)
  })

  it('rejects same executor crossing review boundary claiming independent review (Codex B4)', () => {
    const devEnvelope = {
      ...structuredClone(agyFixture),
      fromRole: 'implementation-planner',
      toRole: 'developer',
      provenance: {
        platform: 'agy',
        executor: 'agy-cli',
        transport: 'local-cli',
        delegationBoundary: 'current-session',
      },
    }
    const reviewerEnvelope = {
      ...structuredClone(agyFixture),
      fromRole: 'developer',
      toRole: 'reviewer',
      provenance: {
        platform: 'agy',
        executor: 'agy-cli', // Same executor!
        transport: 'local-cli',
        delegationBoundary: 'current-session',
      },
      actionBoundary: {
        ...agyFixture.actionBoundary,
        independenceBoundary: 'independent', // Forgery! Same executor cannot claim independent
      },
    }

    const report = validateMultiAgentAcceptance(
      [
        { label: 'dev', envelope: devEnvelope },
        { label: 'reviewer', envelope: reviewerEnvelope },
      ],
      config,
    )
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('INDEPENDENCE_VIOLATION'))).toBe(true)
  })

  it('rejects mismatched subjects across consecutive envelopes', () => {
    const claude = structuredClone(claudeFixture)
    const agy = {
      ...structuredClone(agyFixture),
      subject: 'different-subject',
    }

    const report = validateMultiAgentAcceptance(
      [
        { label: 'claude', envelope: claude },
        { label: 'agy', envelope: agy },
      ],
      config,
    )
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('subjects must match'))).toBe(true)
  })

  it('rejects non-consecutive role transitions', () => {
    const claude = structuredClone(claudeFixture) // analyst -> architect
    const agy = {
      ...structuredClone(agyFixture),
      fromRole: 'developer', // Mismatched: expected architect
    }

    const report = validateMultiAgentAcceptance(
      [
        { label: 'claude', envelope: claude },
        { label: 'agy', envelope: agy },
      ],
      config,
    )
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('must equal'))).toBe(true)
  })
})
