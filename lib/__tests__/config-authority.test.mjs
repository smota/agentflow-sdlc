import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadAuthoritativeConfigs,
  applyAuthorityMigration,
  planAuthorityMigration,
  resolveConfigAuthority,
  validateConfigAuthority,
} from '../config/authority.mjs'

describe('configuration authority', () => {
  const targets = []
  afterEach(() => {
    for (const target of targets.splice(0)) rmSync(target, { recursive: true, force: true })
  })

  it('accepts domain and operational fields in their owners', () => {
    expect(
      validateConfigAuthority({
        domain: { roles: [], actionPolicy: {} },
        workflow: { branching: {}, routing: {}, providers: {} },
      }),
    ).toEqual({ ok: true, errors: [], warnings: [] })
  })

  it('rejects domain duplication in workflow configuration', () => {
    const result = validateConfigAuthority({
      domain: { roles: [] },
      workflow: { roles: [], branching: {} },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'agent-workflow.config.json duplicates domain field roles; move it to sdlc.config.json',
    )
  })

  it('prefers a consuming project domain config over the packaged default', () => {
    const repo = mkdtempSync(join(tmpdir(), 'agentflow-authority-'))
    targets.push(repo)
    mkdirSync(join(repo, 'defaults'))
    writeFileSync(join(repo, 'defaults', 'sdlc.config.json'), '{"version":1,"roles":[]}')
    writeFileSync(join(repo, 'sdlc.config.json'), '{"version":1,"roles":["project"]}')
    writeFileSync(join(repo, 'agent-workflow.config.json'), '{"routing":{}}')
    expect(loadAuthoritativeConfigs(repo).domain.roles).toEqual(['project'])
    expect(resolveConfigAuthority(repo).validation.ok).toBe(true)
  })

  it('previews and idempotently applies authority migration with owner precedence', () => {
    const repo = mkdtempSync(join(tmpdir(), 'agentflow-authority-migrate-'))
    targets.push(repo)
    writeFileSync(
      join(repo, 'sdlc.config.json'),
      JSON.stringify({ version: 1, roles: ['domain'], routing: { legacy: true }, custom: 'keep' }),
    )
    writeFileSync(
      join(repo, 'agent-workflow.config.json'),
      JSON.stringify({ roles: ['legacy'], routing: { current: true }, customWorkflow: 'keep' }),
    )
    const plan = planAuthorityMigration(repo)
    expect(plan.changed).toBe(true)
    expect(plan.after.domain).toMatchObject({ roles: ['domain'], custom: 'keep' })
    expect(plan.after.domain).not.toHaveProperty('routing')
    expect(plan.after.workflow).toMatchObject({
      routing: { current: true },
      customWorkflow: 'keep',
    })
    expect(plan.after.workflow).not.toHaveProperty('roles')
    expect(applyAuthorityMigration(repo, plan, { confirm: plan.token }).status).toBe('applied')
    expect(JSON.parse(readFileSync(join(repo, 'sdlc.config.json'), 'utf8')).custom).toBe('keep')
    expect(planAuthorityMigration(repo)).toMatchObject({ changed: false })
  })
})
