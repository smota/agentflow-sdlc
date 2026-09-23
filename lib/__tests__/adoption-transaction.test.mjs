import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyAdoption as applyWithReceipt,
  planAdoption,
  readAdoptionJournal,
  recoverAdoption,
  rollbackAdoption,
} from '../adoption/transaction.mjs'
import { hashContent, readLockfile } from '../lockfile.mjs'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const receiptFiles = []
function applyAdoption(source, target, plan, options) {
  const receiptDestination = `${target}-${receiptFiles.length}.receipt.json`
  receiptFiles.push(receiptDestination)
  return applyWithReceipt(source, target, plan, { ...options, receiptDestination })
}

function fileInventory(root, relative = '') {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const absolute = join(root, name)
      const path = relative ? `${relative}/${name}` : name
      return statSync(absolute).isDirectory()
        ? [`${path}/`, ...fileInventory(absolute, path)]
        : [`${path}:${readFileSync(absolute).toString('base64')}`]
    })
}

describe('preview-first transactional adoption', () => {
  let target
  let linkTarget

  beforeEach(() => {
    target = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-adoption-'))
  })

  afterEach(() => {
    for (const path of receiptFiles.splice(0)) rmSync(path, { force: true })
    rmSync(target, { recursive: true, force: true })
    if (linkTarget) rmSync(linkTarget, { recursive: true, force: true })
    linkTarget = null
  })

  it('plans a standard adoption without writing target bytes', () => {
    writeFileSync(join(target, 'project.txt'), 'owned by project\n')
    const before = fileInventory(target)
    const plan = planAdoption(packageRoot, target)
    expect(plan).toMatchObject({
      version: 1,
      operation: 'adopt',
      profile: 'standard',
      priorLockVersion: 2,
      blocked: false,
    })
    expect(plan.actions.some((item) => item.source === 'lib/core/provider-binding.mjs')).toBe(true)
    expect(fileInventory(target)).toEqual(before)
  })

  it('applies a reviewed plan and writes lockfile v2 last', () => {
    const plan = planAdoption(packageRoot, target)
    const checkpoints = []
    const receipt = applyAdoption(packageRoot, target, plan, {
      confirm: plan.token,
      fault: (checkpoint) => {
        checkpoints.push(checkpoint)
        expect(readAdoptionJournal(target)).not.toBeNull()
      },
    })
    expect(receipt.changed.at(-1)).toBe('agent-framework-lock.json')
    expect(checkpoints.at(-1)).toBe('receipt.after-write')
    expect(checkpoints.indexOf('receipt.before-write')).toBeGreaterThan(
      checkpoints.indexOf('lock.after-atomic-replace'),
    )
    expect(readLockfile(target, { strict: true })).toMatchObject({
      version: 2,
      profile: 'standard',
      planToken: plan.token,
    })
    expect(existsSync(join(target, 'lib', 'providers', 'ai-foundry-desk.mjs'))).toBe(true)
    expect(readAdoptionJournal(target)).toBeNull()
  })

  it('rejects a stale plan before changing files', () => {
    const plan = planAdoption(packageRoot, target)
    mkdirSync(join(target, 'manifests'), { recursive: true })
    writeFileSync(join(target, 'manifests', 'role-catalog.json'), '{}\n')
    const before = fileInventory(target)
    expect(() => applyAdoption(packageRoot, target, plan, { confirm: plan.token })).toThrow(
      'Adoption plan is stale',
    )
    expect(fileInventory(target)).toEqual(before)
  })

  it('restores exact bytes after a mid-apply failure', () => {
    writeFileSync(join(target, 'project.txt'), 'preserve me\n')
    const before = fileInventory(target)
    const plan = planAdoption(packageRoot, target)
    let replacements = 0
    expect(() =>
      applyAdoption(packageRoot, target, plan, {
        confirm: plan.token,
        fault(checkpoint) {
          if (checkpoint === 'apply.after-replace' && ++replacements === 3) {
            throw new Error('injected failure')
          }
        },
      }),
    ).toThrow('injected failure')
    expect(fileInventory(target)).toEqual(before)
  })

  it('rolls back a completed adoption only while applied files are unchanged', () => {
    writeFileSync(join(target, 'project.txt'), 'preserve me\n')
    const before = fileInventory(target)
    const plan = planAdoption(packageRoot, target)
    const receipt = applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    expect(rollbackAdoption(target, receipt, { confirm: receipt.receiptToken })).toMatchObject({
      status: 'rolled-back',
    })
    expect(fileInventory(target)).toEqual(before)
  })

  it('binds rollback receipts to the exact target root', () => {
    const plan = planAdoption(packageRoot, target)
    const receipt = applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    const other = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-adoption-other-'))
    expect(() => rollbackAdoption(other, receipt, { confirm: receipt.receiptToken })).toThrow(
      'does not match the target root',
    )
    rmSync(other, { recursive: true, force: true })
  })

  it('restores the applied state after an injected rollback failure', () => {
    const plan = planAdoption(packageRoot, target)
    const receipt = applyAdoption(packageRoot, target, plan, { confirm: plan.token })
    const applied = fileInventory(target)
    expect(() =>
      rollbackAdoption(target, receipt, {
        confirm: receipt.receiptToken,
        fault(checkpoint) {
          if (checkpoint === 'rollback.after-remove') throw new Error('rollback fault')
        },
      }),
    ).toThrow('rollback fault')
    expect(fileInventory(target)).toEqual(applied)
  })

  it('rejects a symlink or junction target root', () => {
    linkTarget = `${target}-link`
    symlinkSync(target, linkTarget, 'junction')
    expect(() => planAdoption(packageRoot, linkTarget)).toThrow('symlink or junction')
  })

  it('rejects a symlink inside a receipt path before applying managed files', () => {
    const link = join(target, 'receipt-link')
    symlinkSync(target, link, 'junction')
    const plan = planAdoption(packageRoot, target, { profile: 'minimal' })
    expect(() =>
      applyWithReceipt(packageRoot, target, plan, {
        confirm: plan.token,
        receiptDestination: join(link, 'receipt.json'),
      }),
    ).toThrow('not a regular directory')
    expect(existsSync(join(target, 'agent-framework-lock.json'))).toBe(false)
    expect(existsSync(join(target, 'receipt.json'))).toBe(false)
  })

  it('recovers a persisted interrupted-adoption journal by token', () => {
    const before = Buffer.from('before\n')
    const after = Buffer.from('after\n')
    writeFileSync(join(target, 'managed.txt'), after)
    const base = {
      version: 1,
      operation: 'adopt',
      target: target.replaceAll('\\', '/'),
      planToken: 'plan-token',
      profile: 'minimal',
    }
    const recoveryToken = createHash('sha256').update(JSON.stringify(base)).digest('hex')
    writeFileSync(
      join(target, '.agentflow-adoption-journal.json'),
      JSON.stringify({
        ...base,
        status: 'applying',
        mutations: [
          {
            path: 'managed.txt',
            beforeContentBase64: before.toString('base64'),
            beforeHash: hashContent(before),
            afterHash: hashContent(after),
          },
        ],
        recoveryToken,
      }),
    )
    expect(() => planAdoption(packageRoot, target)).toThrow('requires explicit recovery')
    expect(recoverAdoption(target, { confirm: recoveryToken })).toMatchObject({
      status: 'recovered',
    })
    expect(readFileSync(join(target, 'managed.txt'), 'utf8')).toBe('before\n')
    expect(readAdoptionJournal(target)).toBeNull()
  })

  it('recovers a hard interruption after write-ahead and before replacement', () => {
    writeFileSync(join(target, 'project.txt'), 'preserve\n')
    const before = fileInventory(target)
    const moduleUrl = new URL('../adoption/transaction.mjs', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { planAdoption, applyAdoption } from ${JSON.stringify(moduleUrl)};
         const plan = planAdoption(${JSON.stringify(packageRoot)}, ${JSON.stringify(target)});
         applyAdoption(${JSON.stringify(packageRoot)}, ${JSON.stringify(target)}, plan, {
           confirm: plan.token,
           receiptDestination: ${JSON.stringify(target + '.receipt.json')},
           fault(checkpoint) { if (checkpoint === 'apply.before-replace') process.exit(91) }
         });`,
      ],
      { encoding: 'utf8' },
    )
    expect(child.status).toBe(91)
    const journal = readAdoptionJournal(target)
    expect(journal.mutations).toHaveLength(1)
    expect(recoverAdoption(target, { confirm: journal.recoveryToken })).toMatchObject({
      status: 'recovered',
    })
    expect(fileInventory(target)).toEqual(before)
  })

  it('recovers a hard interruption immediately after staging a file', () => {
    writeFileSync(join(target, 'project.txt'), 'preserve\n')
    const before = fileInventory(target)
    const moduleUrl = new URL('../adoption/transaction.mjs', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { planAdoption, applyAdoption } from ${JSON.stringify(moduleUrl)};
         const plan = planAdoption(${JSON.stringify(packageRoot)}, ${JSON.stringify(target)});
         applyAdoption(${JSON.stringify(packageRoot)}, ${JSON.stringify(target)}, plan, {
           confirm: plan.token,
           receiptDestination: ${JSON.stringify(target + '.receipt.json')},
           fault(checkpoint) { if (checkpoint === 'stage.after-file') process.exit(92) }
         });`,
      ],
      { encoding: 'utf8' },
    )
    expect(child.status).toBe(92)
    const journal = readAdoptionJournal(target)
    expect(journal.mutations).toHaveLength(1)
    expect(recoverAdoption(target, { confirm: journal.recoveryToken })).toMatchObject({
      status: 'recovered',
    })
    expect(fileInventory(target)).toEqual(before)
  })

  it('fails closed on an unknown future lockfile version', () => {
    writeFileSync(join(target, 'agent-framework-lock.json'), '{"version":99,"entries":[]}\n')
    expect(() => planAdoption(packageRoot, target)).toThrow('AgentFlow lockfile version must be 2')
  })

  it('rejects removed v1 lockfiles', () => {
    writeFileSync(join(target, 'agent-framework-lock.json'), '{"files":{},"merged":[]}\n')
    expect(() => planAdoption(packageRoot, target)).toThrow('legacy lockfiles are not supported')
  })
})
