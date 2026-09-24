import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setupGitHubGovernance, CANONICAL_LABELS } from '../github-setup.mjs'

const targets = []

afterEach(() => {
  for (const target of targets.splice(0)) {
    rmSync(target, { recursive: true, force: true })
  }
})

describe('GitHub governance setup', () => {
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
    expect(readFileSync(prTemplate, 'utf8')).toContain('## Workflow Evidence')

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
