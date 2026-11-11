import { recordDigest } from '../core/record-digest.mjs'
import { gateView } from '../core/person-gates.mjs'
import { parseRolePassComment } from '../core/role-pass-evidence.mjs'
import { formatSourceRef } from '../core/source-ref.mjs'
import {
  claimEntry,
  claimEntryProblems,
  formatClaimMarker,
  ownersEqual,
  parseClaimMarker,
  releaseEntry,
  resolveClaim,
} from '../core/source-claim.mjs'
import {
  createSourceMutationPlan,
  createSourceMutationReceipt,
  sourceMutationIdempotencyKey,
  validateSourceMutationPlan,
} from '../core/source-adapter.mjs'
import { GATE_BLOCK_END, GATE_BLOCK_START, parseGateLog, stripGateBlock } from './gate-block.mjs'
import { createGitHubClient } from './github-client.mjs'
import { githubGoalSubject } from './github-medium.mjs'

// A work item whose content cannot be read safely. listWorkItems skips these; transport errors
// are never this class and always propagate.
export class UnreadableWorkItemError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnreadableWorkItemError'
  }
}

const SYSTEM = 'github'
const WORK_MARKER = /^<!-- agentflow-work:(\{.*\}) -->$/m
// The medium's own line: `Part of #N` on its own line. owner/repo#N and negations do not match.
const PART_OF = /^part of #(\d+)[ \t]*$/im
const WORK_LINE = /^<!-- agentflow-work:/m
const GATE_RECORD = /<!-- agentflow-gates-record:([A-Za-z0-9+/=]+) -->/
const CHANGE_CLASSES = ['bounded', 'standard', 'high-assurance', 'exploratory']
const LIST_STATE = { open: 'open', closed: 'closed', merged: 'closed' }
const MAX_STALE_RETRIES = 3
const OPERATIONS = {
  'add-comment': 'mutate-comments',
  'append-claim-entry': 'mutate-comments',
  'set-assignees': 'mutate-lifecycle',
}
const login = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

function staleError() {
  const error = new Error('GitHub mutation plan is stale; remote artifact changed')
  error.code = 'source-plan-stale'
  return error
}

function assigneeLogins(issue) {
  return (issue.assignees ?? [])
    .map((assignee) => (typeof assignee === 'string' ? assignee : assignee?.login))
    .filter((name) => typeof name === 'string' && name.length > 0)
}

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
    throw new UnreadableWorkItemError(`GitHub work item #${issue.number} has no readable state`)
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
    throw new UnreadableWorkItemError(
      `GitHub work item #${issue.number} has an unreadable agentflow-work marker`,
    )
  }
  if (marker.changeClass !== null && marker.changeClass !== undefined) {
    if (!CHANGE_CLASSES.includes(marker.changeClass)) {
      throw new UnreadableWorkItemError(
        `GitHub work item #${issue.number} names an unknown change class`,
      )
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

// Claims (#581b): claimWriters are the GitHub logins whose agentflow-claim comments count (one
// project bot account in the recommended setup); the rig is named inside each entry, never by the
// comment author or the assignee. mirrorAssignee is the login assigned while a rig holds the item.
// claimBoundary is the effective action boundary every claim, release and mirror write is planned
// under; without an open-pr or external-action boundary those writes are refused.
export function createGitHubSourceAdapter({
  repo,
  client,
  token,
  fetchImpl,
  receiptStore,
  claimWriters = [],
  mirrorAssignee = null,
  claimBoundary = null,
} = {}) {
  if (!repo) throw new Error('GitHub repository is required')
  if (!Array.isArray(claimWriters)) throw new Error('claimWriters must be an array of logins')
  const trusted = [...new Set(claimWriters.map(login).filter(Boolean))]
  const claims = trusted.length > 0
  if (claims && !login(mirrorAssignee)) {
    throw new Error('GitHub claims require mirrorAssignee: the login assigned while a rig holds')
  }
  const mirrorLogin = login(mirrorAssignee)
  const github = client ?? createGitHubClient({ token, fetchImpl })
  const applied = new Map()
  const flushed = new Set()
  const refText = (number) => formatSourceRef({ system: SYSTEM, scope: repo, id: String(number) })
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

  // GitHub add/remove are idempotent; adding first means the item is never briefly unassigned.
  async function setAssignees(number, wanted) {
    const current = assigneeLogins(await github.issue(repo, number))
    const has = (list, name) => list.some((item) => login(item) === name)
    const add = wanted.filter((name) => !has(current, name))
    const remove = current.filter((name) => !wanted.includes(login(name)))
    if (add.length) await github.addAssignees(repo, number, add)
    if (remove.length) await github.removeAssignees(repo, number, remove)
    return github.issue(repo, number)
  }

  async function mutate(operation, parameters) {
    let lastError
    for (let attempt = 0; attempt < MAX_STALE_RETRIES; attempt += 1) {
      const plan = await adapter.previewMutation({
        operation,
        parameters,
        actionBoundary: claimBoundary,
      })
      let receipt
      try {
        receipt = await adapter.applyMutation(plan, { confirm: plan.token })
      } catch (error) {
        if (error?.code !== 'source-plan-stale') throw error
        lastError = error
        continue
      }
      await adapter.flushReceipt(receipt)
      return receipt
    }
    throw lastError
  }

  async function claimLog(number) {
    const comments = await github.issueComments(repo, number, { all: true })
    const rows = []
    for (const comment of comments) {
      const entry = parseClaimMarker(comment.body)
      if (!entry) continue
      rows.push({
        entry,
        writer: login(comment.user?.login),
        position: Number(comment.id),
        uri: comment.html_url ?? `${refText(number)}/comment/${comment.id}`,
        at: comment.created_at ?? null,
      })
    }
    return rows
  }

  // The assignee mirror is compared with the log-resolved holder only to report divergence. A rig
  // holder shows as exactly the mirror login; a person holder as anyone but the mirror login; a
  // free item as no mirror login.
  function mirrorOf(state, issue) {
    const assignees = assigneeLogins(issue)
    const names = assignees.map(login)
    const hasBot = names.includes(mirrorLogin)
    let diverged
    if (state.status !== 'held') diverged = hasBot
    else if (state.holder.kind === 'rig') diverged = !(names.length === 1 && hasBot)
    else diverged = hasBot || names.length === 0
    return { value: { assignees }, diverged }
  }

  async function claimState(number) {
    const [issue, rows] = await Promise.all([github.issue(repo, number), claimLog(number)])
    const state = resolveClaim(rows, { trustedWriters: trusted })
    return { ...state, mirror: mirrorOf(state, issue) }
  }

  async function appendEntry(number, entry) {
    const before = await claimState(number)
    await mutate('append-claim-entry', { number, entry })
    const after = await claimState(number)
    // The mirror moves only when this entry changed who holds the item.
    const won = after.status === 'held' && ownersEqual(after.holder, entry.owner)
    const freed = before.status === 'held' && after.status === 'free'
    if (won && entry.owner.kind === 'rig') {
      await mutate('set-assignees', { number, assignees: [mirrorLogin], after: entry.claimId })
    } else if (freed) {
      const keep = assigneeLogins(await github.issue(repo, number)).filter(
        (name) => login(name) !== mirrorLogin,
      )
      await mutate('set-assignees', { number, assignees: keep, after: entry.claimId })
    }
    return claimState(number)
  }

  function requireClaims() {
    if (!claims) throw new Error(`GitHub source for ${repo} has no claimWriters configured`)
  }

  const claimMethods = {
    async claim(reference, owner) {
      requireClaims()
      const number = issueNumber(reference?.number)
      const state = await claimState(number)
      if (state.status === 'held' && ownersEqual(state.holder, owner)) return state
      return appendEntry(number, claimEntry({ owner }))
    },
    async release(reference, owner) {
      requireClaims()
      return appendEntry(issueNumber(reference?.number), releaseEntry({ owner }))
    },
    async readClaim(reference) {
      requireClaims()
      return claimState(issueNumber(reference?.number))
    },
    // A person changed the assignee in the GitHub UI while a rig holds the item. The change is input,
    // not truth: when both the person who made it and the new assignee resolve through personFor
    // (login → roster person id, or null), the rig's claim is released and the new assignee claims,
    // each entry naming the event as its cause. Otherwise the mirror is restored to the holder and
    // nothing is appended. Returns { status, reason?, event?, state }.
    async adoptMirrorChange(reference, { personFor } = {}) {
      requireClaims()
      if (typeof personFor !== 'function') throw new Error('adoptMirrorChange requires personFor')
      const number = issueNumber(reference?.number)
      const state = await claimState(number)
      if (state.status !== 'held' || state.holder.kind !== 'rig') {
        return { status: 'not-applicable', reason: 'no-rig-holder', event: null, state }
      }
      if (!state.mirror.diverged) return { status: 'in-sync', event: null, state }
      const since = (await claimLog(number)).find((row) => row.uri === state.uri)?.at ?? ''
      const current = state.mirror.value.assignees.map(login)
      const events = await github.issueEvents(repo, number)
      const event = [...events]
        .reverse()
        .find(
          (item) =>
            item.event === 'assigned' &&
            !trusted.includes(login(item.actor?.login)) &&
            login(item.assignee?.login) !== mirrorLogin &&
            current.includes(login(item.assignee?.login)) &&
            String(item.created_at ?? '') >= since,
        )
      const restore = async (reason) => {
        await mutate('set-assignees', {
          number,
          assignees: [mirrorLogin],
          // Every UI change adds events, so each restore is a new write, not a replay.
          after: `restore-${state.entry.claimId}-${events.length}`,
        })
        return { status: 'ignored', reason, event: event ?? null, state: await claimState(number) }
      }
      if (!event) return restore('no-reassignment-event')
      const personId = async (name) => {
        const value = await personFor(name)
        const id = typeof value === 'string' ? value : value?.id
        return typeof id === 'string' && id.length > 0 ? id : null
      }
      const actor = event.actor.login
      if (!(await personId(actor))) return restore('actor-not-a-person')
      const assignee = await personId(event.assignee.login)
      if (!assignee) return restore('assignee-not-a-person')
      const cause = { kind: 'mirror-change', actor, eventId: String(event.id) }
      await mutate('append-claim-entry', {
        number,
        entry: releaseEntry({ owner: state.holder, cause }),
      })
      const person = { kind: 'person', id: assignee }
      const claimed = claimEntry({ owner: person, cause })
      await mutate('append-claim-entry', { number, entry: claimed })
      const after = await claimState(number)
      if (after.status === 'held' && ownersEqual(after.holder, person)) {
        await mutate('set-assignees', {
          number,
          assignees: [login(event.assignee.login)],
          after: claimed.claimId,
        })
        return { status: 'adopted', event, state: await claimState(number) }
      }
      // Another writer claimed in between; the log, not the UI, decides.
      return { status: 'lost', event, state: after }
    },
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
      ...(claims ? ['claim', 'mutate-lifecycle'] : []),
    ],
    // GitHub has no status field; readiness is answered from labels and lifecycle.
    readyPredicateKinds: ['label', 'lifecycle'],
    ...(claims ? { claimMirror: 'assignee', ...claimMethods } : {}),
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
    async listWorkItems({ lifecycle = 'open', onUnreadable } = {}) {
      if (lifecycle !== null && !LIST_STATE[lifecycle]) {
        throw new Error(`lifecycle must be open, closed, merged or null: ${lifecycle}`)
      }
      const issues = await github.issues(repo, {
        state: lifecycle === null ? 'all' : LIST_STATE[lifecycle],
        all: true,
      })
      const items = []
      for (const issue of issues) {
        try {
          const state = lifecycleOf(issue)
          if (issue.pull_request && state !== 'merged') continue
          if (lifecycle === null || state === lifecycle) items.push(await workItem(issue))
        } catch (error) {
          // One unreadable issue must not stop a whole-repository listing.
          if (!(error instanceof UnreadableWorkItemError)) throw error
          onUnreadable?.({
            reference: formatSourceRef({ system: SYSTEM, scope: repo, id: String(issue.number) }),
            error,
          })
        }
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
      const capability = OPERATIONS[operation]
      if (!capability || (capability !== 'mutate-comments' && !claims)) {
        throw new Error(`unsupported GitHub mutation: ${operation}`)
      }
      // One canonical form, so reference.number and number plan to the same key and one comment.
      const normalised = { number: numberOf(parameters) }
      if (operation === 'add-comment') normalised.body = parameters.body
      if (operation === 'append-claim-entry') {
        const problems = claimEntryProblems(parameters?.entry)
        if (problems.length) throw new Error(`invalid claim entry: ${problems.join('; ')}`)
        normalised.entry = parameters.entry
      }
      if (operation === 'set-assignees') {
        if (!Array.isArray(parameters?.assignees) || !parameters.assignees.every(login)) {
          throw new Error('set-assignees requires an array of logins')
        }
        normalised.assignees = [...new Set(parameters.assignees.map(login))].sort()
        // Each mirror write follows one claim entry; the same assignee set written again after a
        // later entry is a new write, not a replay.
        normalised.after = String(parameters.after ?? '')
      }
      return createSourceMutationPlan({
        adapter: this,
        scope: repo,
        capability,
        operation,
        parameters: normalised,
        actionBoundary,
        expectedRevision: await revision(normalised.number),
        idempotencyKey: idempotencyKey ?? sourceMutationIdempotencyKey(operation, normalised),
      })
    },
    async applyMutation(plan, { confirm } = {}) {
      validateSourceMutationPlan(plan, this, confirm)
      if (OPERATIONS[plan.operation] !== plan.capability) {
        throw new Error(`unsupported GitHub mutation: ${plan.operation}`)
      }
      if (applied.has(plan.idempotencyKey)) return applied.get(plan.idempotencyKey)
      if (!receiptStore) throw new Error('GitHub mutation requires a durable receipt store')
      const stored = await receiptStore.get(plan.idempotencyKey)
      if (stored) return stored
      const number = numberOf(plan.parameters)
      if (plan.operation === 'set-assignees') {
        if ((await revision(number)) !== plan.expectedRevision) throw staleError()
        const issue = await setAssignees(number, plan.parameters.assignees)
        const result = { artifact: { number, assignees: assigneeLogins(issue) } }
        const receipt = createSourceMutationReceipt(plan, result, await revision(number))
        applied.set(plan.idempotencyKey, receipt)
        return receipt
      }
      const marker = `<!-- agentflow-idempotency:${plan.idempotencyKey} -->`
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
      if (currentRevision !== plan.expectedRevision) throw staleError()
      // A claim entry's marker must stay the first line of the comment.
      const body =
        plan.operation === 'append-claim-entry'
          ? formatClaimMarker(plan.parameters.entry)
          : plan.parameters.body
      const comment = await github.createIssueComment(repo, number, `${body}\n\n${marker}`)
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
