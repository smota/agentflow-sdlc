import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))
const targets = []

afterEach(() => {
  for (const target of targets.splice(0)) rmSync(target, { recursive: true, force: true })
})

describe('roles CLI', () => {
  it('lists, validates, inspects, and resolves canonical roles', () => {
    const catalog = JSON.parse(
      execFileSync(process.execPath, [cli, 'roles', 'catalog', '--json'], { encoding: 'utf8' }),
    )
    expect(catalog.roles.filter((role) => role.kind === 'lifecycle')).toHaveLength(9)
    const validation = JSON.parse(
      execFileSync(process.execPath, [cli, 'roles', 'validate', '--json'], { encoding: 'utf8' }),
    )
    expect(validation).toEqual({ ok: true, findings: [] })
    const role = JSON.parse(
      execFileSync(process.execPath, [cli, 'roles', 'inspect', 'reviewer', '--json'], {
        encoding: 'utf8',
      }),
    )
    expect(role.qualifiedName).toBe('agentflow:reviewer')
    const resolved = JSON.parse(
      execFileSync(
        process.execPath,
        [
          cli,
          'roles',
          'resolve',
          'analyst',
          '--methods',
          'agentflow:method:event-storming',
          '--json',
        ],
        { encoding: 'utf8' },
      ),
    )
    expect(resolved.role.outputs).toContain('event-model')
  })

  it('performs a no-write dry run before adapter apply', () => {
    const target = mkdtempSync(join(tmpdir(), 'agentflow-roles-cli-'))
    targets.push(target)
    const dryRun = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, 'roles', 'sync', '--target', target, '--dry-run', '--json'],
        { encoding: 'utf8' },
      ),
    )
    expect(dryRun.mode).toBe('dry-run')
    const status = spawnSync(
      process.execPath,
      [cli, 'roles', 'status', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(status.status).toBe(1)
    expect(JSON.parse(status.stdout).stale.length).toBeGreaterThan(0)

    const applied = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, 'roles', 'sync', '--target', target, '--apply', '--json'],
        { encoding: 'utf8' },
      ),
    )
    expect(applied.mode).toBe('apply')
    const clean = JSON.parse(
      execFileSync(process.execPath, [cli, 'roles', 'status', '--target', target, '--json'], {
        encoding: 'utf8',
      }),
    )
    expect(clean.stale).toEqual([])
  })

  it('fails closed on an invalid project method binding', () => {
    const target = mkdtempSync(join(tmpdir(), 'agentflow-roles-cli-'))
    targets.push(target)
    writeFileSync(
      join(target, 'agent-workflow.config.json'),
      JSON.stringify({
        roleMethods: {
          bindings: {
            'agentflow:analyst': ['agentflow:method:tdd'],
          },
        },
      }),
    )
    const result = spawnSync(
      process.execPath,
      [cli, 'roles', 'validate', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'role-methods.binding',
          message: expect.stringContaining('applies to agentflow:developer'),
        }),
      ]),
    )
  })
})
