import { describe, expect, it } from 'vitest'
import {
  ALL_EXECUTION_TARGETS,
  EXECUTION_TARGETS_BY_AGENT,
  describeExecutionTarget,
  isKnownExecutionTarget,
  resolveExecutionTarget,
} from '../execution-targets.mjs'

describe('execution targets', () => {
  it('lists distinct claude-cli and anthropic-api targets', () => {
    expect(EXECUTION_TARGETS_BY_AGENT.claude).toEqual(['claude-cli', 'anthropic-api'])
  })

  it('lists distinct agy-cli and agy-session targets', () => {
    expect(EXECUTION_TARGETS_BY_AGENT.agy).toEqual(['agy-cli', 'agy-session'])
  })

  it('lists pi-parent, pi-subagent, pi-session, and pi-subagent-model targets', () => {
    expect(EXECUTION_TARGETS_BY_AGENT.pi).toEqual([
      'pi-parent',
      'pi-subagent',
      'pi-session',
      'pi-subagent-model',
    ])
  })

  it('recognizes every declared target as known', () => {
    for (const target of ALL_EXECUTION_TARGETS) {
      expect(isKnownExecutionTarget(target)).toBe(true)
    }
    expect(isKnownExecutionTarget('robot-cli')).toBe(false)
  })

  it('describes transport and delegation boundary for a target', () => {
    expect(describeExecutionTarget('claude-cli')).toMatchObject({
      transport: 'local-cli',
      delegationBoundary: 'current-session',
    })
    expect(describeExecutionTarget('anthropic-api')).toMatchObject({
      transport: 'provider-api',
    })
  })

  it('resolves an explicit execution target as-is', () => {
    const result = resolveExecutionTarget({ agentSlug: 'claude', requested: 'claude-cli' })
    expect(result).toMatchObject({
      ok: true,
      executionTarget: 'claude-cli',
      transport: 'local-cli',
      requiresClarification: false,
    })
  })

  it('rejects an execution target that does not belong to the agent', () => {
    const result = resolveExecutionTarget({ agentSlug: 'claude', requested: 'agy-cli' })
    expect(result.ok).toBe(false)
    expect(result.requiresClarification).toBe(true)
    expect(result.reason).toContain('does not belong to agent "claude"')
  })

  it('does not misclassify another agent execution target as a provider model', () => {
    const result = resolveExecutionTarget({ agentSlug: 'codex', requested: 'claude-cli' })
    expect(result.ok).toBe(false)
    expect(result.executionTarget).toBeNull()
    expect(result.reason).toContain('does not belong to agent "codex"')
  })

  it('resolves a bare self-mention to the built-in local-CLI default', () => {
    const result = resolveExecutionTarget({
      agentSlug: 'claude',
      requested: 'claude',
      currentAgent: 'claude',
    })
    expect(result).toMatchObject({ ok: true, executionTarget: 'claude-cli' })
  })

  it('resolves a bare cross-agent mention from the configured project default', () => {
    const config = { routing: { agents: { claude: { defaultExecutionTarget: 'claude-cli' } } } }
    const result = resolveExecutionTarget({
      agentSlug: 'claude',
      requested: 'with claude',
      currentAgent: 'codex',
      config,
    })
    expect(result).toMatchObject({
      ok: true,
      executionTarget: 'claude-cli',
      reason: expect.stringContaining('project config defaultExecutionTarget'),
    })
  })

  it('requires clarification for an ambiguous cross-agent mention with no configured default', () => {
    // This models the issue #52 failure: "with claude" launched from another agent's chain,
    // with no per-step model override and no configured defaultExecutionTarget.
    const result = resolveExecutionTarget({
      agentSlug: 'claude',
      requested: 'with claude',
      currentAgent: 'pi',
      config: {},
    })
    expect(result.ok).toBe(false)
    expect(result.requiresClarification).toBe(true)
    expect(result.executionTarget).toBeNull()
  })

  it('flags an Anthropic model identifier as provider-api, not claude-cli', () => {
    const result = resolveExecutionTarget({
      agentSlug: 'claude',
      requested: 'anthropic/claude-sonnet-4',
      currentAgent: 'pi',
    })
    expect(result).toMatchObject({
      ok: true,
      executionTarget: 'anthropic-api',
      transport: 'provider-api',
      model: 'anthropic/claude-sonnet-4',
    })
    expect(result.reason).toMatch(/not the local claude CLI/)
  })

  it('flags a raw claude model id as provider-api', () => {
    const result = resolveExecutionTarget({
      agentSlug: 'claude',
      requested: 'claude-sonnet-4-20250514',
      currentAgent: 'pi',
    })
    expect(result).toMatchObject({ ok: true, executionTarget: 'anthropic-api' })
  })

  it('resolves a pi subagent provider model identifier to pi-subagent-model', () => {
    const result = resolveExecutionTarget({
      agentSlug: 'pi',
      requested: 'openai-codex/gpt-5.5',
      currentAgent: 'pi',
    })
    expect(result).toMatchObject({ ok: true, executionTarget: 'pi-subagent-model' })
  })

  it('throws for an unsupported agent slug', () => {
    expect(() => resolveExecutionTarget({ agentSlug: 'robot', requested: 'robot-cli' })).toThrow(
      /agentSlug must be one of/,
    )
  })
})
