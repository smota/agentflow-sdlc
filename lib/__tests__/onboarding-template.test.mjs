import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCompositionProfile } from '../adoption/profiles.mjs'
import { applyAdoption as applyWithReceipt, planAdoption } from '../adoption/transaction.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const receiptFiles = []

function applyAdoption(source, target, plan, options) {
  const receiptDestination = `${target}-${receiptFiles.length}.receipt.json`
  receiptFiles.push(receiptDestination)
  return applyWithReceipt(source, target, plan, { ...options, receiptDestination })
}

describe('consumer onboarding template and policy separation', () => {
  let target

  beforeEach(() => {
    target = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-template-test-'))
  })

  afterEach(() => {
    for (const path of receiptFiles.splice(0)) rmSync(path, { force: true })
    rmSync(target, { recursive: true, force: true })
  })

  it('resolves defaults/AGENTS.md as seed-once source and ensures referenced docs are shipped in minimal profile', () => {
    const minimal = resolveCompositionProfile('minimal')
    const seedOnceEntry = minimal.seedOnceFiles.find((entry) => entry.to === 'AGENTS.md')
    expect(seedOnceEntry).toEqual({
      from: 'defaults/AGENTS.md',
      to: 'AGENTS.md',
    })

    const templateContent = readFileSync(join(packageRoot, 'defaults/AGENTS.md'), 'utf8')
    const referencedDocs = [
      'docs/agent-workflow.md',
      'docs/issue-standards.md',
      'docs/sdlc-definition.md',
      'docs/evidence-contracts.md',
      'docs/lifecycle-boundaries.md',
    ]

    for (const doc of referencedDocs) {
      expect(templateContent).toContain(doc)
      expect(minimal.managedFiles).toContain(doc)
    }
  })

  it('seeds defaults/AGENTS.md on fresh target adoption', () => {
    const plan = planAdoption(packageRoot, target, { profile: 'minimal' })
    const agentsAction = plan.actions.find((action) => action.target === 'AGENTS.md')
    expect(agentsAction).toBeDefined()
    expect(agentsAction.source).toBe('defaults/AGENTS.md')

    applyAdoption(packageRoot, target, plan, { confirm: plan.token })

    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true)
    const installedContent = readFileSync(join(target, 'AGENTS.md'), 'utf8')
    const templateContent = readFileSync(join(packageRoot, 'defaults/AGENTS.md'), 'utf8')
    expect(installedContent).toBe(templateContent)
  })

  it('preserves existing authored consumer AGENTS.md through seed-once semantics', () => {
    const customContent = '# Custom Consumer Policy\n\nCustom team rules and governance.\n'
    writeFileSync(join(target, 'AGENTS.md'), customContent, 'utf8')

    const plan = planAdoption(packageRoot, target, { profile: 'minimal' })
    applyAdoption(packageRoot, target, plan, { confirm: plan.token })

    const postApplyContent = readFileSync(join(target, 'AGENTS.md'), 'utf8')
    expect(postApplyContent).toBe(customContent)
    expect(postApplyContent).not.toBe(readFileSync(join(packageRoot, 'defaults/AGENTS.md'), 'utf8'))
  })
})
