import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  projectInputFromForm,
  projectRecord,
  workspaceRepositories,
} from '../cockpit-projects.mjs'
import { buildGoalBoard } from '../cockpit-read-model.mjs'
import { renderGoalBoard, renderProjectPreview, renderProjects } from '../cockpit-ui.mjs'

// #417: the cockpit stores one metadata record per project, with no checkout and no squad. Nothing
// is written before the person confirms the preview, and cancelling writes nothing. Execution
// control reads that record: without OpenRig, start and promote stay refused and notes still write.

const REPO = 'o/r'

// Records every call. Discovery may only read.
function fakeGitHub() {
  const calls = []
  const record =
    (name, value) =>
    (...args) => {
      calls.push(name)
      return value(...args)
    }
  return {
    calls,
    repo: record('repo', async (repo) => ({ full_name: repo, default_branch: 'development' })),
    issues: record('issues', async () => [{ number: 1 }, { number: 2, pull_request: {} }]),
    createIssue: record('createIssue', async () => ({ html_url: 'https://example.test/i/9' })),
    createIssueComment: record('createIssueComment', async () => ({
      html_url: 'https://example.test/i/1#c',
    })),
    updateIssue: record('updateIssue', async () => ({})),
  }
}

const storeDir = () => mkdtempSync(join(tmpdir(), 'cockpit-projects-'))

describe('the project record', () => {
  it('names the source adapter, the repository, and OpenRig or none', () => {
    expect(projectRecord({ repository: REPO })).toEqual({
      version: 1,
      sourceAdapter: 'github',
      repository: REPO,
      executionLayer: null,
    })
    expect(projectRecord({ repository: REPO, executionLayer: 'none' }).executionLayer).toBeNull()
    expect(
      projectRecord({
        repository: REPO,
        executionLayer: 'openrig',
        coordinators: { pm: 'pm-coordinator@product', dev: 'orch-arch@delivery' },
      }),
    ).toEqual({
      version: 1,
      sourceAdapter: 'github',
      repository: REPO,
      executionLayer: 'openrig',
      coordinators: { pm: 'pm-coordinator@product', dev: 'orch-arch@delivery' },
    })
  })

  it('stores no squad, no seat directory, and no seat but the two coordinators', () => {
    for (const extra of [
      { squad: ['dev.build', 'dev.qa'] },
      { seats: { qa: 'dev-qa@rig' } },
      { seatDirectory: {} },
      { rig: 'agentflow-dev' },
    ]) {
      expect(() =>
        projectRecord({ repository: REPO, executionLayer: 'openrig', ...extra }),
      ).toThrow(/stores no squad or seat/)
    }
    expect(() =>
      projectRecord({
        repository: REPO,
        executionLayer: 'openrig',
        coordinators: { pm: 'a@r', dev: 'b@r', qa: 'c@r' },
      }),
    ).toThrow(/Only the PM and DEV coordinators/)
    expect(() => projectRecord({ repository: REPO, coordinators: { pm: 'a@r' } })).toThrow(
      /no execution layer names no coordinator/,
    )
    expect(() =>
      projectRecord({ repository: REPO, executionLayer: 'openrig', coordinators: { pm: 'a b' } }),
    ).toThrow(/one session address/)
  })

  it('takes OpenRig as the only execution layer', () => {
    for (const executionLayer of ['pi', 'OpenRig', 'openrig ', 'claude', 1]) {
      expect(() => projectRecord({ repository: REPO, executionLayer })).toThrow(
        /not an execution layer/,
      )
    }
    for (const repository of ['', 'o', 'o/r/x', 'o r/x', '../etc', 'o/..', 'o/.', '-o/r']) {
      expect(() => projectRecord({ repository })).toThrow(/owner\/name/)
    }
  })

  it('reads the add-project form as the record input', () => {
    expect(
      projectRecord(
        projectInputFromForm({
          repository: ' o/r ',
          sourceAdapter: 'github',
          executionLayer: 'none',
          pmCoordinator: '',
          devCoordinator: '',
        }),
      ),
    ).toEqual({ version: 1, sourceAdapter: 'github', repository: REPO, executionLayer: null })
  })
})

describe('adding a project', () => {
  it('previews by reading the repository, and writes nothing', async () => {
    const client = fakeGitHub()
    const dir = storeDir()
    const store = createProjectStore({ dir })
    const preview = await previewProject({
      input: { repository: REPO, executionLayer: 'openrig', coordinators: { dev: 'orch@rig' } },
      client,
    })
    expect(preview).toMatchObject({
      supported: true,
      record: { repository: REPO, executionLayer: 'openrig', coordinators: { dev: 'orch@rig' } },
      discovered: { repository: REPO, defaultBranch: 'development', openItems: 1 },
    })
    expect(preview.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(client.calls).toEqual(['repo', 'issues'])
    expect(readdirSync(dir)).toEqual([])
    expect(store.list()).toEqual([])
  })

  it('writes nothing when the person cancels', async () => {
    const dir = storeDir()
    const store = createProjectStore({ dir })
    const preview = await previewProject({ input: { repository: REPO }, client: fakeGitHub() })
    const html = renderProjectPreview(preview, { csrfToken: 'token' })
    // Cancel is a link back to the projects page. It sends nothing to the store.
    expect(html).toContain('<a href="/projects">Cancel</a>')
    expect(html).toContain('<button type="submit">Confirm</button>')
    expect(html).toContain('action="/projects/confirm"')
    expect(existsSync(store.path)).toBe(false)
    expect(store.get(REPO)).toBeNull()
  })

  it('writes exactly the previewed record once the person confirms it', async () => {
    const dir = storeDir()
    const store = createProjectStore({ dir })
    const preview = await previewProject({ input: { repository: REPO }, client: fakeGitHub() })
    expect(store.confirm({ record: preview.record, digest: preview.digest })).toEqual(
      preview.record,
    )
    expect(store.get(REPO)).toEqual(preview.record)
    expect(readdirSync(dir)).toEqual(['projects.json'])
    expect(JSON.parse(readFileSync(store.path, 'utf8'))).toEqual({
      version: 1,
      projects: { [REPO]: preview.record },
    })
  })

  it('refuses a confirmation that is not the preview, and writes nothing', async () => {
    const store = createProjectStore({ dir: storeDir() })
    const preview = await previewProject({ input: { repository: REPO }, client: fakeGitHub() })
    const changed = { ...preview.record, executionLayer: 'openrig' }
    for (const confirmation of [
      { record: preview.record },
      { record: preview.record, digest: 'f'.repeat(64) },
      { record: changed, digest: preview.digest },
      { record: { ...preview.record, squad: ['dev.qa'] }, digest: preview.digest },
    ]) {
      expect(() => store.confirm(confirmation)).toThrow()
    }
    expect(existsSync(store.path)).toBe(false)
  })

  it('previews another source adapter as unsupported without reading it', async () => {
    const client = fakeGitHub()
    const preview = await previewProject({
      input: { repository: 'o/elsewhere', sourceAdapter: 'gitlab' },
      client,
    })
    expect(preview).toMatchObject({ supported: false, unsupported: 'gitlab is not supported' })
    expect(client.calls).toEqual([])
  })
})

describe('a stored project in the cockpit', () => {
  async function stored(input) {
    const store = createProjectStore({ dir: storeDir() })
    const preview = await previewProject({ input, client: fakeGitHub() })
    store.confirm({ record: preview.record, digest: preview.digest })
    return store
  }

  it('keeps execution control off without OpenRig, while notes still write', async () => {
    const store = await stored({ repository: REPO })
    for (const layer of [executionLayerOf(store.get(REPO)), executionLayerOf(store.get('x/y'))]) {
      expect(layer).toBeNull()
      expect(
        evaluateGuardedAction({
          action: 'start-next-phase',
          userRole: 'admin',
          confirmation: true,
          executionLayer: layer,
        }).reasons,
      ).toContain('no-execution-layer')
      const client = fakeGitHub()
      const start = parseCockpitIntent({ type: 'start-next-phase', repo: REPO, issue: 1 }).intent
      expect(
        await writeCockpitAction({ intent: start, client, repo: REPO, executionLayer: layer }),
      ).toEqual({ ok: false, errors: ['no-execution-layer'] })
      const note = parseCockpitIntent({
        type: 'add-clarification',
        repo: REPO,
        issue: 1,
        body: 'Context.',
      }).intent
      expect(
        (await writeCockpitAction({ intent: note, client, repo: REPO, executionLayer: layer })).ok,
      ).toBe(true)
      expect(client.calls).toEqual(['createIssueComment'])
    }
  })

  it('turns execution control on only when the record names OpenRig', async () => {
    const store = await stored({ repository: REPO, executionLayer: 'openrig' })
    const layer = executionLayerOf(store.get(REPO))
    expect(layer).toBe('openrig')
    expect(
      evaluateGuardedAction({
        action: 'start-next-phase',
        userRole: 'admin',
        confirmation: true,
        executionLayer: layer,
      }).ok,
    ).toBe(true)
  })

  it('uses no hand-edited record that adds a squad or a wrong layer', async () => {
    const store = await stored({ repository: REPO })
    const file = JSON.parse(readFileSync(store.path, 'utf8'))
    for (const edit of [
      { executionLayer: 'pi' },
      { squad: ['dev.build'] },
      { executionLayer: 'openrig', coordinators: { qa: 'qa@rig' } },
    ]) {
      writeFileSync(
        store.path,
        JSON.stringify({ ...file, projects: { [REPO]: { ...file.projects[REPO], ...edit } } }),
      )
      expect(store.get(REPO)).toBeNull()
      expect(store.list()).toEqual([])
      expect(executionLayerOf(store.get(REPO))).toBeNull()
    }
    // A record filed under another repository is not that repository's record.
    writeFileSync(
      store.path,
      JSON.stringify({
        ...file,
        projects: { 'x/y': { ...file.projects[REPO], executionLayer: 'openrig' } },
      }),
    )
    expect(store.get('x/y')).toBeNull()
    expect(store.list()).toEqual([])
    // An unreadable file shows no project, and a confirmation never overwrites it.
    writeFileSync(store.path, '{ not json')
    expect(store.list()).toEqual([])
    const preview = await previewProject({ input: { repository: 'a/b' }, client: fakeGitHub() })
    expect(() => store.confirm({ record: preview.record, digest: preview.digest })).toThrow()
    expect(readFileSync(store.path, 'utf8')).toBe('{ not json')
  })

  it('shows the project’s goals and its execution layer, with no checkout and no squad', async () => {
    const store = await stored({ repository: REPO, executionLayer: 'openrig' })
    await (async () => {
      const preview = await previewProject({
        input: { repository: 'o/elsewhere', sourceAdapter: 'gitlab' },
        client: fakeGitHub(),
      })
      store.confirm({ record: preview.record, digest: preview.digest })
    })()
    // Only the GitHub project is a workspace to supervise. The other shows as unsupported alone.
    expect(workspaceRepositories({ configured: ['a/b'], projects: store.list() })).toEqual([
      'a/b',
      REPO,
    ])
    const list = renderProjects({ projects: store.list(), writable: true })
    expect(list).toContain(`<a href="/?repo=${encodeURIComponent(REPO)}">${REPO}</a>`)
    expect(list).toContain('gitlab · unsupported')
    expect(list.match(/unsupported/g)).toHaveLength(1)
    expect(list).toContain('Execution layer: OpenRig')
    expect(list).toContain('Execution layer: none')
    expect(list).not.toMatch(/squad|seat/i)

    const board = buildGoalBoard({
      issues: [{ number: 7, title: 'A goal', body: 'Ship it.', labels: [], state: 'open' }],
      repo: REPO,
    })
    const html = renderGoalBoard(board, { repo: REPO, project: store.get(REPO) })
    expect(html).toContain('Execution layer: <strong>OpenRig</strong>')
    expect(html).toContain('A goal')
    expect(html).not.toMatch(/squad/i)
  })
})
