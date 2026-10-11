import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  evaluateGuardedAction,
  executionLayerOf,
  parseCockpitIntent,
  writeCockpitAction,
} from '../cockpit-actions.mjs'
import {
  createProjectStore,
  previewProject,
  projectBinding,
  workspaceRepositories,
} from '../cockpit-projects.mjs'
import { buildGoalBoard } from '../cockpit-read-model.mjs'
import { renderGoalBoard, renderProjects, renderUnsupportedProject } from '../cockpit-ui.mjs'

// #419: one cockpit process holds many projects. Each reads its source adapter and execution layer
// from its own record, so two GitHub projects can be open together, one with OpenRig and one with
// none, and only the OpenRig project can start, promote, or dispatch. The other still takes notes.
// A project that names another adapter is unsupported, and only that project.

const OPENRIG = 'team/with-openrig'
const NONE = 'team/without-layer'
const ELSEWHERE = 'team/on-gitlab'
const CONFIGURED = 'team/configured-only'

// Records every call, so a test can show which project a write reached.
function recordingClient() {
  const calls = []
  return {
    calls,
    repo: async (repo) => ({ full_name: repo, default_branch: 'main' }),
    issues: async () => [],
    async createIssueComment(repo, issue, body) {
      calls.push({ method: 'createIssueComment', repo, issue, body })
      return { html_url: `https://example.test/${repo}/issues/${issue}#c` }
    },
    async createIssue(repo, issue) {
      calls.push({ method: 'createIssue', repo, ...issue })
      return { html_url: `https://example.test/${repo}/issues/9` }
    },
  }
}

// One store, as one cockpit process keeps it, holding three projects.
async function oneProcess() {
  const store = createProjectStore({ dir: mkdtempSync(join(tmpdir(), 'project-bindings-')) })
  for (const input of [
    { repository: OPENRIG, executionLayer: 'openrig', coordinators: { pm: 'pm@r', dev: 'dev@r' } },
    { repository: NONE },
    { repository: ELSEWHERE, sourceAdapter: 'gitlab', executionLayer: 'openrig' },
  ]) {
    const preview = await previewProject({ input, client: recordingClient() })
    store.confirm({ record: preview.record, digest: preview.digest })
  }
  const configured = [CONFIGURED]
  return { store, configured, binding: (repo) => projectBinding(repo, { store, configured }) }
}

const start = (repo) => parseCockpitIntent({ type: 'start-next-phase', repo, issue: 1 }).intent
const promote = (repo) => parseCockpitIntent({ type: 'gate-transition', repo, issue: 1 }).intent
const note = (repo) =>
  parseCockpitIntent({ type: 'add-clarification', repo, issue: 1, body: 'Context.' }).intent

describe('project bindings in one cockpit process', () => {
  it('binds each project to its own adapter and execution layer', async () => {
    const { binding } = await oneProcess()
    expect(binding(OPENRIG)).toMatchObject({
      sourceAdapter: 'github',
      supported: true,
      executionLayer: 'openrig',
    })
    expect(binding(NONE)).toMatchObject({
      sourceAdapter: 'github',
      supported: true,
      executionLayer: null,
    })
    // A configured repository with no record is a GitHub project with no execution layer.
    expect(binding(CONFIGURED)).toMatchObject({
      sourceAdapter: 'github',
      supported: true,
      executionLayer: null,
      record: null,
    })
    // An unsupported adapter has no execution layer, whatever its record names.
    expect(binding(ELSEWHERE)).toMatchObject({
      sourceAdapter: 'gitlab',
      supported: false,
      executionLayer: null,
    })
    expect(binding('team/unknown')).toBeNull()
  })

  it('starts and promotes only for the OpenRig project, and writes nothing for the other', async () => {
    const { binding } = await oneProcess()
    const client = recordingClient()
    // Interleave the two projects, so neither one's posture can carry over to the other.
    for (const repo of [NONE, OPENRIG, NONE, OPENRIG]) {
      const executionLayer = executionLayerOf(binding(repo))
      for (const intent of [start(repo), promote(repo)]) {
        const guard = evaluateGuardedAction({
          action: intent.type,
          userRole: 'admin',
          confirmation: true,
          executionLayer,
        })
        const written = await writeCockpitAction({ intent, client, repo, executionLayer })
        if (repo === OPENRIG) {
          expect(guard.reasons).not.toContain('no-execution-layer')
          expect(written.ok).toBe(true)
        } else {
          expect(guard.reasons).toContain('no-execution-layer')
          expect(written).toEqual({ ok: false, errors: ['no-execution-layer'] })
        }
      }
    }
    // Every execution write reached the OpenRig project, and none reached the other.
    expect(client.calls).toHaveLength(4)
    expect(new Set(client.calls.map((call) => call.repo))).toEqual(new Set([OPENRIG]))
  })

  it('still takes notes on the project with no execution layer', async () => {
    const { binding } = await oneProcess()
    for (const repo of [NONE, CONFIGURED, OPENRIG]) {
      const client = recordingClient()
      const executionLayer = executionLayerOf(binding(repo))
      expect(
        evaluateGuardedAction({
          action: 'add-clarification',
          userRole: 'operator',
          confirmation: true,
          executionLayer,
        }).ok,
      ).toBe(true)
      expect(
        (await writeCockpitAction({ intent: note(repo), client, repo, executionLayer })).ok,
      ).toBe(true)
      expect(client.calls).toEqual([
        expect.objectContaining({ method: 'createIssueComment', repo }),
      ])
    }
  })

  it('marks only the other-adapter project unsupported, and keeps the rest working', async () => {
    const { store, configured, binding } = await oneProcess()
    expect(workspaceRepositories({ configured, projects: store.list() })).toEqual([
      CONFIGURED,
      OPENRIG,
      NONE,
    ])
    // A configured repository whose record names another adapter is not read through GitHub.
    expect(
      workspaceRepositories({ configured: [CONFIGURED, ELSEWHERE], projects: store.list() }),
    ).toEqual([CONFIGURED, OPENRIG, NONE])

    const list = renderProjects({ projects: store.list() })
    expect(list.match(/unsupported/g)).toHaveLength(1)
    expect(list).toContain('gitlab · unsupported')
    const page = renderUnsupportedProject(binding(ELSEWHERE))
    expect(page).toContain(ELSEWHERE)
    expect(page).toContain('<strong>gitlab</strong> is not supported')
    expect(page).not.toContain(OPENRIG)
    expect(page).not.toContain(NONE)

    const board = (repo) =>
      renderGoalBoard(
        buildGoalBoard({
          issues: [
            { number: 1, title: `Goal in ${repo}`, body: 'Ship.', labels: [], state: 'open' },
          ],
          repo,
        }),
        { repo, project: binding(repo).record, executionLayer: binding(repo).executionLayer },
      )
    expect(board(OPENRIG)).toContain('Execution layer: <strong>OpenRig</strong>')
    expect(board(OPENRIG)).toContain('Gate Sign-off')
    expect(board(NONE)).toContain('Execution layer: <strong>none</strong>')
    expect(board(NONE)).not.toContain('Gate Sign-off')
    for (const repo of [OPENRIG, NONE]) expect(board(repo)).not.toMatch(/squad/i)
  })
})
