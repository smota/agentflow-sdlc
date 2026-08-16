import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tempDirs = []

function rolePass(platform) {
  return `## Role Pass

**Issue:** #181 — runtime identity
**Branch:** work/runtime-platform-registry
**Phase:** 4
**Role:** developer
**Status:** pass
**Workflow profile:** standard
**Planned owner:** ${platform}
**Executed by:** ${platform}
**Launcher:** ${platform}
**Executor:** pi-subagent-model
**Transport:** provider-api
**Delegation boundary:** child-subagent
**Context boundary:** forked-context
**Independence boundary:** not-applicable
**Model / runtime:** openai/gpt-test
`
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('runtime platform evidence validators', () => {
  it('accepts Cowork identity with a distinct Pi execution target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-platform-'))
    tempDirs.push(dir)
    const path = join(dir, 'role-pass.md')
    writeFileSync(path, rolePass('cowork'))

    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts', 'validate-sdlc-role-pass.mjs'), '--path', path],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Result: READY')
  })

  it('rejects an unregistered platform with registration guidance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-platform-'))
    tempDirs.push(dir)
    const path = join(dir, 'role-pass.md')
    writeFileSync(path, rolePass('robot'))

    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts', 'validate-sdlc-role-pass.mjs'), '--path', path],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('unregistered platform slug: robot')
  })
})
