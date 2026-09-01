import { describe, expect, it } from 'vitest'
import { resolveRoleRoute, validateRoutingConfig } from '../role-routing.mjs'

const baseConfig = {
  routing: {
    defaultMode: 'single-agent',
    agents: {
      claude: { enabled: true, callWorkflowDoc: 'docs/agents/claude-routing.md' },
      codex: { enabled: true, callWorkflowDoc: 'docs/agents/codex-routing.md' },
      agy: { enabled: true, callWorkflowDoc: 'docs/agents/agy-routing.md' },
      pi: { enabled: true, callWorkflowDoc: 'docs/agents/pi-routing.md' },
    },
    roles: {
      developer: { owner: 'codex', fallbacks: ['claude', 'agy', 'pi'] },
    },
  },
}

describe('role routing', () => {
  it('accepts legacy role input but emits the canonical role', () => {
    const route = resolveRoleRoute({
      role: 'product-manager',
      currentAgent: 'claude',
      config: {},
    })
    expect(route).toMatchObject({ ok: true, role: 'product-manager-jtbd' })
  })

  it('defaults to the current executor when routing is missing and still requires handover evidence', () => {
    const route = resolveRoleRoute({ role: 'developer', currentAgent: 'claude', config: {} })
    expect(route.ok).toBe(true)
    expect(route.mode).toBe('single-agent')
    expect(route.selectedAgent).toBe('claude')
    expect(route.requiresHandoverComment).toBe(true)
  })

  it('selects the configured owner for a routed role', () => {
    const route = resolveRoleRoute({
      role: 'developer',
      currentAgent: 'claude',
      config: baseConfig,
      checkAvailability: false,
    })
    expect(route.ok).toBe(true)
    expect(route.selectedAgent).toBe('codex')
    expect(route.mode).toBe('optional-multi-agent')
    expect(route.requiresHandoverComment).toBe(true)
  })

  it('falls back in order when an owner is disabled', () => {
    const config = structuredClone(baseConfig)
    config.routing.agents.codex.enabled = false
    const route = resolveRoleRoute({
      role: 'developer',
      currentAgent: 'claude',
      config,
      checkAvailability: false,
    })
    expect(route.ok).toBe(true)
    expect(route.selectedAgent).toBe('claude')
    expect(route.fallbacksTried[0]).toMatchObject({ agent: 'codex', reason: 'disabled' })
    expect(route.requiresHandoverComment).toBe(true)
  })

  it('rejects duplicate owner/fallback entries', () => {
    const config = structuredClone(baseConfig)
    config.routing.roles.developer.fallbacks = ['codex']
    const result = validateRoutingConfig(config, { checkDocs: false })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('must not repeat owner codex')
  })

  it('rejects unregistered or identity-only platforms as role-routing agents', () => {
    const unregistered = structuredClone(baseConfig)
    unregistered.routing.roles.developer.owner = 'robot'
    const unregisteredResult = validateRoutingConfig(unregistered, { checkDocs: false })
    expect(unregisteredResult.ok).toBe(false)
    expect(unregisteredResult.errors.join('\n')).toContain('unsupported agent slug')

    const identityOnly = structuredClone(baseConfig)
    identityOnly.routing.roles.developer.owner = 'cowork'
    const identityOnlyResult = validateRoutingConfig(identityOnly, { checkDocs: false })
    expect(identityOnlyResult.ok).toBe(false)
    expect(identityOnlyResult.errors.join('\n')).toContain('unsupported agent slug')
  })

  it('resolves selectedAgent to a distinct executor/executionTarget/transport/delegationBoundary', () => {
    const route = resolveRoleRoute({
      role: 'developer',
      currentAgent: 'claude',
      config: baseConfig,
      checkAvailability: false,
    })
    expect(route).toMatchObject({
      launcher: 'claude',
      executor: 'codex-cli',
      executionTarget: 'codex-cli',
      transport: 'local-cli',
      delegationBoundary: 'current-session',
    })
  })

  it('defaults executionTarget from the built-in agent default when routing is missing', () => {
    const route = resolveRoleRoute({ role: 'developer', currentAgent: 'agy', config: {} })
    expect(route).toMatchObject({
      launcher: 'agy',
      executor: 'agy-cli',
      executionTarget: 'agy-cli',
      transport: 'local-cli',
    })
  })

  it('honors a configured defaultExecutionTarget for the selected agent', () => {
    const config = structuredClone(baseConfig)
    config.routing.agents.codex.defaultExecutionTarget = 'provider-api'
    const route = resolveRoleRoute({
      role: 'developer',
      currentAgent: 'claude',
      config,
      checkAvailability: false,
    })
    expect(route).toMatchObject({ executionTarget: 'provider-api', transport: 'provider-api' })
  })

  it('honors the current agent defaultExecutionTarget when a role is not configured', () => {
    const config = structuredClone(baseConfig)
    config.routing.agents.claude.defaultExecutionTarget = 'anthropic-api'
    const route = resolveRoleRoute({
      role: 'review',
      currentAgent: 'claude',
      config,
      checkAvailability: false,
    })
    expect(route).toMatchObject({
      mode: 'single-agent',
      selectedAgent: 'claude',
      executionTarget: 'anthropic-api',
      transport: 'provider-api',
    })
  })

  it('rejects an invalid project platform registry extension', () => {
    const config = structuredClone(baseConfig)
    config.platformRegistry = {
      additionalPlatforms: [
        { slug: 'pi', displayName: 'Duplicate Pi', kind: 'harness', routable: false },
      ],
    }
    const result = validateRoutingConfig(config, { checkDocs: false })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('duplicates registered platform: pi')
  })

  it('rejects a defaultExecutionTarget that does not belong to the agent', () => {
    const config = structuredClone(baseConfig)
    config.routing.agents.codex.defaultExecutionTarget = 'agy-cli'
    const result = validateRoutingConfig(config, { checkDocs: false })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('defaultExecutionTarget must be one of')
  })
})
