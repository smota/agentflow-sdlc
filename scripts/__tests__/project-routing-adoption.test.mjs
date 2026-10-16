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
    'product-manager',
    'analyst',
    'architect',
    'implementation-planner',
    'developer',
    'tester',
    'pr-readiness',
  ])('selects explicit native Codex for %s regardless of launcher', (role) => {
    const route = resolveRoleRoute({ role, currentAgent: 'grok', config, checkAvailability: false })
    expect(route.ok).toBe(true)
    expect(route.selectedAgent).toBe('codex')
    expect(route.executor).toBe('codex-cli')
  })
  it.each(['reviewer', 'technical-writer'])('selects explicit native Claude for %s', (role) => {
    const route = resolveRoleRoute({
      role,
      currentAgent: 'codex',
      config,
      checkAvailability: false,
    })
    expect(route.ok).toBe(true)
    expect(route.selectedAgent).toBe('claude')
    expect(route.executor).toBe('claude-cli')
  })
  it('keeps Pi unqualified for active routing and removes obsolete Grok fallbacks', () => {
    expect(config.routing.agents.pi).toMatchObject({
      enabled: false,
      defaultExecutionTarget: 'pi-parent',
    })
    for (const route of Object.values(config.routing.roles)) {
      expect([route.owner, ...route.fallbacks]).not.toContain('grok')
      expect([route.owner, ...route.fallbacks]).not.toContain('pi')
    }
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

it('the actual project policy allows a held preview and blocks materialization before home writes', () => {
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
    expect(result.plans.every((plan) => plan.activation === 'held')).toBe(true)
    const attempted = invoke('provision')
    expect(attempted.status).not.toBe(0)
    expect(attempted.stderr).toMatch(/activation.*held/i)
    expect(existsSync(home)).toBe(false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
