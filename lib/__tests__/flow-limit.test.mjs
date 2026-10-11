import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allowedNext, currentPhase } from '../core/phase-graph.mjs'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { main } from '../../scripts/person-gates.mjs'

// #385: the confirmation line answers a gate and nothing else. Filing an accepted line leaves the
// phase record as it was, promotes no phase, and dispatches no seat.

const AT = '2026-10-11T18:30:00.000Z'
const SEAT_ENV = Object.freeze({ CLAUDECODE: '1' })
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../bin/cli.mjs')

// Records every call, so a test can show which ones filing made.
function fakeGitHub() {
  const issues = new Map()
  const comments = new Map()
  const calls = []
  const client = {
    store: issues,
    async createIssue(_repo, { title, body }) {
      const number = issues.size + 1
      issues.set(number, {
        number,
        title,
        body,
        state: 'open',
        html_url: `https://example.test/issues/${number}`,
        updated_at: AT,
      })
      comments.set(number, [])
      return structuredClone(issues.get(number))
    },
    async issue(_repo, number) {
      return structuredClone(issues.get(number))
    },
    async updateIssue(_repo, number, { body }) {
      issues.get(number).body = body
      return structuredClone(issues.get(number))
    },
    async issueComments(_repo, number) {
      return structuredClone(comments.get(number))
    },
    async createIssueComment(_repo, number, body) {
      const comment = {
        id: comments.get(number).length + 1,
        body,
        html_url: `https://example.test/issues/${number}#c${comments.get(number).length + 1}`,
        created_at: AT,
      }
      comments.get(number).push(comment)
      return structuredClone(comment)
    },
  }
  return {
    calls,
    client: new Proxy(client, {
      get(target, name) {
        const value = target[name]
        if (typeof value !== 'function') return value
        return (...args) => {
          calls.push(name)
          return value(...args)
        }
      },
    }),
  }
}

async function item(kind) {
  if (kind === 'filesystem') {
    const root = mkdtempSync(join(tmpdir(), 'flow-limit-'))
    await createFilesystemMedium({ root }).createGoal({ title: 'A goal', body: 'Ship it.' })
    return {
      root,
      args: ['--medium', 'filesystem', '--root', root],
      medium: () => createFilesystemMedium({ root }),
    }
  }
  const github = fakeGitHub()
  const created = await createGitHubMedium({ repo: 'o/r', client: github.client }).createGoal({
    title: 'A goal',
    body: 'Ship it.',
  })
  return {
    github,
    args: ['--medium', 'github', '--repo', 'o/r', '--issue', String(created.number)],
    client: github.client,
    medium: () =>
      createGitHubMedium({ repo: 'o/r', number: created.number, client: github.client }),
  }
}

async function run(target, argv, env = SEAT_ENV) {
  let text = ''
  await main([argv[0], ...target.args, ...argv.slice(1)], {
    client: target.client,
    stdout: { write: (chunk) => (text += chunk) },
    env,
    now: () => AT,
  })
  return JSON.parse(text)
}

function messageFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-limit-message-')), 'message.txt')
  writeFileSync(path, text)
  return path
}

// Phases 0 to 3 are recorded, so phase 4 is next. A goal gate then waits for the person.
async function waitingAtPhase4(target) {
  const medium = target.medium()
  for (const [phase, seat] of [
    [0, 'pm.manager'],
    [1, 'pm.analyst'],
    [2, 'orch.arch'],
    [3, 'orch.arch'],
  ]) {
    await medium.appendTransition({
      phase,
      status: phase === 0 ? 'skipped' : 'pass',
      seat,
      reason: phase === 0 ? 'framed' : null,
      idempotencyKey: `p${phase}`,
    })
  }
  const { gate } = await run(
    target,
    ['open', '--class', 'adequacy-of-intent', '--role', 'person'],
    {},
  )
  return gate
}

function phaseRecord(goal) {
  return {
    transitions: goal.transitions,
    currentPhase: currentPhase(goal.transitions),
    allowedNext: allowedNext(goal.transitions),
  }
}

describe.each(['filesystem', 'github'])('the flow limit on the %s medium', (kind) => {
  it('files an accepted line without changing the phase record or promoting a phase', async () => {
    for (const word of ['agree', 'changes', 'block']) {
      const target = await item(kind)
      const gate = await waitingAtPhase4(target)
      const before = phaseRecord(await target.medium().readGoal())
      expect(before.currentPhase).toBe(3)
      expect(before.allowedNext).toContain(4)
      target.github?.calls.splice(0)

      const line = `${word} ${gate.digest.slice(0, 12)} as Sam`
      const filed = await run(target, [
        'file',
        '--line',
        line,
        '--message-file',
        messageFile(line),
        '--seat',
        'dev.build',
      ])
      expect(filed.gates.gates[0].answer).toMatchObject({ line })
      // The result names no next phase, no next seat, and nothing to deliver.
      expect(Object.keys(filed).sort()).toEqual(['attestation', 'filing', 'gates', 'goal'])
      expect(JSON.stringify(filed)).not.toMatch(/queueBody|delivery|Next (phase|seat)/)

      const after = await target.medium().readGoal()
      expect(phaseRecord(after)).toEqual(before)
      // On GitHub filing rewrites the gate block in the issue body and posts no phase comment.
      if (target.github) {
        expect(target.github.calls).not.toContain('createIssueComment')
        expect(new Set(target.github.calls)).toEqual(
          new Set(['issue', 'issueComments', 'updateIssue']),
        )
      }
    }
  })
})

describe('the flow limit through the product CLI', () => {
  it('dispatches no seat: filing calls no rig, gh, or agentflow command', async () => {
    const target = await item('filesystem')
    const gate = await waitingAtPhase4(target)
    const before = phaseRecord(await target.medium().readGoal())

    // Only fake commands are on PATH. Each one records that it was called and fails.
    const bin = mkdtempSync(join(tmpdir(), 'flow-limit-bin-'))
    const calls = join(bin, 'calls.log')
    for (const name of ['rig', 'gh', 'agentflow-sdlc', 'git', 'tmux']) {
      const path = join(bin, name)
      writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${calls}"\nexit 1\n`)
      chmodSync(path, 0o755)
    }
    const line = `agree ${gate.digest.slice(0, 12)} as Sam`
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        'gates',
        'file',
        ...target.args,
        '--line',
        line,
        '--message-file',
        messageFile(line),
        '--seat',
        'dev.build',
        '--json',
      ],
      {
        encoding: 'utf8',
        env: { PATH: bin, HOME: mkdtempSync(join(tmpdir(), 'flow-limit-home-')), CLAUDECODE: '1' },
      },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(calls) ? readFileSync(calls, 'utf8') : '').toBe('')

    const after = await target.medium().readGoal()
    expect(after.gates.gates[0]).toMatchObject({ status: 'agreed', satisfied: true })
    expect(phaseRecord(after)).toEqual(before)
  })
})
