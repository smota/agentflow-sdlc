import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { setupGitHubGovernance, CANONICAL_LABELS } from '../github-setup.mjs'

const targets = []
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))

function validateTemplate(content) {
  const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-pr-template-test-'))
  targets.push(targetDir)
  const path = join(targetDir, 'pr.md')
  writeFileSync(path, content)
  return spawnSync(process.execPath, ['scripts/validate-pr-manifest.mjs', '--path', path], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const target of targets.splice(0)) {
    rmSync(target, { recursive: true, force: true })
  }
})

describe('GitHub governance setup', () => {
  it('generates a PR template that is READY after filling its placeholders', () => {
    const template = setupGitHubGovernance().operations.find((op) => op.type === 'pr-template')
    const values = {
      'issue-number': '612',
      'related-issues': 'none',
      'workflow-status-comment': 'https://github.com/example/project/issues/612#issuecomment-1',
      'handover-comments': 'https://github.com/example/project/issues/612#issuecomment-2',
      'role-pass-summary': 'Phases 1 through 7 passed; phase 0 skipped for this bug fix.',
      'validation-evidence': 'pnpm test passed',
      'runtime-platform': 'codex',
      'execution-target': 'codex-cli',
      transport: 'local-cli',
      'delegation-boundary': 'current-session',
      'model-runtime': 'unknown',
      review: 'self-review',
      'workflow-profile': 'standard',
      'merge-owner': 'human/operator',
      mode: 'single-agent',
      'ci-status': 'passed',
      'ci-commands': 'pnpm test',
      'follow-up-issues': 'none',
    }
    const filled = template.content.replace(/<([^>]+)>/g, (placeholder, key) =>
      Object.hasOwn(values, key) ? values[key] : placeholder,
    )
    expect(filled).not.toMatch(/<(?![!])[^>]+>/)
    const result = validateTemplate(filled)
    expect(result.stdout, result.stderr).toContain('Result: READY')
    expect(result.status).toBe(0)
  })

  it('rejects the unfilled generated PR template', () => {
    const template = setupGitHubGovernance().operations.find((op) => op.type === 'pr-template')
    const result = validateTemplate(template.content)
    expect(result.stdout, result.stderr).toContain('Result: FAILED')
    expect(result.status).toBe(1)
  })

  it('previews planned operations without writing any files in dry-run mode', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-gh-test-'))
    targets.push(targetDir)

    const preview = setupGitHubGovernance({ targetDir, write: false })
    expect(preview.ok).toBe(true)
    expect(preview.mode).toBe('dry-run')
    expect(preview.summary.plannedCount).toBe(5)
    expect(existsSync(join(targetDir, '.github'))).toBe(false)
  })

  it('applies issue templates, PR template, and labels manifest in apply mode', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'agentflow-gh-test-'))
    targets.push(targetDir)

    const applied = setupGitHubGovernance({ targetDir, write: true })
    expect(applied.ok).toBe(true)
    expect(applied.mode).toBe('apply')

    const featureTemplate = join(targetDir, '.github', 'ISSUE_TEMPLATE', 'feature-request.md')
    expect(existsSync(featureTemplate)).toBe(true)
    expect(readFileSync(featureTemplate, 'utf8')).toContain('## Acceptance criteria')

    const prTemplate = join(targetDir, '.github', 'pull_request_template.md')
    expect(existsSync(prTemplate)).toBe(true)
    expect(readFileSync(prTemplate, 'utf8')).toContain('## Workflow evidence')

    const labelsManifest = join(targetDir, '.github', 'labels.json')
    expect(existsSync(labelsManifest)).toBe(true)
    const labels = JSON.parse(readFileSync(labelsManifest, 'utf8'))
    expect(labels.some((l) => l.name === 'role:architect')).toBe(true)
    expect(labels.some((l) => l.name === 'feature')).toBe(true)

    // Re-run should report unchanged
    const rerun = setupGitHubGovernance({ targetDir, write: false })
    expect(rerun.summary.unchangedCount).toBe(5)
    expect(rerun.summary.plannedCount).toBe(0)
  })
})
