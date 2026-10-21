import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  loadProjectConfig,
  resolveRoleRoute,
  validateRoutingConfig,
} from '../../lib/role-routing.mjs'

const config = loadProjectConfig(process.cwd())
describe('AgentFlow source routing adoption (#527)', () => {
  it.each([
    ['product-manager', 'pi', 'grok-4.7', 'medium'],
    ['analyst', 'pi', 'gemini-3.8-flash', 'medium'],
    ['architect', 'codex', 'gpt-6.1-sol', 'medium'],
    ['implementation-planner', 'codex', 'gpt-6.1-sol', 'medium'],
    ['developer', 'pi', 'gemini-3.8-flash', 'medium'],
    ['tester', 'pi', 'grok-4.7', 'low'],
    ['pr-readiness', 'codex', 'gpt-6.1-sol', 'medium'],
    ['reviewer', 'codex', 'gpt-6-astra', 'medium'],
    ['technical-writer', 'pi', 'gemini-3.8-flash', 'low'],
  ])('resolves pinned balanced %s regardless of launcher', (role, client, model, effort) => {
    const route = resolveRoleRoute({ role, currentAgent: 'grok', config, checkAvailability: false })
    expect(route.ok).toBe(true)
    expect(route.selectedAgent).toBe(client)
    expect(route.desiredExecution).toMatchObject({ model, effort })
    expect(route.actualExecution).toBe('unknown')
    expect(route.fallbackOptions).toHaveLength(2)
  })
  it('keeps model distribution separate from legacy launcher-routing and Munito qualification', () => {
    expect(config.routing.agents.pi.enabled).toBe(true)
    expect(config.executionDistribution.profile).toBe('subscription-balanced-v1')
    expect(config.adapters.openrig.executionPolicy.seats).toBeUndefined()
    expect(config.adapters.openrig.executionPolicy.activation).toBe('active')
  })
  it('retains medium loops, low search and fresh bounded high-effort enforcement', () => {
    expect(config.effortPolicy).toMatchObject({
      defaultLoopEffort: 'medium',
      subagentSearchEffort: 'low',
      enforceCleanSubagentForHighEffort: true,
    })
  })
  it('preserves source authority and does not turn an existing grant into recovery approval', () => {
    expect(config.delivery.source).toEqual({
      kind: 'github',
      repo: 'smota/agentflow-sdlc',
      branch: 'agentflow-state',
    })
    expect(config.delivery.delegation.policy.issuers[0].allowedActions).toEqual([
      'pr:create',
      'pr:update',
    ])
    expect(config.delivery.delegation.policy.issuers[0].allowThroughMerge).toBe(false)
    expect(validateRoutingConfig(config).ok).toBe(true)
  })
})

it('the actual project policy allows an active plan and materializes squads', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'agentflow-own-policy-'))
  const home = join(temporary, 'absent-home')
  const invoke = (operation) =>
    spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'bin/cli.mjs'),
        'adapters',
        'squads',
        operation,
        'openrig',
        '--kind',
        'all',
        '--home',
        home,
        'policy-check',
        process.cwd(),
        ...(operation === 'plan' ? ['--json'] : []),
      ],
      { encoding: 'utf8', timeout: 15000 },
    )
  try {
    const planned = invoke('plan')
    expect(planned.status).toBe(0)
    const result = JSON.parse(planned.stdout)
    expect(result.effects).toEqual([])
    expect(result.plans).toHaveLength(3)
    expect(result.plans.every((plan) => plan.activation === 'active')).toBe(true)
    const attempted = invoke('provision')
    expect(attempted.status).toBe(0)
    expect(existsSync(home)).toBe(true)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
