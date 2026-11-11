import { recordDigest } from '../core/record-digest.mjs'
import { gateView } from '../core/person-gates.mjs'
import { parseRolePassComment } from '../core/role-pass-evidence.mjs'
import { formatSourceRef } from '../core/source-ref.mjs'
import {
  createSourceMutationPlan,
  createSourceMutationReceipt,
  sourceMutationIdempotencyKey,
  validateSourceMutationPlan,
} from '../core/source-adapter.mjs'
import { GATE_BLOCK_END, GATE_BLOCK_START, parseGateLog, stripGateBlock } from './gate-block.mjs'
import { createGitHubClient } from './github-client.mjs'
import { githubGoalSubject } from './github-medium.mjs'

const SYSTEM = 'github'
const WORK_MARKER = /^<!-- agentflow-work:(\{.*\}) -->$/m
// The medium's own line: `Part of #N` on its own line. owner/repo#N and negations do not match.
const PART_OF = /^part of #(\d+)[ \t]*$/im
const WORK_LINE = /^<!-- agentflow-work:/m
const GATE_RECORD = /<!-- agentflow-gates-record:([A-Za-z0-9+/=]+) -->/
const CHANGE_CLASSES = ['bounded', 'standard', 'high-assurance', 'exploratory']
const LIST_STATE = { open: 'open', closed: 'closed', merged: 'closed' }

function labelNames(issue) {
  return [
    ...new Set(
      (issue.labels ?? [])
        .map((label) => (typeof label === 'string' ? label : label?.name))
        .filter((name) => typeof name === 'string' && name.length > 0),
    ),
  ]
}

function lifecycleOf(issue) {
  if (issue.state !== 'open' && issue.state !== 'closed') {
    throw new Error(`GitHub work item #${issue.number} has no readable state`)
  }
  if (issue.state === 'open') return 'open'
  return issue.pull_request?.merged_at ? 'merged' : 'closed'
}

// Content digest (risk R9): independent of updated_at, so a comment landing does not stale a plan.
function contentRevision(issue) {
  return recordDigest({
    title: String(issue.title ?? ''),
    body: stripGateBlock(issue.body ?? ''),
    lifecycle: lifecycleOf(issue),
    labels: labelNames(issue).sort(),
    status: null,
  })
}

// Fail closed: a marker that is present but unreadable, or names an unknown change class, makes
// the whole work item unreadable. It is never read as "no marker" or as a lower class.
function workMarker(issue) {
  const body = String(issue.body ?? '')
  if (!WORK_LINE.test(body)) return {}
  const text = body.match(WORK_MARKER)?.[1]
  let marker
  try {
    marker = JSON.parse(text)
  } catch {
    marker = null
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new Error(`GitHub work item #${issue.number} has an unreadable agentflow-work marker`)
  }
  if (marker.changeClass !== null && marker.changeClass !== undefined) {
    if (!CHANGE_CLASSES.includes(marker.changeClass)) {
      throw new Error(`GitHub work item #${issue.number} names an unknown change class`)
    }
  }
  return { changeClass: marker.changeClass ?? null }
}

// Waiting gates, counted fail closed: any gate block that cannot be read cleanly counts as one.
function openGateCount(issue) {
  const body = String(issue.body ?? '')
  if (!body.includes(GATE_BLOCK_START)) return 0
  try {
    const block = body.slice(body.indexOf(GATE_BLOCK_START))
    const end = block.indexOf(GATE_BLOCK_END)
    const encoded = end === -1 ? null : block.slice(0, end).match(GATE_RECORD)?.[1]
    if (!encoded) return 1
    if (!Array.isArray(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')))) return 1
    const view = gateView(parseGateLog(body), {
      subjects: { goalRevision: githubGoalSubject(issue) },
    })
    if (view.validation.findings.length) return 1
    return view.gates.filter((gate) => gate.status === 'waiting').length
  } catch {
    return 1
  }
}

function issueNumber(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`invalid GitHub issue number: ${value}`)
  return number
}

function issueRef(repo, issue) {
  return {
    kind: issue.pull_request ? 'implementation' : 'goal',
    system: 'github',
    uri: issue.html_url,
    authority: 'authoritative',
    relationship: 'observes',
    scope: repo,
    revision: String(issue.number),
  }
}

export function createGitHubSourceAdapter({ repo, client, token, fetchImpl, receiptStore } = {}) {
  if (!repo) throw new Error('GitHub repository is required')
  const github = client ?? createGitHubClient({ token, fetchImpl })
  const applied = new Map()
  const flushed = new Set()
  const revision = async (number) => contentRevision(await github.issue(repo, number))
  const numberOf = (parameters) => {
    const fromReference = parameters?.reference?.number
    const direct = parameters?.number
    if (
      fromReference !== undefined &&
      direct !== undefined &&
      Number(fromReference) !== Number(direct)
    ) {
      throw new Error('add-comment names conflicting issue numbers')
    }
    return issueNumber(fromReference ?? direct)
  }

  async function workItem(issue) {
    const comments = await github.issueComments(repo, issue.number, { all: true })
    const uri = formatSourceRef({ system: SYSTEM, scope: repo, id: String(issue.number) })
    const transitions = []
    for (const comment of comments) {
      const record = parseRolePassComment(comment.body, {
        writer: comment.user?.login ?? null,
        uri: comment.html_url ?? `${uri}/comment/${comment.id}`,
      })
      // Consumers must filter transitions by trusted writer; a record is only a claim by its author.
      if (!record || !Number.isInteger(record.phase) || record.phase < 0) continue
      transitions.push({
        phase: record.phase,
        status: record.status,
        seat: record.seat,
        role: record.role,
        idempotencyKey: record.idempotencyKey,
        uri: record.uri,
        writer: record.writer,
        executedBy: record.executedBy,
        launcher: record.launcher,
        executor: record.executor,
        transport: record.transport,
        delegationBoundary: record.delegationBoundary,
        model: record.model,
      })
    }
    const marker = workMarker(issue)
    const partOf = String(issue.body ?? '').match(PART_OF)?.[1] ?? null
    return {
      version: 1,
      ref: uri,
      system: SYSTEM,
      scope: repo,
      id: String(issue.number),
      kind: issue.pull_request ? 'pull-request' : 'issue',
      title: String(issue.title ?? ''),
      lifecycle: lifecycleOf(issue),
      labels: labelNames(issue),
      status: null,
      partOf: partOf === null ? null : String(partOf),
      changeClass: marker.changeClass ?? null,
      revision: contentRevision(issue),
      transitions,
      openGates: openGateCount(issue),
    }
  }

  const adapter = {
    version: 1,
    id: 'github',
    system: SYSTEM,
    scope: repo,
    capabilities: [
      'read-artifacts',
      'read-lifecycle',
      'mutate-comments',
      'ready-predicates',
      'resolve-humans',
    ],
    // GitHub has no status field; readiness is answered from labels and lifecycle.
    readyPredicateKinds: ['label', 'lifecycle'],
    toReference({ system, scope, id } = {}) {
      if (system !== SYSTEM || scope !== repo) {
        throw new Error(`GitHub source for ${repo} cannot resolve ${system}:${scope}`)
      }
      // A bad id is reported when the reference is read, not when it is built.
      return { kind: 'issue', number: Number(id) }
    },
    async readWorkItem(reference) {
      return workItem(await github.issue(repo, issueNumber(reference?.number)))
    },
    // lifecycle null lists every issue. A pull request is listed only once merged: an open or
    // closed one is not deliverable work.
    async listWorkItems({ lifecycle = 'open' } = {}) {
      if (lifecycle !== null && !LIST_STATE[lifecycle]) {
        throw new Error(`lifecycle must be open, closed, merged or null: ${lifecycle}`)
      }
      const issues = await github.issues(repo, {
        state: lifecycle === null ? 'all' : LIST_STATE[lifecycle],
        all: true,
      })
      const items = []
      for (const issue of issues) {
        const state = lifecycleOf(issue)
        if (issue.pull_request && state !== 'merged') continue
        if (lifecycle === null || state === lifecycle) items.push(await workItem(issue))
      }
      return items
    },
    async resolveHumans(writers) {
      const logins = new Map()
      for (const writer of writers ?? []) {
        if (typeof writer !== 'string' || !writer.trim()) continue
        const login = writer.trim().toLowerCase()
        if (!logins.has(login)) logins.set(login, writer)
      }
      return [...logins].map(([login, writer]) => ({ writer, handle: { system: SYSTEM, login } }))
    },
    async readArtifact(reference) {
      if (reference?.kind !== 'issue' && reference?.kind !== 'pull-request') {
        throw new Error('GitHub adapter supports issue and pull-request references')
      }
      const artifact =
        reference.kind === 'issue'
          ? await github.issue(repo, reference.number)
          : await github.pullRequest(repo, reference.number)
      return { artifact, ref: issueRef(repo, artifact) }
    },
    async listArtifacts(params = {}) {
      const artifacts = await github.issues(repo, params)
      return artifacts.map((artifact) => ({ artifact, ref: issueRef(repo, artifact) }))
    },
    async previewMutation({ operation, parameters, actionBoundary, idempotencyKey }) {
      if (operation !== 'add-comment') throw new Error(`unsupported GitHub mutation: ${operation}`)
      // One canonical form, so reference.number and number plan to the same key and one comment.
      const normalised = { number: numberOf(parameters), body: parameters.body }
      return createSourceMutationPlan({
        adapter: this,
        scope: repo,
        capability: 'mutate-comments',
        operation,
        parameters: normalised,
        actionBoundary,
        expectedRevision: await revision(normalised.number),
        idempotencyKey: idempotencyKey ?? sourceMutationIdempotencyKey(operation, normalised),
      })
    },
    async applyMutation(plan, { confirm } = {}) {
      validateSourceMutationPlan(plan, this, confirm)
      if (applied.has(plan.idempotencyKey)) return applied.get(plan.idempotencyKey)
      if (!receiptStore) throw new Error('GitHub mutation requires a durable receipt store')
      const stored = await receiptStore.get(plan.idempotencyKey)
      if (stored) return stored
      const marker = `<!-- agentflow-idempotency:${plan.idempotencyKey} -->`
      const number = numberOf(plan.parameters)
      const comments = await github.issueComments(repo, number, { all: true })
      const existing = comments.find((comment) => comment.body?.includes(marker))
      if (existing) {
        const receipt = createSourceMutationReceipt(
          plan,
          { recovered: true, artifact: existing },
          await revision(number),
        )
        applied.set(plan.idempotencyKey, receipt)
        return receipt
      }
      const currentRevision = await revision(number)
      if (currentRevision !== plan.expectedRevision) {
        throw new Error('GitHub mutation plan is stale; remote artifact changed')
      }
      const comment = await github.createIssueComment(
        repo,
        number,
        `${plan.parameters.body}\n\n${marker}`,
      )
      const result = {
        artifact: comment,
        ref: {
          kind: 'other',
          system: 'github',
          uri: comment.html_url,
          authority: 'authoritative',
          relationship: 'output',
          scope: repo,
          revision: String(comment.id),
        },
      }
      const receipt = createSourceMutationReceipt(plan, result, await revision(number))
      applied.set(plan.idempotencyKey, receipt)
      return receipt
    },
    async flushReceipt(receipt) {
      if (flushed.has(receipt.receiptToken)) return { status: 'already-flushed', receipt }
      if (!receiptStore) throw new Error('GitHub mutation requires a durable receipt store')
      await receiptStore.put(receipt)
      flushed.add(receipt.receiptToken)
      return { status: 'flushed', receipt }
    },
  }
  return adapter
}
