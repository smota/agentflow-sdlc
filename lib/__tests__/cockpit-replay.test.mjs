import { describe, expect, it } from 'vitest'
import { buildGoalStory, renderGoalStoryMarkdown } from '../cockpit-replay.mjs'
import { loadGoalStoryFromGitHub } from '../cockpit-replay-github.mjs'

describe('cockpit goal story replay', () => {
  it('reconstructs compact goal story from durable GitHub-shaped data', () => {
    const story = buildGoalStory({
      goal: issue(127, 'Goal Story replay'),
      comments: [
        {
          id: 1,
          body: '<!-- agent-handover -->\nNext: implementation',
          created_at: '2026-01-01T01:00:00Z',
          html_url: 'https://example/comment/1',
        },
        {
          id: 2,
          body: '<!-- agentflow:validation-summary -->\npnpm test passed',
          created_at: '2026-01-01T02:00:00Z',
        },
        {
          id: 3,
          body: 'Decision: use GitHub as truth. Follow-up #132',
          created_at: '2026-01-01T03:00:00Z',
        },
      ],
      pullRequests: [
        {
          number: 126,
          title: 'Implement replay',
          created_at: '2026-01-01T04:00:00Z',
          merged_at: '2026-01-01T05:00:00Z',
          merge_commit_sha: 'abcdef123456',
        },
      ],
    })
    expect(story.readOnly).toBe(true)
    expect(story.status).toBe('merged')
    expect(story.sections.Validation).toHaveLength(1)
    expect(story.followUps).toContain(132)
    expect(story.compactEvents.map((event) => event.type)).toContain('pr.merged')
  })

  it('labels missing evidence honestly', () => {
    const story = buildGoalStory({ goal: { number: 1, title: 'Sparse', body: '' } })
    expect(story.status).toBe('incomplete')
    expect(story.missing).toEqual(
      expect.arrayContaining(['Acceptance criteria section missing', 'PR evidence missing']),
    )
  })

  it('exports privacy-safe markdown summary', () => {
    const story = buildGoalStory({ goal: issue(1, 'Export'), pullRequests: [] })
    const markdown = renderGoalStoryMarkdown(story)
    expect(markdown).toContain('Replay mode: read-only reconstruction')
    expect(markdown).not.toMatch(/prompt|tool input|transcript/i)
  })

  it('loads GitHub source bundle through adapter', async () => {
    const calls = []
    const client = {
      issue: async (_repo, number) => {
        calls.push(['issue', number])
        return issue(number, number === 127 ? 'Replay epic' : 'Child')
      },
      issueComments: async () => [{ id: 1, body: '<!-- agentflow:validation-summary -->\nok' }],
      pullRequests: async () => [
        {
          number: 2,
          title: 'PR for #127',
          body: 'Implements #127',
          merged_at: '2026-01-01T00:00:00Z',
        },
      ],
      pullRequestCommits: async () => [{ sha: 'abc' }],
      commitCheckRuns: async () => ({
        check_runs: [{ id: 1, name: 'test', conclusion: 'success' }],
      }),
    }
    const story = await loadGoalStoryFromGitHub({
      client,
      repo: 'smota/agentflow-sdlc',
      issueNumber: 127,
    })
    expect(story.events.some((event) => event.type === 'validation.recorded')).toBe(true)
    expect(calls.some(([kind]) => kind === 'issue')).toBe(true)
  })
})

function issue(number, title) {
  return {
    number,
    title,
    body: '## Acceptance criteria\n- [ ] done\n\n## Feature Tracking\n- [ ] #128',
    created_at: '2026-01-01T00:00:00Z',
    html_url: `https://example/issues/${number}`,
  }
}
