import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { roleAdapterStatus, syncRoleAdapters } from '../role-adapters.mjs'

const packageRoot = process.cwd()
const targets = []

afterEach(() => {
  for (const target of targets.splice(0)) rmSync(target, { recursive: true, force: true })
})

describe('role adapter projections', () => {
  it('dry-runs without writes and applies all role packages for every harness', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-role-adapters-'))
    targets.push(targetDir)
    const preview = syncRoleAdapters({ packageRoot, targetDir, write: false })
    expect(preview.mode).toBe('dry-run')
    expect(preview.entries.filter((entry) => entry.role)).toHaveLength(40)
    expect(existsSync(join(targetDir, '.agentflow'))).toBe(false)

    const applied = syncRoleAdapters({ packageRoot, targetDir, write: true })
    expect(applied.mode).toBe('apply')
    expect(existsSync(applied.lockPath)).toBe(true)
    const developer = join(
      targetDir,
      '.agentflow',
      'roles',
      'claude-code',
      'agentflow-developer.md',
    )
    expect(readFileSync(developer, 'utf8')).toContain('agentflow:developer')
    expect(roleAdapterStatus({ packageRoot, targetDir }).stale).toEqual([])
  })

  it('rejects an invalid harness list before writing any projection', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-role-adapters-'))
    targets.push(targetDir)
    expect(() =>
      syncRoleAdapters({ packageRoot, targetDir, harness: 'codex,unknown', write: true }),
    ).toThrow('Unknown harness: unknown')
    expect(existsSync(join(targetDir, '.agentflow'))).toBe(false)
  })
})
