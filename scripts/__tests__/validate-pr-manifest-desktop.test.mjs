import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveExecutionTarget } from '../../lib/execution-targets.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function manifest({
  executor = 'codex-desktop-session',
  transport = 'desktop-runtime',
  implementedBy = 'codex',
} = {}) {
  return `## Implemented issues

Closes #301

## Related issues

Refs #304

## Workflow evidence

- Workflow-status comment: https://example.invalid/status
- Handover comments: exception:single accountable parent
- Role-pass summary: current Codex desktop parent with disclosed helpers
- Validation evidence: local tests

## Agent review

- Mode: single-agent
- Implemented by: ${implementedBy}
- Launcher: codex
- Executor: ${executor}
- Transport: ${transport}
- Delegation boundary: current-session
- Model / runtime: gpt-6-sol in Codex desktop
- Review: self-review
- Self-review disclosure: same-platform reviewer inspected the diff
- Workflow profile: standard
- Merge owner: human/operator

## CI-equivalent validation

- Status: passed
- Commands: npx vitest run

## Follow-up issues

Refs #304
`
}

function validate(fields) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'af-pr-desktop-'))
  roots.push(root)
  const path = join(root, 'manifest.md')
  writeFileSync(path, manifest(fields))
  return spawnSync(process.execPath, ['scripts/validate-pr-manifest.mjs', '--path', path], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
}

it('accepts truthful Codex desktop PR evidence without a multi-agent matrix', () => {
  const result = validate()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain('desktop-session-evidence')
})

it.each([
  { executor: 'codex-desktop-session', transport: 'provider-api' },
  { executor: 'codex-cli', transport: 'desktop-runtime' },
  { executor: 'codex-desktop-session', transport: 'desktop-runtime', implementedBy: 'claude' },
])('rejects an invented desktop provenance combination: %j', (fields) => {
  const result = validate(fields)
  expect(result.status).toBe(1)
  expect(result.stdout).toContain('FAIL  desktop-session-evidence')
})

it('keeps desktop evidence out of runtime launch resolution', () => {
  const result = resolveExecutionTarget({
    agentSlug: 'codex',
    requested: 'codex-desktop-session',
    currentAgent: 'codex',
  })
  expect(result.ok).toBe(false)
  expect(result.requiresClarification).toBe(true)
  expect(
    resolveExecutionTarget({ agentSlug: 'codex', currentAgent: 'codex' }).executionTarget,
  ).toBe('codex-cli')
})

it('offers the evidence-only pair in the generated PR form', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'af-pr-form-'))
  roots.push(root)
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/ensure-workflow-artifacts.mjs'), '--issue', '304'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const form = readFileSync(join(root, '.agent-runs/issues/304/pr-manifest.md'), 'utf8')
  expect(form).toContain('codex-desktop-session (PR evidence only)')
  expect(form).toContain('desktop-runtime (PR evidence only)')
})
