import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFilesystemMedium } from '../sources/filesystem-medium.mjs'
import { createGitHubMedium } from '../sources/github-medium.mjs'
import { main } from '../../scripts/phase-handoff.mjs'

describe('filesystem medium', () => {
  it('advances a transition without the filesystem medium importing GitHub', async () => {
    const source = readFileSync(
      new URL('../sources/filesystem-medium.mjs', import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(/github/i)
    const root = mkdtempSync(join(tmpdir(), 'phase-medium-'))
    const medium = createFilesystemMedium({ root })
    await medium.createGoal({ title: 'Replace the badge', body: 'The request.' })
    const first = await medium.appendTransition({
      phase: 0,
      status: 'skipped',
      seat: 'orch.arch',
      reason: 'The human request is already the goal.',
      body: 'Skipped framing.',
      idempotencyKey: 'goal-1-phase-0',
    })
    const again = await medium.appendTransition({
      phase: 0,
      status: 'skipped',
      seat: 'orch.arch',
      reason: 'The human request is already the goal.',
      idempotencyKey: 'goal-1-phase-0',
    })
    expect(again.duplicate).toBe(true)
    expect(again.transition.uri).toBe(first.transition.uri)
    await expect(
      medium.appendTransition({
        phase: 4,
        status: 'pass',
        seat: 'dev.build',
        idempotencyKey: 'too-soon',
      }),
    ).rejects.toThrow(/not allowed/)
    const goal = await medium.readGoal()
    expect(goal.system).toBe('filesystem')
    expect(goal.transitions).toHaveLength(1)
  })
})

describe('github medium', () => {
  it('creates a goal and appends one comment through the client', async () => {
    const issues = new Map()
    const comments = []
    let number = 0
    const client = {
      async createIssue(_repo, body) {
        number += 1
        const issue = {
          number,
          title: body.title,
          body: body.body,
          html_url: `https://example.test/issues/${number}`,
          updated_at: '2026-10-09T00:00:00Z',
        }
        issues.set(number, issue)
        return issue
      },
      async issue(_repo, id) {
        return issues.get(id)
      },
      async issueComments() {
        return comments
      },
      async createIssueComment(_repo, id, body) {
        const comment = {
          id: comments.length + 1,
          body,
          html_url: `https://example.test/issues/${id}#issuecomment-${comments.length + 1}`,
          updated_at: '2026-10-09T00:01:00Z',
        }
        comments.push(comment)
        return comment
      },
    }
    const medium = createGitHubMedium({ repo: 'owner/repo', client })
    const goal = await medium.createGoal({ title: 'Replace the badge' })
    expect(goal.system).toBe('github')
    expect(goal.uri).toBe('https://example.test/issues/1')
    const written = await medium.appendTransition({
      phase: 0,
      status: 'pass',
      seat: 'orch.arch',
      body: 'Framed.',
      idempotencyKey: 'goal-1-phase-0',
    })
    expect(written.duplicate).toBe(false)
    const duplicate = await medium.appendTransition({
      phase: 0,
      status: 'pass',
      seat: 'orch.arch',
      idempotencyKey: 'goal-1-phase-0',
    })
    expect(duplicate.duplicate).toBe(true)
    expect(comments).toHaveLength(1)
  })
})

describe('phase handoff command', () => {
  it('refuses review before the tester transition and prints a queue body after QA', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phase-cli-'))
    const logs = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk) => {
      logs.push(String(chunk))
      return true
    }
    try {
      for (const [phase, seat] of [
        [0, 'orch.arch'],
        [1, 'orch.arch'],
        [2, 'orch.arch'],
        [3, 'orch.arch'],
        [4, 'dev.build'],
      ]) {
        const code = await main([
          'append',
          '--medium',
          'filesystem',
          '--root',
          root,
          '--title',
          'Replace the badge',
          '--phase',
          String(phase),
          '--status',
          'pass',
          '--seat',
          seat,
          '--key',
          `goal-phase-${phase}`,
          '--body',
          `phase ${phase}`,
        ])
        expect(code).toBe(0)
      }
      const refused = await main([
        'append',
        '--medium',
        'filesystem',
        '--root',
        root,
        '--phase',
        '6',
        '--status',
        'pass',
        '--seat',
        'rev.review',
        '--key',
        'too-early-review',
      ])
      expect(refused).toBeUndefined()
    } catch (error) {
      expect(error.message).toMatch(/not allowed/)
    } finally {
      process.stdout.write = write
    }
    const qa = logs.at(-1)
    expect(qa).toContain('Next seat: dev.qa')
    expect(qa).toContain(`Goal: ${root}`)
  })
})
