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
import { parseGateLog, stripGateBlock } from './gate-block.mjs'
import { createGitHubClient } from './github-client.mjs'
import { githubGoalSubject } from './github-medium.mjs'

const SYSTEM = 'github'
const WORK_MARKER = /^<!-- agentflow-work:(\{.*\}) -->$/m
const PART_OF = /part of[^#\n]*#(\d+)\b/i
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
  if (issue.state !== 'closed') return 'open'
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

function workMarker(body) {
  try {
    return JSON.parse(String(body ?? '').match(WORK_MARKER)?.[1] ?? 'null') ?? {}
  } catch {
    return {}
  }
}

function openGateCount(issue) {
  try {
    const view = gateView(parseGateLog(issue.body), {
      subjects: { goalRevision: githubGoalSubject(issue) },
    })
    return view.gates.filter((gate) => gate.status === 'waiting').length
  } catch {
    // A gate block that cannot be read is treated as one open gate: fail closed, never "no gate".
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
  const numberOf = (parameters) => issueNumber(parameters?.reference?.number ?? parameters?.number)

  async function workItem(issue) {
    const comments = await github.issueComments(repo, issue.number, { all: true })
    const uri = formatSourceRef({ system: SYSTEM, scope: repo, id: String(issue.number) })
    const transitions = []
    for (const comment of comments) {
      const record = parseRolePassComment(comment.body, {
        writer: comment.user?.login ?? null,
        uri: comment.html_url ?? `${uri}/comment/${comment.id}`,
      })
      if (!record) continue
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
    const marker = workMarker(issue.body)
    const partOf = marker.parent ?? issue.body?.match(PART_OF)?.[1] ?? null
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
      return [...new Set(writers ?? [])].map((writer) => ({
        writer,
        handle: { system: SYSTEM, login: String(writer).toLowerCase() },
      }))
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
      return createSourceMutationPlan({
        adapter: this,
        scope: repo,
        capability: 'mutate-comments',
        operation,
        parameters,
        actionBoundary,
        expectedRevision: await revision(numberOf(parameters)),
        idempotencyKey: idempotencyKey ?? sourceMutationIdempotencyKey(operation, parameters),
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
