import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROCESS_STATES,
  RETIRED_STATUS_LABELS,
  buildBoard,
  projectProcessState,
  validateProcessStateVocabulary,
} from '../core/process-state.mjs'
import { validateExtensionPack } from '../extension-packs.mjs'
import { loadSdlcConfig, validateSdlcConfigShape } from '../sdlc-state.mjs'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { main as board, planBackfill, githubItems } from '../../scripts/process-board.mjs'
import { planIntegrationLifecycle } from '../../scripts/integration-lifecycle.mjs'

const SEATS = {
  0: 'pm.manager',
  1: 'pm.analyst',
  2: 'orch.arch',
  3: 'orch.arch',
  4: 'dev.build',
  5: 'dev.qa',
  6: 'rev.review',
  7: 'orch.arch',
  8: 'orch.arch',
}

const pass = (phase) => ({ phase, status: 'pass' })
const skip = (phase, reason) => ({ phase, status: 'skipped', reason })
const through = (last) => Array.from({ length: last + 1 }, (_, phase) => pass(phase))

// Every row of the phase 1 projection table, as transition sequences a medium accepts.
const ROWS = [
  { name: 'no transition', steps: [], state: 'backlog' },
  { name: 'phase 0 pass', steps: [pass(0)], state: 'backlog' },
  { name: 'phase 0 skip', steps: [skip(0, 'The request is the goal.')], state: 'backlog' },
  { name: 'phase 1 pass', steps: through(1), state: 'readiness' },
  { name: 'phase 2 pass', steps: through(2), state: 'wip' },
  {
    name: 'return to phase 1',
    steps: [...through(1), skip(2, 'Spec defect. Return to phase 1.')],
    state: 'backlog',
  },
  {
    name: 'return to phase 3',
    steps: [...through(3), skip(4, 'Plan defect. Return to phase 3.')],
    state: 'wip',
  },
  { name: 'phase 8 pass, not integrated', steps: through(8), state: 'wip' },
  { name: 'integration fact', steps: through(8), integrated: true, state: 'delivered' },
  { name: 'integrated before phase 8', steps: through(4), integrated: true, state: 'delivered' },
]

function applied(steps) {
  return steps.map((step) => ({ ...step, seat: SEATS[step.phase], reason: step.reason ?? null }))
}

function fakeGitHub() {
  const issues = new Map()
  const comments = new Map()
  const writes = []
  const client = {
    writes,
    store: issues,
    seed(issue) {
      issues.set(issue.number, { labels: [], state: 'open', comments: 0, ...issue })
      comments.set(issue.number, comments.get(issue.number) ?? [])
    },
    async createIssue(_repo, { title, body }) {
      const number = issues.size + 1
      this.seed({ number, title, body, html_url: `https://example.test/issues/${number}` })
      return issues.get(number)
    },
    async issue(_repo, number) {
      return structuredClone(issues.get(number))
    },
    async issueComments(_repo, number) {
      return comments.get(number)
    },
    async createIssueComment(_repo, number, body) {
      const list = comments.get(number)
      const comment = { body, html_url: `https://example.test/issues/${number}#c${list.length}` }
      list.push(comment)
      issues.get(number).comments = list.length
      return comment
    },
    async addLabels(_repo, number, labels) {
      writes.push(['add', number, labels])
      const issue = issues.get(number)
      issue.labels = [...issue.labels, ...labels.map((name) => ({ name }))]
    },
    async removeLabel(_repo, number, label) {
      writes.push(['remove', number, label])
      const issue = issues.get(number)
      issue.labels = issue.labels.filter((item) => item.name !== label)
    },
    async pullRequests() {
      return []
    },
  }
  client.issues = async (_repo, { page = 1 } = {}) => (page === 1 ? [...issues.values()] : [])
  return client
}

const labelsOf = (issue) => issue.labels.map((label) => label.name)

async function onFilesystem(row) {
  const medium = createFilesystemMedium({ root: mkdtempSync(join(tmpdir(), 'process-state-')) })
  await medium.createGoal({ title: row.name })
  for (const [index, step] of applied(row.steps).entries()) {
    await medium.appendTransition({ ...step, idempotencyKey: `k${index}` })
  }
  if (row.integrated) await medium.recordIntegration({ line: 'development', ref: 'abc123' })
  return medium.readGoal()
}

async function onGitHub(row, client = fakeGitHub()) {
  const medium = createGitHubMedium({ repo: 'o/r', client })
  const created = await medium.createGoal({ title: row.name })
  for (const [index, step] of applied(row.steps).entries()) {
    await medium.appendTransition({ ...step, idempotencyKey: `k${index}` })
  }
  if (row.integrated) {
    await client.addLabels('o/r', created.number, ['integrated:development'])
    await medium.syncProcessState()
  }
  return { goal: await medium.readGoal(), issue: await client.issue('o/r', created.number) }
}

describe('process-state projection (AC1-AC4)', () => {
  it.each(ROWS)('maps $name to $state', ({ steps, integrated, state }) => {
    expect(
      projectProcessState({
        transitions: applied(steps),
        integration: integrated ? { line: 'development' } : null,
      }),
    ).toBe(state)
  })

  it('returns only the four names, or no state for closed work without the fact', () => {
    const ids = PROCESS_STATES.map((item) => item.id)
    for (const row of ROWS) {
      expect(ids).toContain(projectProcessState({ transitions: applied(row.steps) }))
    }
    expect(projectProcessState({ transitions: applied(through(8)), closed: true })).toBeNull()
    expect(projectProcessState({ closed: true, integration: { line: 'main' } })).toBe('delivered')
  })

  it('never treats phase 8, release labels, or a closed flag as Readiness or Delivered', async () => {
    const { issue } = await onGitHub({ name: 'phase 8', steps: through(8) })
    expect(labelsOf(issue)).toEqual(['state:wip'])
    const client = fakeGitHub()
    client.seed({
      number: 7,
      title: 'old',
      labels: [{ name: 'status:v1-ready' }, { name: 'awaiting-release' }],
    })
    const item = (await githubItems(client, 'o/r', { branches: ['development'] }))[0]
    expect(projectProcessState(item)).toBe('backlog')
  })

  it('moves a returned item back, then forward again (AC3)', async () => {
    const medium = createFilesystemMedium({ root: mkdtempSync(join(tmpdir(), 'process-return-')) })
    await medium.createGoal({ title: 'returned' })
    for (const [index, step] of applied(through(3)).entries()) {
      await medium.appendTransition({ ...step, idempotencyKey: `k${index}` })
    }
    expect((await medium.readGoal()).processState).toBe('wip')
    await medium.appendTransition({
      ...applied([skip(4, 'Builder found a spec defect. Return to phase 1.')])[0],
      idempotencyKey: 'return',
    })
    expect((await medium.readGoal()).processState).toBe('backlog')
    await medium.appendTransition({ ...applied([pass(1)])[0], idempotencyKey: 'again' })
    expect((await medium.readGoal()).processState).toBe('readiness')
  })
})

describe('the same state on every medium (AC5, AC7)', () => {
  it.each(ROWS)('agrees on $name', async (row) => {
    const filesystem = await onFilesystem(row)
    const { goal, issue } = await onGitHub(row)
    expect(filesystem.processState).toBe(row.state)
    expect(goal.processState).toBe(row.state)
    // The GitHub issue shows exactly one marker, and it equals the projection.
    expect(labelsOf(issue).filter((name) => name.startsWith('state:'))).toEqual([
      `state:${row.state}`,
    ])
  })

  it('replaces the marker when the projection changes and removes retired markers', async () => {
    const client = fakeGitHub()
    const medium = createGitHubMedium({ repo: 'o/r', client })
    const created = await medium.createGoal({ title: 'moving' })
    await client.addLabels('o/r', created.number, ['status:in-progress', 'bug'])
    const before = client.writes.length
    for (const [index, step] of applied(through(1)).entries()) {
      await medium.appendTransition({ ...step, idempotencyKey: `k${index}` })
    }
    expect(labelsOf(await client.issue('o/r', created.number)).sort()).toEqual([
      'bug',
      'state:readiness',
    ])
    const added = client.writes
      .slice(before)
      .filter(([kind]) => kind === 'add')
      .flatMap(([, , labels]) => labels)
    expect(added).toEqual(['state:readiness'])
  })

  it('repairs the state label on a duplicate retry after a failed label write', async () => {
    const client = fakeGitHub()
    const medium = createGitHubMedium({ repo: 'o/r', client })
    const created = await medium.createGoal({ title: 'retried' })
    await medium.appendTransition({ ...applied([pass(0)])[0], idempotencyKey: 'k0' })
    const addLabels = client.addLabels
    let failures = 1
    client.addLabels = async (...args) => {
      if (failures-- > 0) throw new Error('GitHub API request failed: 502')
      return addLabels.apply(client, args)
    }
    const step = { ...applied([pass(1)])[0], idempotencyKey: 'k1' }
    await expect(medium.appendTransition(step)).rejects.toThrow(/502/)
    expect(labelsOf(await client.issue('o/r', created.number))).toEqual([])
    const comments = (await client.issueComments('o/r', created.number)).length
    const retry = await medium.appendTransition(step)
    expect(retry.duplicate).toBe(true)
    expect(retry.goal.processState).toBe('readiness')
    expect(labelsOf(await client.issue('o/r', created.number))).toEqual(['state:readiness'])
    expect((await client.issueComments('o/r', created.number)).length).toBe(comments)
  })

  it('records the filesystem integration fact beside the goal, not as a transition', async () => {
    const root = mkdtempSync(join(tmpdir(), 'process-integration-'))
    const medium = createFilesystemMedium({ root })
    await medium.createGoal({ title: 'shipped' })
    const goal = await medium.recordIntegration({ line: 'development', ref: 'abc123' })
    expect(goal.transitions).toEqual([])
    expect(goal.processState).toBe('delivered')
    expect(JSON.parse(readFileSync(join(root, 'integration.json'), 'utf8'))).toMatchObject({
      line: 'development',
      ref: 'abc123',
    })
    await expect(medium.recordIntegration({ line: ' ' })).rejects.toThrow(/integration line/)
  })
})

function captured() {
  let text = ''
  return { write: (chunk) => (text += chunk), text: () => text }
}

describe('the board (AC6, AC12, AC13)', () => {
  it('shows a filesystem root in four ordered groups with no manual step', async () => {
    const root = mkdtempSync(join(tmpdir(), 'process-board-'))
    const rows = [ROWS[1], ROWS[3], ROWS[4], ROWS[8]]
    for (const [index, row] of rows.entries()) {
      const dir = join(root, `goal-${index}`)
      mkdirSync(dir)
      const medium = createFilesystemMedium({ root: dir })
      await medium.createGoal({ title: row.name })
      for (const [key, step] of applied(row.steps).entries()) {
        await medium.appendTransition({ ...step, idempotencyKey: `k${key}` })
      }
      if (row.integrated) await medium.recordIntegration({ line: 'development' })
    }
    const out = captured()
    await board(['--medium', 'filesystem', '--root', root, '--json'], { stdout: out })
    const json = JSON.parse(out.text())
    expect(json.groups.map((group) => group.state)).toEqual([
      'Backlog',
      'Readiness',
      'WIP',
      'Delivered',
    ])
    expect(json.groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['goal-0'],
      ['goal-1'],
      ['goal-2'],
      ['goal-3'],
    ])
    expect(json.excludedCount).toBe(0)
    const text = captured()
    await board(['--medium', 'filesystem', '--root', root], { stdout: text })
    expect(text.text()).toMatch(
      /^Backlog \(1\)[\s\S]*Readiness \(1\)[\s\S]*WIP \(1\)[\s\S]*Delivered \(1\)/,
    )
  })

  it('leaves closed work without the fact off the board as a count, with its close reason', async () => {
    const client = fakeGitHub()
    client.seed({ number: 1, title: 'open, no labels' })
    client.seed({
      number: 2,
      title: 'integrated',
      state: 'closed',
      state_reason: 'completed',
      labels: [{ name: 'integrated:development' }],
    })
    client.seed({
      number: 3,
      title: 'not planned',
      state: 'closed',
      state_reason: 'not_planned',
      labels: [{ name: 'status:backlog' }],
    })
    client.seed({
      number: 4,
      title: 'merged elsewhere',
      state: 'closed',
      state_reason: 'completed',
    })
    client.seed({ number: 5, title: 'no evidence', state: 'closed', state_reason: 'completed' })
    client.pullRequests = async (_repo, { base, page }) =>
      base === 'main' && page === 1
        ? [
            {
              merged_at: '2026-10-01T00:00:00Z',
              body: 'Closes #4',
              html_url: 'https://example.test/pull/9',
            },
          ]
        : []
    const out = captured()
    await board(['--medium', 'github', '--repo', 'o/r', '--json'], { client, stdout: out })
    const json = JSON.parse(out.text())
    expect(json.groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['#1'],
      [],
      [],
      ['#2', '#4'],
    ])
    expect(json.groups).toHaveLength(4)
    expect(json.excludedCount).toBe(2)
    expect(json.excluded).toEqual([
      expect.objectContaining({ id: '#3', state: null, closeReason: 'not_planned' }),
      expect.objectContaining({ id: '#5', state: null, closeReason: 'completed' }),
    ])
  })
})

describe('backfill (AC9-AC11)', () => {
  function repository() {
    const client = fakeGitHub()
    client.seed({ number: 1, title: 'legacy open', labels: [{ name: 'status:in-progress' }] })
    client.seed({
      number: 2,
      title: 'integrated',
      state: 'closed',
      state_reason: 'completed',
      labels: [{ name: 'integrated:development' }, { name: 'status:backlog' }],
    })
    client.seed({
      number: 3,
      title: 'unproven',
      state: 'closed',
      state_reason: 'completed',
      labels: [{ name: 'status:in-progress' }],
    })
    client.seed({ number: 4, title: 'dropped', state: 'closed', state_reason: 'not_planned' })
    client.seed({ number: 5, title: 'merged', state: 'closed', state_reason: 'completed' })
    client.pullRequests = async (_repo, { base, page }) =>
      base === 'development' && page === 1
        ? [{ merged_at: '2026-10-01T00:00:00Z', body: 'Implements #5', html_url: 'u' }]
        : []
    return client
  }

  it('writes nothing on a dry run and reports what needs a human decision', async () => {
    const client = repository()
    const out = captured()
    await board(['backfill', '--medium', 'github', '--repo', 'o/r', '--json'], {
      client,
      stdout: out,
    })
    expect(client.writes).toEqual([])
    const plan = JSON.parse(out.text())
    expect(plan.applied).toBe(false)
    expect(plan.changes).toEqual([
      { number: 1, state: 'backlog', add: ['state:backlog'], remove: ['status:in-progress'] },
      { number: 2, state: 'delivered', add: ['state:delivered'], remove: ['status:backlog'] },
      { number: 3, state: null, add: [], remove: ['status:in-progress'] },
      {
        number: 5,
        state: 'delivered',
        add: ['state:delivered', 'integrated:development'],
        remove: [],
      },
    ])
    expect(plan.correction).toEqual([
      expect.objectContaining({ number: 3, closeReason: 'completed', needsDecision: true }),
      expect.objectContaining({ number: 4, closeReason: 'not_planned', needsDecision: false }),
    ])
  })

  it('applies only with --apply, and never writes a retired marker', async () => {
    const client = repository()
    await board(['backfill', '--medium', 'github', '--repo', 'o/r', '--apply'], {
      client,
      stdout: captured(),
    })
    const after = Object.fromEntries(
      [1, 2, 3, 4, 5].map((number) => [number, labelsOf(client.store.get(number))]),
    )
    expect(after).toEqual({
      1: ['state:backlog'],
      2: ['integrated:development', 'state:delivered'],
      3: [],
      4: [],
      5: ['state:delivered', 'integrated:development'],
    })
    const added = client.writes.filter(([kind]) => kind === 'add').flatMap(([, , labels]) => labels)
    expect(added.some((label) => RETIRED_STATUS_LABELS.includes(label))).toBe(false)
    // The single-issue read now agrees with the board, with no pull-request scan.
    expect(planBackfill(await githubItems(client, 'o/r', { branches: [] })).changes).toEqual([])
    const merged = await createGitHubMedium({ repo: 'o/r', number: 5, client }).readGoal()
    expect(merged.processState).toBe('delivered')
  })

  it('makes the integration lifecycle mark Delivered and clear other markers', () => {
    const plan = planIntegrationLifecycle(
      { merged: true, baseRefName: 'development', body: 'Implements #9', number: 10, url: 'u' },
      {
        integrationBranch: 'development',
        trunkBranch: 'main',
        addLabels: ['integrated:development'],
        closeIntegratedIssues: true,
        referenceKeywords: ['Implements'],
      },
    )
    expect(plan.labels).toContain('state:delivered')
    expect(plan.labels.some((label) => RETIRED_STATUS_LABELS.includes(label))).toBe(false)
    expect(plan.removeLabels).toEqual(
      expect.arrayContaining(['state:wip', ...RETIRED_STATUS_LABELS]),
    )
  })

  it('documents the four states as the only progress vocabulary', () => {
    expect(loadSdlcConfig().labels.progress).toEqual(PROCESS_STATES.map((state) => state.label))
    const standards = readFileSync(
      new URL('../../docs/issue-standards.md', import.meta.url),
      'utf8',
    )
    for (const state of PROCESS_STATES) expect(standards).toContain(`\`${state.label}\``)
    expect(standards).not.toMatch(/Apply it when implementation actually starts/)
  })
})

describe('a fixed vocabulary (AC8)', () => {
  function pack(manifest) {
    const dir = mkdtempSync(join(tmpdir(), 'state-pack-'))
    writeFileSync(join(dir, 'README.md'), '# Pack\n')
    writeFileSync(join(dir, 'principles.md'), '# Principles\n')
    return {
      dir,
      relativeDir: 'extensions/state-pack',
      manifest: {
        id: 'state-pack',
        kind: 'engineering-approach',
        version: '0.1.0',
        description: 'A pack.',
        principles: 'principles.md',
        documentation: ['README.md'],
        ...manifest,
      },
    }
  }
  const options = { sdlcConfig: loadSdlcConfig() }
  const stateErrors = (result) => result.errors.filter((error) => /process state/.test(error))

  it('rejects a pack that adds or renames a state, naming the four', () => {
    for (const manifest of [
      { processStates: ['backlog', 'readiness', 'wip', 'delivered', 'blocked'] },
      { processStates: ['backlog', 'ready', 'wip', 'delivered'] },
      { labels: ['product:core', 'state:blocked'] },
    ]) {
      const errors = stateErrors(validateExtensionPack(pack(manifest), options))
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('Backlog, Readiness, WIP, Delivered')
    }
  })

  it('still loads type, provenance, routing, product-area, and release labels from a pack', () => {
    const labels = {
      type: ['feature'],
      provenance: ['drafted-by:claude'],
      routing: ['for-implementation:codex'],
      product: ['product:core'],
      release: ['awaiting-release', 'release:1.5.0'],
    }
    expect(stateErrors(validateExtensionPack(pack({ labels }), options))).toEqual([])
    expect(
      stateErrors(
        validateExtensionPack(
          pack({ processStates: ['wip', 'delivered', 'backlog', 'readiness'] }),
          options,
        ),
      ),
    ).toEqual([])
  })

  it('rejects an adopter profile that adds or renames a state', () => {
    const config = loadSdlcConfig()
    expect(validateSdlcConfigShape(config).ok).toBe(true)
    for (const change of [
      { labels: { ...config.labels, progress: [...config.labels.progress, 'state:blocked'] } },
      {
        labels: {
          ...config.labels,
          progress: ['state:todo', 'state:readiness', 'state:wip', 'state:delivered'],
        },
      },
      { labels: { ...config.labels, release: ['awaiting-release', 'state:shipped'] } },
      { processStates: ['Backlog', 'Ready', 'WIP', 'Delivered'] },
    ]) {
      const result = validateSdlcConfigShape({ ...config, ...change })
      expect(result.ok).toBe(false)
      expect(result.findings.find((item) => item.severity === 'blocker').message).toContain(
        'Backlog, Readiness, WIP, Delivered',
      )
    }
    const legacy = validateSdlcConfigShape({
      ...config,
      labels: { ...config.labels, progress: ['status:in-progress'] },
    })
    expect(legacy.findings).toEqual([
      expect.objectContaining({ code: 'config.labels.progress', severity: 'medium' }),
    ])
  })

  it('accepts the four states in any case or label form', () => {
    expect(
      validateProcessStateVocabulary(['Backlog', 'state:readiness', 'WIP', 'delivered']).ok,
    ).toBe(true)
    expect(buildBoard([]).groups.map((group) => group.name)).toEqual([
      'Backlog',
      'Readiness',
      'WIP',
      'Delivered',
    ])
  })
})
