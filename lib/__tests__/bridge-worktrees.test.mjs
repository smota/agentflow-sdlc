// Slice worktrees wired into the bridge (#584b). Real git in temp repos (a bare "origin" and a
// clone), the in-memory queue port and the filesystem source; no rig, no network.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBridge } from '../bridge/bridge.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import { createGitHubSourceAdapter } from '../sources/github.mjs'
import { createFakeGitHub } from './fixtures/fake-github.mjs'
import { parseIntakeBody } from '../bridge/intake-body.mjs'
import { bridgeConfigProblems, normalizeBridgeConfig } from '../bridge/config.mjs'
import { createWorktreesPort, scrubReason } from '../bridge/worktrees-port.mjs'
import { defaultGit } from '../runtime/slice-worktrees.mjs'
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
    const { worktreesFor } = await import('../../scripts/bridge.mjs')
    const { defaultGit } = await import('../runtime/slice-worktrees.mjs')
    const inner = join(repo, '.worktrees', 'filesystem-item-1')
    g(repo, 'worktree', 'add', '-q', '-b', 'work/filesystem-item-1', inner, 'origin/development')
    const port = worktreesFor({ worktrees: { enabled: true } }, { target: inner, git: defaultGit })
    expect(port.root()).toBe(repo)
    expect(port.pathFor({ slice: 'filesystem-item-2' })).toEqual({
      path: '.worktrees/filesystem-item-2',
    })
  })
})

describe('review of #584: dry run, redaction, laziness', () => {
  const spy = () => {
    const calls = []
    const git = (args, options) => {
      calls.push(args)
      return defaultGit(args, options)
    }
    return { calls, git }
  }

  it('builds the port and reads its settings without running git; a non-git project is inert', () => {
    const { calls, git } = spy()
    const port = createWorktreesPort({ repoRoot: repo, settings: {}, git })
    expect(port.settings).toMatchObject({ dir: '.worktrees', branchPrefix: 'work/' })
    expect(calls).toEqual([])
    const none = createWorktreesPort({
      resolveRepoRoot: () => {
        throw new Error('not a git repository')
      },
    })
    expect(none.pathFor({ slice: 's' })).toBeNull()
    expect(none.prepare({ slice: 's' })).toBeNull()
    expect(none.cleanup({ slice: 's' })).toBeNull()
  })

  it('reconcile --dry-run does not fetch: refs and FETCH_HEAD stay as they were, and it says so', async () => {
    const fixture = setup()
    const item = await started(fixture)
    await fixture.setItem(item.ref, { lifecycle: 'closed' })
    // The remote moves on after the last fetch.
    const other = join(tmp, 'other')
    g(tmp, 'clone', '-q', origin, other)
    commitFile(other, 'later.txt')
    g(other, 'push', '-q', 'origin', 'HEAD:development')
    const snapshot = () =>
      [
        g(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
        readFileSync(join(repo, '.git', 'FETCH_HEAD'), 'utf8'),
      ].join('\n')
    const before = snapshot()
    const report = await fixture.bridge.reconcile({ dryRun: true })
    expect(snapshot()).toBe(before)
    expect(report.worktrees.possiblyStale).toBe(true)
    expect(existsSync(item.path)).toBe(true)
  })

  it('keeps raw git output with home paths and remote URLs out of what a person is told', async () => {
    const home = homedir()
    const url = 'https://user:s3cr3t-token@example.com/org/repo.git'
    let armed = false
    const git = (args, options) => {
      if (armed && args[0] === 'fetch') {
        throw Object.assign(new Error('Command failed'), {
          stderr: `fatal: unable to access '${url}/': ${join(home, 'private', 'x')} and ${repo}/.git denied\n`,
        })
      }
      return defaultGit(args, options)
    }
    const worktrees = createWorktreesPort({
      repoRoot: repo,
      settings: { integration: 'development' },
      git,
    })
    const fixture = bridgeFixture({ bridgeOptions: { worktrees } })
    const item = await started(fixture)
    mergeWork(item.path)
    await fixture.setItem(item.ref, { lifecycle: 'merged' })
    armed = true
    const result = await fixture.bridge.cleanup(item.ref)
    expect(result.worktree.status).toBe('kept')
    const told = notices(fixture.queue, item.stableId)
    expect(told).toHaveLength(1)
    const text = [...result.worktree.reasons, told[0].body].join('\n')
    expect(text).toMatch(/could not fetch origin\/development/)
    for (const secret of ['s3cr3t-token', 'example.com', home, repo]) {
      expect(text).not.toContain(secret)
    }
  })

  it('scrubs paths, URLs and tokens', () => {
    const text = scrubReason(
      `at ${repo}/.worktrees/a and ${homedir()}/x via https://u:tok@h.io/r.git or git@h.io:org/r.git`,
      { roots: [repo], remoteUrls: ['/some/local/remote.git'] },
    )
    expect(text).toBe('at .worktrees/a and ~/x via <url> or <remote>')
  })
})

describe('squash-merged slices through the GitHub adapter (#584)', () => {
  const GH_REPO = 'smota/agentflow-fake'
  const MERGED_AT = '2026-01-02T00:00:00Z'

  async function githubSetup() {
    const fake = createFakeGitHub({ repo: GH_REPO })
    const source = createGitHubSourceAdapter({ repo: GH_REPO, client: fake.client })
    const queue = createMemoryQueuePort()
    const config = normalizeBridgeConfig({
      rig: RIG,
      source: { adapter: 'github', repo: GH_REPO, evidenceWriters: ['agentflow-bot'] },
    })
    const worktrees = createWorktreesPort({
      repoRoot: repo,
      settings: { integration: 'development' },
    })
    const bridge = createBridge({ source, queue, config, worktrees })
    // A labelled pull request is the work item; its slice is github-<number>.
    const number = fake.seedIssue({ title: 'PR', labels: ['agentflow:ready'], pullRequest: true })
    const ref = `github:${GH_REPO}#${number}`
    const { qitemId, stableId } = await bridge.intake(ref)
    await bridge.start(qitemId, { session: SESSION })
    const path = join(repo, '.worktrees', `github-${number}`)
    commitFile(path, 'feature.txt')
    const head = g(path, 'rev-parse', 'HEAD')
    // The pull request is squash-merged: one new single-parent commit, not the branch's commit.
    g(
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'merge',
      '--squash',
      `work/github-${number}`,
    )
    g(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'squash (#1)')
    g(repo, 'push', '-q', 'origin', 'HEAD:development')
    expect(g(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(2)
    const merge = (headSha) =>
      fake.editIssue(number, {
        state: 'closed',
        pull_request: { merged_at: MERGED_AT },
        headSha,
      })
    return { fake, bridge, queue, ref, stableId, path, head, merge, number }
  }

  it('removes the worktree only when the adapter reports the PR head equal to the worktree HEAD', async () => {
    const s = await githubSetup()
    // GitHub reports another head: the squash commit proves nothing about this branch.
    s.merge('f'.repeat(40))
    const mismatch = await s.bridge.intake(s.ref, { event: 'merged' })
    expect(mismatch.worktree.status).toBe('kept')
    expect(mismatch.worktree.reasons.join()).toMatch(/not merged into origin\/development/)
    expect(existsSync(s.path)).toBe(true)
    expect(notices(s.queue, s.stableId)).toHaveLength(1)
    // A pushed sha is never trusted: only what the adapter reads counts.
    const pushed = await s.bridge.intake(s.ref, { event: 'merged', pushed: { mergedHead: s.head } })
    expect(pushed.worktree.status).toBe('kept')
    expect(existsSync(s.path)).toBe(true)
    // The adapter reports the head that matches: removed, branch deleted.
    s.merge(s.head)
    const done = await s.bridge.cleanup(s.ref)
    expect(done.worktree).toMatchObject({ status: 'removed', branchDeleted: true })
    expect(existsSync(s.path)).toBe(false)
    expect(g(repo, 'branch', '--list', `work/github-${s.number}`)).toBe('')
  })

  it('keeps a squash-merged worktree when the item is not a merged pull request', async () => {
    const s = await githubSetup()
    // Closed without merging: the item is not merged, so nothing is cleaned up.
    s.merge(s.head)
    s.fake.editIssue(s.number, { pull_request: { merged_at: null } })
    expect(await s.bridge.cleanup(s.ref)).toMatchObject({ status: 'not-ready' })
    expect(existsSync(s.path)).toBe(true)
  })

  it('reconcile re-reads a merged pull request for its head and removes the matching worktree', async () => {
    const s = await githubSetup()
    s.merge(s.head)
    const report = await s.bridge.reconcile()
    expect(report.status).toBe('reconciled')
    expect(existsSync(s.path)).toBe(false)
    expect(g(repo, 'worktree', 'list', '--porcelain')).not.toContain(`github-${s.number}`)
  })
})
