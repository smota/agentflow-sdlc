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

  it('rejects unsupported agent slugs', () => {
    const config = structuredClone(baseConfig)
    config.routing.roles.developer.owner = 'robot'
    const result = validateRoutingConfig(config, { checkDocs: false })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unsupported agent slug')
  })
})
