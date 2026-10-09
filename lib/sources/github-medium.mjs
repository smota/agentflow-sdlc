import { createHash } from 'node:crypto'
import { phaseSpec, validateTransition } from '../core/phase-graph.mjs'
import { validateOpen } from '../core/work-altitude.mjs'
import { createGitHubClient } from './github-client.mjs'

const MARKER = 'agentflow-transition:'
const WORK_MARKER = /^<!-- agentflow-work:(\{.*\}) -->$/m

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function markerFor(key) {
  return `<!-- ${MARKER}${key} -->`
}

// The admission is read back as evidence, never as consent: validateOpen checks it again with
// satisfyGate against the change class stored now, and a matching admission never opens a spec,
// so editing the body, even with a resealed pair, cannot skip a person gate.
function parseWork(body) {
  const match = body?.match(WORK_MARKER)
  if (!match) return { kind: null, parent: null, changeClass: null, admission: null }
  const { kind = null, parent = null, changeClass = null, admission = null } = JSON.parse(match[1])
  return { kind, parent, changeClass, admission }
}

// The marker must be the comment's first line. A comment that only mentions it in prose, such as a
// QA note quoting an example, is not a transition.
function parseTransition(comment) {
  const match = comment.body?.match(/^<!-- agentflow-transition:(\S+) -->\r?(?:\n|$)/)
  if (!match) return null
  const phase = Number(comment.body.match(/^phase:\s*(\d+)/m)?.[1])
  const status = comment.body.match(/^status:\s*(\S+)/m)?.[1]
  const seat = comment.body.match(/^seat:\s*(\S+)/m)?.[1]
  const role = comment.body.match(/^role:\s*(\S+)/m)?.[1]
  const reasonLine = comment.body.match(/^reason:[ \t]*(.*)$/m)?.[1] ?? ''
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

function withPartOf(body, number) {
  if (!number) return body
  if (new RegExp(`part of[^#\\n]*#${number}\\b`, 'i').test(body)) return body
  return [body, `Part of #${number}`].filter(Boolean).join('\n\n')
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
      nodeId: state.issue.node_id ?? null,
      revision: digest({
        number: state.issue.number,
        updatedAt: state.issue.updated_at,
        keys: state.transitions.map((item) => item.idempotencyKey),
      }),
      title: state.issue.title,
      body: state.issue.body ?? '',
      ...parseWork(state.issue.body),
      transitions: state.transitions,
    }
  }

  // part of #n stays the authority. The native sub-issue is a navigation mirror that a client
  // may lack, and a host may not support.
  async function mirrorParent(parent, issue) {
    if (!parent?.number || typeof github.addSubIssue !== 'function') return
    if (!parent.nodeId || !issue.node_id) return
    try {
      await github.addSubIssue({ parentNodeId: parent.nodeId, childNodeId: issue.node_id })
    } catch (error) {
      if (!error?.unsupported) throw error
    }
  }

  return {
    id: 'github',
    async createGoal({
      title,
      body = '',
      kind = null,
      parent = null,
      changeClass = null,
      consent = null,
    }) {
      if (issueNumber) throw new Error('This GitHub medium is already bound to an issue')
      if (!title || !String(title).trim()) throw new Error('A goal title is required')
      // No kind is a legacy record: it opens as before and is never checked as a goal.
      const opened = kind ? validateOpen({ record: { kind, changeClass }, parent, consent }) : {}
      const admission = opened.admission ?? null
      const work = { kind, parent: parent?.uri ?? null, changeClass, admission }
      const text = withPartOf(body, parent?.number)
      const marked = kind ? `<!-- agentflow-work:${JSON.stringify(work)} -->\n${text}` : text
      const issue = await github.createIssue(repo, { title, body: marked })
      issueNumber = issue.number
      await mirrorParent(parent, issue)
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
