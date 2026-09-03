import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, it, expect } from 'vitest'
import { withAdoptionLock } from '../adoption/operation-lock.mjs'
import {
  planAdoption,
  applyAdoption,
  rollbackAdoption,
  readAdoptionJournal,
  recoverAdoption,
} from '../adoption/transaction.mjs'
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-contained-'))
  roots.push(root)
  return root
}
describe('contained adoption storage', () => {
  it('recovers when both the writer and its first recovery process are interrupted', () => {
    const root = fixture()
    const moduleUrl = new URL('../adoption/operation-lock.mjs', import.meta.url).href
    const run = (body) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {withAdoptionLock} from ${JSON.stringify(moduleUrl)}; const root=${JSON.stringify(root)}; ${body}`,
        ],
        { encoding: 'utf8' },
      )
    expect(run('withAdoptionLock(root,()=>process.exit(91))').status).toBe(91)
    expect(
      run(
        "withAdoptionLock(root,()=>{}, {recovery:true,fault(point){if(point==='recovery.claimed')process.exit(92)}})",
      ).status,
    ).toBe(92)
    expect(withAdoptionLock(root, () => 'recovered', { recovery: true })).toBe('recovered')
    expect(
      run(
        "withAdoptionLock(root,()=>{}, {fault(point){if(point==='writer.before-publication')process.exit(94)}})",
      ).status,
    ).toBe(94)
    expect(withAdoptionLock(root, () => 'fresh')).toBe('fresh')
    expect(existsSync(join(root, '.agentflow-adoption.lock'))).toBe(false)
    expect(() =>
      withAdoptionLock(root, () => withAdoptionLock(root, () => {}, { recovery: true })),
    ).toThrow('still present')
  })
  it('plans read-only and keeps a durable receipt outside managed payload', () => {
    const root = fixture(),
      prior = Buffer.from('# authored\r\n', 'utf8')
    writeFileSync(join(root, '.gitignore'), prior)
    const plan = planAdoption(packageRoot, root, { storage: 'project', profile: 'minimal' })
    expect(existsSync(join(root, '.agentflow'))).toBe(false)
    const receipt = applyAdoption(packageRoot, root, plan, { confirm: plan.token })
    expect(JSON.parse(readFileSync(join(root, receipt.receiptPath), 'utf8')).receiptToken).toBe(
      receipt.receiptToken,
    )
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('/.agentflow/transactions/')
    rollbackAdoption(root, receipt, { confirm: receipt.receiptToken })
    expect(readFileSync(join(root, '.gitignore'))).toEqual(prior)
    expect(spawnSync('git', ['init', root], { encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['check-ignore', receipt.receiptPath], { cwd: root, encoding: 'utf8' })
        .status,
    ).toBe(0)
  })
  it('finalizes cleanup after a durable receipt instead of losing recovery data', () => {
    const root = fixture()
    const plan = planAdoption(packageRoot, root, { storage: 'project', profile: 'minimal' })
    expect(() =>
      applyAdoption(packageRoot, root, plan, {
        confirm: plan.token,
        fault: (point) => {
          if (point === 'receipt.after-write') throw new Error('simulated interruption')
        },
      }),
    ).toThrow('durable')
    const journal = readAdoptionJournal(root)
    expect(() => planAdoption(packageRoot, root)).toThrow('recovery')
    expect(recoverAdoption(root, { confirm: journal.recoveryToken }).status).toBe('finalized')
    expect(readAdoptionJournal(root)).toBeNull()
  })
  it('restores authored bytes if receipt persistence fails before commit', () => {
    const root = fixture()
    writeFileSync(join(root, 'authored.txt'), 'retain')
    const plan = planAdoption(packageRoot, root, { profile: 'minimal' })
    expect(() =>
      applyAdoption(packageRoot, root, plan, {
        confirm: plan.token,
        receiptDestination: `${root}.receipt.json`,
        persistReceipt: () => {
          throw new Error('disk full')
        },
      }),
    ).toThrow('disk full')
    expect(readFileSync(join(root, 'authored.txt'), 'utf8')).toBe('retain')
    expect(existsSync(join(root, 'agent-framework-lock.json'))).toBe(false)
  })
  it('resumes a rollback after the process exits between file restorations', () => {
    const root = fixture()
    const plan = planAdoption(packageRoot, root, { storage: 'project', profile: 'minimal' })
    const receipt = applyAdoption(packageRoot, root, plan, { confirm: plan.token })
    const moduleUrl = new URL('../adoption/transaction.mjs', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {readFileSync} from 'node:fs'; import {rollbackAdoption} from ${JSON.stringify(moduleUrl)}; const receipt=JSON.parse(readFileSync(${JSON.stringify(join(root, receipt.receiptPath))},'utf8')); rollbackAdoption(${JSON.stringify(root)},receipt,{confirm:receipt.receiptToken,fault(point){if(point==='rollback.after-remove')process.exit(93)}})`,
      ],
      { encoding: 'utf8' },
    )
    expect(child.status).toBe(93)
    expect(readAdoptionJournal(root).operation).toBe('rollback')
    expect(recoverAdoption(root, { confirm: receipt.receiptToken }).status).toBe('rolled-back')
    expect(existsSync(join(root, 'agent-framework-lock.json'))).toBe(false)
  })
})
