import { createHash } from 'node:crypto'
import { phaseSpec, validateTransition } from '../core/phase-graph.mjs'
import { createGitHubClient } from './github-client.mjs'

const MARKER = 'agentflow-transition:'

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function markerFor(key) {
  return `<!-- ${MARKER}${key} -->`
}

function parseTransition(comment) {
  const match = comment.body?.match(/<!-- agentflow-transition:([^\s]+) -->/)
  if (!match) return null
  const phase = Number(comment.body.match(/^phase:\s*(\d+)/m)?.[1])
  const status = comment.body.match(/^status:\s*(\S+)/m)?.[1]
  const seat = comment.body.match(/^seat:\s*(\S+)/m)?.[1]
  const role = comment.body.match(/^role:\s*(\S+)/m)?.[1]
  const reasonLine = comment.body.match(/^reason:\s*(.*)$/m)?.[1] ?? ''
  const body = comment.body.split(/^body:\s*/m)[1]?.trim() ?? ''
  return {
    version: 1,
    phase,
    status,
    seat,
    role,
    reason: reasonLine.trim() || null,
    body,
    idempotencyKey: match[1],
    uri: comment.html_url,
  }
}

export function createGitHubMedium({ repo, number = null, client, token, fetchImpl } = {}) {
  if (!repo) throw new Error('A GitHub medium requires a repository')
  const github = client ?? createGitHubClient({ token, fetchImpl })
  let issueNumber = number

  async function load() {
    if (!issueNumber) throw new Error('Create a goal before reading this GitHub medium')
    const issue = await github.issue(repo, issueNumber)
    const comments = await github.issueComments(repo, issueNumber)
    const transitions = comments.map(parseTransition).filter(Boolean)
    return { issue, transitions }
  }

  function present(state) {
    return {
      system: 'github',
      uri: state.issue.html_url,
      number: state.issue.number,
      revision: digest({
        number: state.issue.number,
        updatedAt: state.issue.updated_at,
        keys: state.transitions.map((item) => item.idempotencyKey),
      }),
      title: state.issue.title,
      body: state.issue.body ?? '',
      transitions: state.transitions,
    }
  }

  return {
    id: 'github',
    async createGoal({ title, body = '' }) {
      if (issueNumber) throw new Error('This GitHub medium is already bound to an issue')
      if (!title || !String(title).trim()) throw new Error('A goal title is required')
      const issue = await github.createIssue(repo, { title, body })
      issueNumber = issue.number
      return present({ issue, transitions: [] })
    },
    async appendTransition({ phase, status, seat, reason = null, body = '', idempotencyKey }) {
      const state = await load()
      if (!idempotencyKey) throw new Error('A transition idempotency key is required')
      const existing = state.transitions.find((item) => item.idempotencyKey === idempotencyKey)
      if (existing) return { goal: present(state), transition: existing, duplicate: true }
      const checked = validateTransition({
        transitions: state.transitions,
        phase,
        status,
        seat,
        reason,
      })
      const record = {
        version: 1,
        ...checked,
        role: phaseSpec(checked.phase).role,
        body,
        idempotencyKey,
      }
      const commentBody = [
        markerFor(idempotencyKey),
        `phase: ${record.phase}`,
        `role: ${record.role}`,
        `status: ${record.status}`,
        `seat: ${record.seat}`,
        `reason: ${record.reason ?? ''}`,
        'body:',
        record.body,
      ].join('\n')
      const comment = await github.createIssueComment(repo, issueNumber, commentBody)
      record.uri = comment.html_url
      return {
        goal: present({
          issue: { ...state.issue, updated_at: comment.updated_at ?? state.issue.updated_at },
          transitions: [...state.transitions, record],
        }),
        transition: record,
        duplicate: false,
      }
    },
    async readGoal() {
      return present(await load())
    },
  }
}
