import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { applyAdoption, planAdoption, rollbackAdoption } from '../adoption/transaction.mjs'
import { runInit } from '../init.mjs'
import { hashContent } from '../lockfile.mjs'
import { REPORT_STEPS, buildReadinessReport } from '../onboarding/readiness-report.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const cli = join(packageRoot, 'bin/cli.mjs')
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project({ tests = false, git = true } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-journey-'))
  roots.push(root)
  if (git) execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root })
  if (tests) {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/app.js'), 'module.exports = 1\n')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }),
    )
  }
  return root
}

function onboarding(args, target) {
  const result = spawnSync(process.execPath, [cli, 'onboarding', ...args, '--target', target], {
    encoding: 'utf8',
  })
  return { status: result.status, out: result.stdout ? JSON.parse(result.stdout) : null }
}

// Choices and changes files live outside the project, as the docs ask.
function writeJson(name, value) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-journey-input-'))
  roots.push(dir)
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

// Every file under a directory, by relative path, with its bytes' hash.
function snapshot(root) {
  const files = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name)
      if (name.isDirectory()) {
        if (name.name !== '.git') walk(full)
      } else files[relative(root, full)] = hashContent(readFileSync(full))
    }
  }
  walk(root)
  return files
}

const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replaceAll(' ', '-')

describe('adoption transaction project files', () => {
  it('seeds a project file in the transaction without recording it in the lock, and undo removes it', () => {
    const target = project({ git: false })
    const plan = planAdoption(packageRoot, target, {
      profile: 'minimal',
      projectFiles: { 'notes/seeded.txt': 'seeded\n' },
    })
    const action = plan.actions.find((item) => item.target === 'notes/seeded.txt')
    expect(action).toMatchObject({ action: 'seed', ownership: 'project' })
    const receiptDestination = `${target}.receipt.json`
    roots.push(receiptDestination)
    const receipt = applyAdoption(packageRoot, target, plan, {
      confirm: plan.token,
      receiptDestination,
    })
    expect(readFileSync(join(target, 'notes/seeded.txt'), 'utf8')).toBe('seeded\n')
    const lock = JSON.parse(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8'))
    expect(lock.entries.map((entry) => entry.target)).not.toContain('notes/seeded.txt')
    rollbackAdoption(target, receipt, { confirm: receipt.receiptToken })
    expect(existsSync(join(target, 'notes/seeded.txt'))).toBe(false)
  })

  it('never replaces an existing project file, and refuses reserved targets', () => {
    const target = project({ git: false })
    writeFileSync(join(target, 'mine.txt'), 'mine\n')
    const plan = planAdoption(packageRoot, target, {
      profile: 'minimal',
      projectFiles: { 'mine.txt': 'theirs\n' },
    })
    expect(plan.actions.find((item) => item.target === 'mine.txt').action).toBe('seed-skip')
    for (const reserved of ['agent-framework-lock.json', '.agentflow/transactions/x.json'])
      expect(() =>
        planAdoption(packageRoot, target, { profile: 'minimal', projectFiles: { [reserved]: '' } }),
      ).toThrow(/reserved/)
  })

  it('leaves a plan without project files exactly as before', () => {
    const target = project({ git: false })
    expect(planAdoption(packageRoot, target, { profile: 'minimal' }).options).toBeUndefined()
  })
})

describe('one adoption front door', () => {
  it('init writes exactly the files the onboarding preview lists', () => {
    const previewed = project({ tests: true })
    const initialized = project({ tests: true })
    const { out } = onboarding(['plan'], previewed)
    const listed = [...out.preview.create, ...out.preview.change].filter(
      (path) => !path.includes('<transaction-id>') && path !== '.agentflow/transactions/.gitignore',
    )
    const result = runInit({ packageRoot, targetDir: initialized })
    expect([...result.changed].sort()).toEqual([...listed].sort())
    expect(result.governed).toBe(true)
    expect(out.preview.create).toContain('agentflow-acceptance.json')
    expect(out.preview.create).toContain('.agentflow/model-catalog.json')
  })

  it('writes nothing before a confirmed apply, and a declined apply still reports', () => {
    const target = project()
    const before = snapshot(target)
    const plan = onboarding(['plan'], target)
    expect(plan.status).toBe(0)
    expect(snapshot(target)).toEqual(before)
    const declined = onboarding(['apply'], target)
    expect(declined.status).toBe(1)
    expect(declined.out.report).toMatchObject({
      outcome: 'stopped',
      stop: { reason: 'declined' },
      choices: { confirmed: false },
      nextAction: { id: 'declined' },
    })
    expect(snapshot(target)).toEqual(before)
  })

  it('refuses a stale preview and says so in the report', () => {
    const target = project({ tests: true })
    const { out } = onboarding(['plan'], target)
    writeFileSync(join(target, 'src/later.js'), 'module.exports = 2\n')
    const stale = onboarding(['apply', '--confirm', out.digest], target)
    expect(stale.status).toBe(1)
    expect(stale.out.report.stop.reason).toBe('stale-preview')
    expect(stale.out.report.nextAction.id).toBe('stale-preview')
    expect(existsSync(join(target, 'agent-framework-lock.json'))).toBe(false)
  })
})

describe('the readiness report', () => {
  it('keeps project, runtime and governed-change readiness apart and recommends one step', () => {
    const target = project()
    const { out } = onboarding(['plan'], target)
    const applied = onboarding(['apply', '--confirm', out.digest], target)
    const report = applied.out.report
    expect(report.project).toEqual({ ready: false, installed: true, checkConfigured: false })
    expect(report.runtime.status).toBe('not-checked')
    expect(report.governedChange.ready).toBe(false)
    expect(report.nextAction.id).toBe('no-check')
    expect(report.blockers.map((item) => item.id)).toEqual(['no-check'])
    expect(report.undo.command).toContain('onboarding undo')
  })

  it('reports runtime readiness as ready, not ready, or not checked', () => {
    const base = { stage: 'verify', inventory: null }
    expect(buildReadinessReport(base).runtime.status).toBe('not-checked')
    expect(buildReadinessReport({ ...base, runtime: { runtimeReady: true } }).runtime.status).toBe(
      'ready',
    )
    const unknown = buildReadinessReport({
      ...base,
      runtime: { runtimeReady: false, unknowns: [{ field: 'version' }] },
    })
    expect(unknown.runtime).toMatchObject({ status: 'not-ready', unknowns: 1 })
    expect(unknown.blockers.map((item) => item.id)).toContain('runtime-not-ready')
  })

  it('sends a person to preview before confirming, and a refinement to its own page', () => {
    const pending = {
      inventory: { lock: { format: 'missing' }, config: { status: 'missing' } },
      projectPlan: { actions: [{ action: 'create', target: 'AGENTS.md', ownership: 'seed-once' }] },
    }
    expect(buildReadinessReport({ ...pending, stage: 'verify' }).nextAction.id).toBe(
      'not-installed',
    )
    expect(buildReadinessReport({ ...pending, stage: 'plan' }).nextAction.id).toBe('pending-writes')
    const refining = buildReadinessReport({ ...pending, stage: 'plan', journey: 'refinement' })
    expect(refining.nextAction.doc).toBe('docs/assisted-configuration.md#confirm-and-apply')
  })

  it('links every recommended step to a heading in the public docs', () => {
    for (const { doc } of REPORT_STEPS) {
      const [page, anchor] = doc.split('#')
      const headings = readFileSync(join(packageRoot, page), 'utf8')
        .replace(/```[\s\S]*?```/g, '')
        .match(/^#{2,4} .+$/gm)
        .map((line) => slug(line.replace(/^#+ /, '')))
      expect(headings, doc).toContain(anchor)
    }
  })
})

describe('stopped and recovered journeys', () => {
  it('refuses a legacy lock and an unknown lock until the person chooses', () => {
    const legacy = project({ git: false })
    writeFileSync(
      join(legacy, 'agent-framework-lock.json'),
      JSON.stringify({ version: 1, files: {}, merged: [] }),
    )
    const refused = onboarding(['plan'], legacy)
    expect(refused.status).toBe(1)
    expect(refused.out.missingChoices).toContain('migrateLegacy')
    expect(refused.out.report).toMatchObject({
      outcome: 'stopped',
      stop: { reason: 'refused-lock' },
      nextAction: { id: 'legacy-lock' },
    })

    const unknown = project({ git: false })
    writeFileSync(join(unknown, 'agent-framework-lock.json'), '{ not json')
    const held = onboarding(['plan'], unknown)
    expect(held.out.missingChoices).toContain('recoverUnknown')
    expect(held.out.report.nextAction.id).toBe('unknown-lock')
  })

  it('names the recover command after an interrupted apply, and recovery clears it', () => {
    const target = project({ git: false })
    const script = `
      import { createLocalOnboardingService } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'lib/onboarding/project-writer.mjs')).href)}
      const service = createLocalOnboardingService({})
      const plan = service.plan({ packageRoot: ${JSON.stringify(packageRoot)}, targetDir: ${JSON.stringify(target)} })
      let writes = 0
      service.apply(plan, { confirm: plan.digest, fault: (point) => {
        if (point === 'apply.after-replace' && ++writes === 3) process.exit(9)
      } })`
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', script])
    expect(crashed.status).toBe(9)
    const verify = onboarding(['verify'], target)
    expect(verify.out.report.nextAction.id).toBe('interrupted')
    const token = verify.out.report.recover.command.split('--confirm ')[1]
    const recovered = onboarding(['recover', '--confirm', token], target)
    expect(recovered.status).toBe(0)
    expect(recovered.out.report.blockers.map((item) => item.id)).not.toContain('interrupted')
  })

  it('undo restores the exact prior bytes of a project with its own files', () => {
    const target = project({ tests: true })
    writeFileSync(join(target, 'AGENTS.md'), '# Our own instructions\n')
    const before = snapshot(target)
    const { out } = onboarding(['plan'], target)
    const applied = onboarding(['apply', '--confirm', out.digest], target)
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe('# Our own instructions\n')
    const [, receipt] = applied.out.report.undo.command.match(/--receipt "([^"]+)"/)
    onboarding(['undo', '--receipt', receipt, '--confirm', applied.out.receiptToken], target)
    const after = snapshot(target)
    for (const path of Object.keys(after))
      if (path.replaceAll('\\', '/').startsWith('.agentflow/transactions/')) delete after[path]
    expect(after).toEqual(before)
  })
})

describe('refinement', () => {
  function adopted() {
    const target = project({ tests: true })
    const { out } = onboarding(['plan'], target)
    onboarding(['apply', '--confirm', out.digest], target)
    return target
  }

  it('previews, applies, verifies and undoes posture and ciCommands, changing only the project configuration', () => {
    const target = adopted()
    const configPath = join(target, 'agent-workflow.config.json')
    const prior = readFileSync(configPath)
    const before = snapshot(target)
    const changes = writeJson('changes.json', {
      posture: 'delegated',
      ciCommands: ['npm test', 'npm run lint'],
    })
    const preview = onboarding(['refine', '--changes', changes], target)
    expect(preview.out.journey).toBe('refinement')
    expect(preview.out.preview.change).toEqual([
      'agent-framework-lock.json',
      'agent-workflow.config.json',
    ])
    expect(
      preview.out.preview.create.every((path) =>
        path.replaceAll('\\', '/').startsWith('.agentflow/transactions/'),
      ),
    ).toBe(true)
    const applied = onboarding(
      ['apply', '--changes', changes, '--confirm', preview.out.digest],
      target,
    )
    expect(applied.status).toBe(0)
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config).toMatchObject({ posture: 'delegated', ciCommands: ['npm test', 'npm run lint'] })
    expect(applied.out.report).toMatchObject({
      journey: 'refinement',
      governedChange: { ready: false },
    })
    const after = snapshot(target)
    const changed = Object.keys(after).filter(
      (path) =>
        !path.replaceAll('\\', '/').startsWith('.agentflow/transactions/') &&
        after[path] !== before[path],
    )
    expect(changed.sort()).toEqual(['agent-framework-lock.json', 'agent-workflow.config.json'])
    const [, receipt] = applied.out.report.undo.command.match(/--receipt "([^"]+)"/)
    onboarding(['undo', '--receipt', receipt, '--confirm', applied.out.receiptToken], target)
    expect(readFileSync(configPath).equals(prior)).toBe(true)
  })

  it('sends an unadopted project to adoption and refuses an empty change', () => {
    const target = project()
    const changes = writeJson('changes.json', { posture: 'assisted' })
    const unadopted = onboarding(['refine', '--changes', changes], target)
    expect(unadopted.status).toBe(1)
    expect(unadopted.out.report.blockers.map((item) => item.id)).toContain('not-adopted')
    expect(existsSync(join(target, 'agent-framework-lock.json'))).toBe(false)
    const empty = onboarding(['refine', '--changes', writeJson('none.json', {})], adopted())
    expect(empty.out.report.nextAction.id).toBe('no-changes')
  })
})
