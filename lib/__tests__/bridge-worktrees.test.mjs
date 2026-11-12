// Slice worktrees wired into the bridge (#584b). Real git in temp repos (a bare "origin" and a
// clone), the in-memory queue port and the filesystem source; no rig, no network.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseIntakeBody } from '../bridge/intake-body.mjs'
import { bridgeConfigProblems, normalizeBridgeConfig } from '../bridge/config.mjs'
import { createWorktreesPort } from '../bridge/worktrees-port.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'
import { RIG, bridgeFixture, cleanupBridgeFixtures } from './bridge-fixture.mjs'

const g = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const SESSION = `pm-analyst@${RIG}`

let tmp
let origin
let repo

function commitFile(cwd, name, text = name) {
  writeFileSync(join(cwd, name), text)
  g(cwd, 'add', name)
  g(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', `add ${name}`)
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'bridge-wt-')))
  origin = join(tmp, 'origin.git')
  repo = join(tmp, 'clone')
  g(tmp, 'init', '-q', '--bare', '-b', 'development', origin)
  g(tmp, 'clone', '-q', origin, repo)
  commitFile(repo, 'README.md')
  g(repo, 'push', '-q', 'origin', 'HEAD:development')
})
afterEach(() => {
  cleanupBridgeFixtures()
  rmSync(tmp, { recursive: true, force: true })
})

function setup(settings = {}) {
  const worktrees = createWorktreesPort({
    repoRoot: repo,
    settings: { integration: 'development', ...settings },
  })
  const fixture = bridgeFixture({ bridgeOptions: { worktrees } })
  return { ...fixture, worktrees }
}

// Intake and start one item; returns the ids and the absolute worktree path.
async function started(fixture, ref = fixture.makeItem()) {
  const { qitemId, stableId } = await fixture.bridge.intake(ref)
  const result = await fixture.bridge.start(qitemId, { session: SESSION })
  const slice = `filesystem-${parseSourceRef(ref).id}`
  return { ref, qitemId, stableId, result, slice, path: join(repo, '.worktrees', slice) }
}

const notices = (queue, stableId) =>
  queue.rows().filter((row) => row.tags.includes(`af-notice:${stableId}`))
const claimOf = (source, ref) => source.readClaim({ id: parseSourceRef(ref).id })

// Work done in a slice worktree and pushed to the integration branch: merged.
function mergeWork(path, name = 'work.txt') {
  commitFile(path, name)
  g(path, 'push', '-q', 'origin', 'HEAD:development')
}

describe('slice worktrees in the bridge (#584b)', () => {
  it('AC1: two seats on two slices never share a working directory', async () => {
    const fixture = setup()
    const a = await started(fixture)
    const b = await started(fixture)
    expect(a.path).not.toBe(b.path)
    for (const item of [a, b]) {
      expect(item.result).toMatchObject({
        status: 'started',
        worktree: { path: `.worktrees/${item.slice}`, created: true, branch: `work/${item.slice}` },
      })
      expect(g(item.path, 'rev-parse', '--show-toplevel')).toBe(item.path)
      expect(g(item.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(`work/${item.slice}`)
    }
    expect(g(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(3)
    // Work in one never appears in the other or in the primary checkout.
    commitFile(a.path, 'only-a.txt')
    expect(existsSync(join(b.path, 'only-a.txt'))).toBe(false)
    expect(existsSync(join(repo, 'only-a.txt'))).toBe(false)
  })

  it('names the worktree path in the intake body and the workflow objective before any seat works', async () => {
    const fixture = setup()
    const ref = fixture.makeItem()
    const { qitemId } = await fixture.bridge.intake(ref)
    const body = parseIntakeBody((await fixture.queue.show(qitemId)).body)
    expect(body.worktreePath).toBe('.worktrees/filesystem-item-1')
    expect(existsSync(join(repo, '.worktrees'))).toBe(false)
    const objectives = []
    const instantiate = fixture.queue.instantiateWorkflow.bind(fixture.queue)
    fixture.queue.instantiateWorkflow = async (input) => {
      // The worktree exists by the time the workflow is instantiated for the seats.
      expect(existsSync(join(repo, body.worktreePath))).toBe(true)
      objectives.push(input.rootObjective)
      return instantiate(input)
    }
    await fixture.bridge.start(qitemId, { session: SESSION })
    expect(objectives[0]).toContain('\nworktree_path=.worktrees/filesystem-item-1')
  })

  it('a failed worktree creation hands the claimed row back and starts nothing', async () => {
    const fixture = setup({ integration: 'nope' })
    const ref = fixture.makeItem()
    const { qitemId } = await fixture.bridge.intake(ref)
    await expect(fixture.bridge.start(qitemId, { session: SESSION })).rejects.toThrow(/nope/)
    expect((await fixture.queue.show(qitemId)).state).toBe('pending')
    expect(fixture.queue.instances()).toHaveLength(0)
  })

  it('AC2: a merged slice with a clean tree is removed and its claim released', async () => {
    const fixture = setup()
    const item = await started(fixture)
    expect(await claimOf(fixture.source, item.ref)).toMatchObject({ status: 'held' })
    mergeWork(item.path)
    await fixture.setItem(item.ref, { lifecycle: 'merged' })
    const result = await fixture.bridge.intake(item.ref, { event: 'merged' })
    expect(result.worktree).toMatchObject({
      status: 'removed',
      claim: { released: true },
    })
    expect(existsSync(item.path)).toBe(false)
    expect(g(repo, 'worktree', 'list', '--porcelain')).not.toContain(item.slice)
    expect(await claimOf(fixture.source, item.ref)).toMatchObject({ status: 'free' })
    expect(notices(fixture.queue, item.stableId)).toHaveLength(0)
    // A repeat finds nothing left to do and still reports success.
    expect((await fixture.bridge.cleanup(item.ref)).worktree).toMatchObject({ status: 'absent' })
  })

  it.each([
    ['an untracked file', (path) => writeFileSync(join(path, 'scratch.txt'), 'x'), /untracked/],
    ['a modified file', (path) => writeFileSync(join(path, 'README.md'), 'changed'), /modified/],
    [
      'a commit that is not on the integration branch',
      (path) => commitFile(path, 'unmerged.txt'),
      /not merged/,
    ],
    [
      'a locked worktree',
      (path) => g(repo, 'worktree', 'lock', '--reason', 'seat busy', path),
      /locked/,
    ],
  ])('AC3: a worktree with %s is kept and a person is told', async (_, dirty, reason) => {
    const fixture = setup()
    const item = await started(fixture)
    dirty(item.path)
    await fixture.setItem(item.ref, { lifecycle: 'merged' })
    const result = await fixture.bridge.intake(item.ref, { event: 'merged' })
    expect(result.worktree.status).toBe('kept')
    expect(result.worktree.reasons.join(' ')).toMatch(reason)
    expect(existsSync(item.path)).toBe(true)
    // The claim stays with the rig and one notice names the reasons.
    expect(await claimOf(fixture.source, item.ref)).toMatchObject({ status: 'held' })
    const told = notices(fixture.queue, item.stableId)
    expect(told).toHaveLength(1)
    expect(told[0].body).toContain('kind=worktree-kept')
    expect(told[0].body).toMatch(reason)
    // Telling again is a re-delivery, not a second row.
    await fixture.bridge.cleanup(item.ref)
    expect(notices(fixture.queue, item.stableId)).toHaveLength(1)
  })

  it('keeps the worktree when the integration ref cannot be refreshed (a stale ref never removes)', async () => {
    const fixture = setup()
    const item = await started(fixture)
    mergeWork(item.path)
    g(repo, 'remote', 'set-url', 'origin', join(tmp, 'gone.git'))
    await fixture.setItem(item.ref, { lifecycle: 'merged' })
    const result = await fixture.bridge.intake(item.ref, { event: 'merged' })
    expect(result.worktree).toMatchObject({ status: 'kept' })
    expect(result.worktree.reasons.join(' ')).toMatch(/could not fetch origin\/development/)
    expect(existsSync(item.path)).toBe(true)
    expect(notices(fixture.queue, item.stableId)).toHaveLength(1)
  })

  it('removes a squash-merged worktree only when the source reports its merged head', async () => {
    const fixture = setup()
    const item = await started(fixture)
    commitFile(item.path, 'squashed.txt')
    const head = g(item.path, 'rev-parse', 'HEAD')
    // The squash commit on the integration branch is a different commit holding the same change.
    commitFile(repo, 'squashed.txt', 'squash commit')
    g(repo, 'push', '-q', 'origin', 'HEAD:development')
    await fixture.setItem(item.ref, { lifecycle: 'merged' })
    expect((await fixture.bridge.cleanup(item.ref)).worktree.status).toBe('kept')
    const worktrees = createWorktreesPort({
      repoRoot: repo,
      settings: { integration: 'development' },
    })
    const via = await worktrees.cleanup({ slice: item.slice, workItem: { mergedHead: head } })
    expect(via).toMatchObject({ status: 'removed' })
  })

  it('cleanup does nothing for an item that is not merged', async () => {
    const fixture = setup()
    const item = await started(fixture)
    expect(await fixture.bridge.cleanup(item.ref)).toMatchObject({ status: 'not-ready' })
    expect(existsSync(item.path)).toBe(true)
  })
})

describe('reconcile sweeps slice worktrees (#584b)', () => {
  it('AC4: removes closed or merged slices under the safety rule, keeps the rest, lists orphans', async () => {
    const fixture = setup()
    const open = await started(fixture)
    const closedClean = await started(fixture)
    const closedDirty = await started(fixture)
    const mergedClean = await started(fixture)
    mergeWork(mergedClean.path)
    writeFileSync(join(closedDirty.path, 'wip.txt'), 'x')
    await fixture.setItem(closedClean.ref, { lifecycle: 'closed' })
    await fixture.setItem(closedDirty.ref, { lifecycle: 'closed' })
    await fixture.setItem(mergedClean.ref, { lifecycle: 'merged' })
    // A worktree nobody owns: its slice is in no source item.
    g(
      repo,
      'worktree',
      'add',
      '-q',
      '-b',
      'work/ghost',
      join(repo, '.worktrees', 'ghost'),
      'origin/development',
    )

    const dry = await fixture.bridge.reconcile({ dryRun: true })
    expect(dry.worktrees.wouldRemove.map((e) => e.slice).sort()).toEqual(
      [closedClean.slice, mergedClean.slice].sort(),
    )
    expect(existsSync(closedClean.path)).toBe(true)

    const report = await fixture.bridge.reconcile()
    expect(report.worktrees.removed.map((e) => e.slice).sort()).toEqual(
      [closedClean.slice, mergedClean.slice].sort(),
    )
    expect(report.worktrees.orphans).toEqual([expect.objectContaining({ slice: 'ghost' })])
    expect(report.worktrees.kept.map((e) => e.slice).sort()).toEqual(
      [closedDirty.slice, open.slice].sort(),
    )
    expect(existsSync(open.path)).toBe(true)
    expect(existsSync(closedDirty.path)).toBe(true)
    expect(existsSync(join(repo, '.worktrees', 'ghost'))).toBe(true)
    expect(existsSync(closedClean.path)).toBe(false)
    expect(existsSync(mergedClean.path)).toBe(false)
    // Removed worktrees release their claims; the dirty one is reported to a person.
    expect(await claimOf(fixture.source, mergedClean.ref)).toMatchObject({ status: 'free' })
    expect(await claimOf(fixture.source, closedDirty.ref)).toMatchObject({ status: 'held' })
    const told = notices(fixture.queue, closedDirty.stableId)
    expect(told).toHaveLength(1)
    expect(told[0].body).toMatch(/untracked/)
    expect(notices(fixture.queue, open.stableId)).toHaveLength(0)
  })

  it('keeps every closed worktree when the integration ref cannot be refreshed', async () => {
    const fixture = setup()
    const item = await started(fixture)
    await fixture.setItem(item.ref, { lifecycle: 'closed' })
    g(repo, 'remote', 'set-url', 'origin', join(tmp, 'gone.git'))
    const report = await fixture.bridge.reconcile()
    expect(report.worktrees.removed).toEqual([])
    expect(report.worktrees.kept[0].reasons.join(' ')).toMatch(/could not fetch/)
    expect(existsSync(item.path)).toBe(true)
  })

  it('reports a failing sweep as a reconcile error without hiding the queue work', async () => {
    const worktrees = {
      sweep: async () => {
        throw new Error('git exploded')
      },
    }
    const fixture = bridgeFixture({ bridgeOptions: { worktrees } })
    fixture.makeItem()
    const report = await fixture.bridge.reconcile()
    expect(report.status).toBe('reconciled-with-errors')
    expect(report.failed).toEqual([{ stage: 'worktree-sweep', error: 'git exploded' }])
    expect(report.restored).toHaveLength(1)
  })
})

describe('worktree configuration (#584b)', () => {
  it('is on by default and can be switched off or relocated', () => {
    const base = { rig: 'r', source: { adapter: 'filesystem' } }
    expect(normalizeBridgeConfig(base).worktrees).toEqual({ enabled: true })
    expect(normalizeBridgeConfig({ ...base, worktrees: false }).worktrees).toEqual({
      enabled: false,
    })
    expect(
      normalizeBridgeConfig({ ...base, worktrees: { enabled: false, dir: 'x' } }).worktrees,
    ).toEqual({ enabled: false })
    expect(
      normalizeBridgeConfig({
        ...base,
        worktrees: { dir: 'wt', branchPrefix: 'slice/', integration: 'main' },
      }).worktrees,
    ).toEqual({ enabled: true, dir: 'wt', branchPrefix: 'slice/', integration: 'main' })
  })

  it('refuses a worktree directory outside the project', () => {
    for (const dir of ['/abs', '../up', 'a/../../b']) {
      const config = normalizeBridgeConfig({
        rig: 'r',
        source: { adapter: 'filesystem', evidenceWriters: ['w'] },
        worktrees: { dir },
      })
      expect(bridgeConfigProblems(config).join(' ')).toMatch(/worktrees\.dir/)
    }
  })

  it('uses the configured directory and branch prefix', async () => {
    const fixture = setup({ dir: 'wt', branchPrefix: 'slice/' })
    const item = await started(fixture)
    expect(item.result.worktree).toMatchObject({
      path: `wt/${item.slice}`,
      branch: `slice/${item.slice}`,
    })
    expect(existsSync(join(repo, 'wt', item.slice))).toBe(true)
  })
})

describe('worktree port from the CLI (#584b)', () => {
  it('resolves the primary checkout when a command runs inside a slice worktree', async () => {
    const { main } = await import('../../scripts/bridge.mjs')
    const { defaultGit } = await import('../runtime/slice-worktrees.mjs')
    const inner = join(repo, '.worktrees', 'filesystem-item-1')
    g(repo, 'worktree', 'add', '-q', '-b', 'work/filesystem-item-1', inner, 'origin/development')
    const work = join(repo, 'items')
    writeFileSync(
      join(inner, 'agent-workflow.config.json'),
      JSON.stringify({
        adapters: {
          openrig: {
            bridge: {
              rig: RIG,
              source: { adapter: 'filesystem', root: work, claimWriters: ['agentflow-bridge'] },
            },
          },
        },
      }),
    )
    let text = ''
    const code = await main(['status', '--target', inner, '--json'], {
      execFile: async () => ({ stdout: 'rig 0.7.6' }),
      git: defaultGit,
      stdout: { write: (chunk) => (text += chunk) },
      stderr: { write: () => {} },
    })
    expect(code).toBe(0)
    expect(JSON.parse(text).worktrees.repoRoot).toBe(repo)
  })
})
