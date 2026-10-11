import { describe, expect, it } from 'vitest'
import {
  EXECUTION_INTENTS,
  evaluateGuardedAction,
  executionLayerOf,
  parseCockpitIntent,
  writeCockpitAction,
} from '../cockpit-actions.mjs'
import { loadCockpitConfig } from '../cockpit-config.mjs'
import { buildCockpitIssueView, buildGoalBoard } from '../cockpit-read-model.mjs'
import { renderGoalBoard, renderIssueView } from '../cockpit-ui.mjs'

// #411: with no execution layer the cockpit cannot start work, promote a phase, or dispatch a seat.
// A note that only records context still writes. Only the project's own metadata naming OpenRig
// brings execution control back, and the write switch that allows notes never does.

const REPO = 'o/r'
const NOTES = ['add-clarification', 'draft-follow-up', 'update-issue-section', 'post-handover']

// Records every write, so a test can show that a refusal wrote nothing.
function recordingClient() {
  const calls = []
  return {
    calls,
    async createIssueComment(repo, issue, body) {
      calls.push({ method: 'createIssueComment', repo, issue, body })
      return { html_url: `https://example.test/issues/${issue}#c${calls.length}` }
    },
    async createIssue(repo, issue) {
      calls.push({ method: 'createIssue', repo, ...issue })
      return { html_url: `https://example.test/issues/${100 + calls.length}` }
    },
  }
}

function intent(type, extra = {}) {
  const parsed = parseCockpitIntent({ type, repo: REPO, issue: 7, body: 'Context only.', ...extra })
  expect(parsed.ok, type).toBe(true)
  return parsed.intent
}

const issue = { number: 7, title: 'A goal', body: 'Ship it.', labels: [], state: 'open' }

describe('cockpit execution control without an execution layer', () => {
  it('reads an execution layer only from project metadata that names OpenRig', () => {
    for (const metadata of [
      null,
      undefined,
      {},
      { executionLayer: null },
      { executionLayer: 'none' },
      { executionLayer: 'pi' },
      { executionLayer: 'OpenRig ' },
      { executionLayer: ['openrig'] },
    ]) {
      expect(executionLayerOf(metadata), JSON.stringify(metadata)).toBeNull()
    }
    expect(executionLayerOf({ executionLayer: 'openrig' })).toBe('openrig')
  })

  it('refuses to start work or promote a phase, for any role and with confirmation', () => {
    expect(EXECUTION_INTENTS).toEqual(['start-next-phase', 'gate-transition'])
    for (const action of EXECUTION_INTENTS) {
      for (const executionLayer of [null, undefined, 'pi', 'none']) {
        const guard = evaluateGuardedAction({
          action,
          userRole: 'admin',
          confirmation: true,
          executionLayer,
        })
        expect(guard.ok, `${action} ${executionLayer}`).toBe(false)
        expect(guard.reasons).toContain('no-execution-layer')
      }
      expect(
        evaluateGuardedAction({ action, userRole: 'admin', confirmation: true }).reasons,
      ).toContain('no-execution-layer')
    }
  })

  it('writes nothing for a direct start or promote request', async () => {
    for (const type of EXECUTION_INTENTS) {
      const client = recordingClient()
      expect(await writeCockpitAction({ intent: intent(type), client, repo: REPO })).toEqual({
        ok: false,
        errors: ['no-execution-layer'],
      })
      expect(
        await writeCockpitAction({
          intent: intent(type),
          client,
          repo: REPO,
          executionLayer: 'pi',
        }),
      ).toMatchObject({ ok: false })
      expect(client.calls).toEqual([])
    }
  })

  it('still writes a clarification, a follow-up, a section update, and handover text', async () => {
    const config = loadCockpitConfig({ COCKPIT_WRITE_ACTIONS: 'true' })
    expect(config.writeActions).toBe(true)
    for (const type of NOTES) {
      expect(
        evaluateGuardedAction({ action: type, userRole: 'operator', confirmation: true }),
        type,
      ).toEqual({ ok: true, reasons: [] })
      const client = recordingClient()
      const written = await writeCockpitAction({ intent: intent(type), client, repo: REPO })
      expect(written.ok, type).toBe(true)
      expect(client.calls).toHaveLength(1)
      expect(client.calls[0]).toMatchObject(
        type === 'draft-follow-up'
          ? { method: 'createIssue', repo: REPO, title: 'Follow-up from #7' }
          : { method: 'createIssueComment', repo: REPO, issue: 7 },
      )
      expect(client.calls[0].body).toContain('Context only.')
    }
  })

  it('keeps notes on when the write switch is on and execution control is off', () => {
    const config = loadCockpitConfig({
      COCKPIT_WRITE_ACTIONS: 'true',
      AGENTFLOW_EXECUTION_LAYER: 'openrig',
      COCKPIT_EXECUTION_LAYER: 'openrig',
    })
    // The cockpit configuration has no execution switch: it cannot name an execution layer.
    expect(executionLayerOf(config)).toBeNull()
    expect(
      evaluateGuardedAction({
        action: 'add-clarification',
        userRole: 'operator',
        confirmation: true,
      }).ok,
    ).toBe(true)
    expect(
      evaluateGuardedAction({ action: 'start-next-phase', userRole: 'admin', confirmation: true })
        .ok,
    ).toBe(false)
  })

  it('shows no sign-off link and no transition form, while the note forms stay', () => {
    const board = buildGoalBoard({ issues: [issue], repo: REPO })
    const html = renderGoalBoard(board, {
      repo: REPO,
      view: 'goals',
      modal: 'gate-transition',
      modalGoal: board.goals[0],
      csrfToken: 'token',
    })
    expect(html).not.toContain('Gate Sign-off')
    expect(html).not.toContain('modal=gate-transition')
    expect(html).not.toContain('id="gate-transition"')
    expect(html).not.toContain('value="gate-transition"')
    expect(html).not.toContain('start-next-phase')

    const page = renderIssueView(buildCockpitIssueView({ issue, comments: [], repo: REPO }), {
      repo: REPO,
    })
    for (const type of ['add-clarification', 'draft-follow-up', 'post-handover']) {
      expect(page).toContain(`name="type" value="${type}"`)
    }
    expect(page).not.toMatch(/value="(start-next-phase|gate-transition)"/)
  })
})

describe('cockpit execution control when project metadata names OpenRig', () => {
  const executionLayer = executionLayerOf({ executionLayer: 'openrig' })

  it('lets the controls appear and the guard pass', async () => {
    for (const action of EXECUTION_INTENTS) {
      expect(
        evaluateGuardedAction({ action, userRole: 'admin', confirmation: true, executionLayer })
          .reasons,
      ).not.toContain('no-execution-layer')
    }
    const client = recordingClient()
    const written = await writeCockpitAction({
      intent: intent('start-next-phase'),
      client,
      repo: REPO,
      executionLayer,
    })
    expect(written.ok).toBe(true)
    expect(client.calls.map((call) => call.method)).toEqual(['createIssueComment'])

    const board = buildGoalBoard({ issues: [issue], repo: REPO })
    const html = renderGoalBoard(board, {
      repo: REPO,
      view: 'goals',
      modal: 'gate-transition',
      modalGoal: board.goals[0],
      executionLayer,
    })
    expect(html).toContain('Gate Sign-off')
    expect(html).toContain('id="gate-transition"')
  })
})
