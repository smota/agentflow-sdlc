// Source-authorized oracle capability admission (#519). Standalone product-bundle
// code: callbacks are trusted host adapters; request records and booleans are not.
import { createHash } from 'node:crypto'

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, ordered(item)]),
    )
  return value
}
function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(ordered(value)) ?? 'null')
    .digest('hex')
}
const text = (value) => typeof value === 'string' && Boolean(value.trim())
const safePath = (value) => text(value) && !value.replaceAll('\\', '/').split('/').includes('..')
function prefix(pattern) {
  return String(pattern)
    .replaceAll('\\', '/')
    .split(/[*?\[{]/, 1)[0]
    .replace(/\/$/, '')
}
function covered(pattern, grant) {
  const p = String(pattern).replaceAll('\\', '/')
  const g = String(grant).replaceAll('\\', '/')
  if (!safePath(p) || !safePath(g)) return false
  return p === g || (p.endsWith('/**') && (g === p.slice(0, -3) || g.startsWith(p.slice(0, -2))))
}
function overlap(a, b) {
  const x = prefix(a),
    y = prefix(b)
  return !x || !y || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}
export function requiresOracleWriter(task = {}) {
  return (
    (Array.isArray(task.requiredCapabilities) &&
      task.requiredCapabilities.includes('oracle-writer')) ||
    task.touchesOracles === true ||
    (Array.isArray(task.touchSurface) &&
      task.touchSurface.some((value) => {
        const path = String(value)
          .replaceAll('\\', '/')
          .replace(/^(?:\.\/)+/, '')
          .replace(/\/+$/, '')
        // Unbounded/ambiguous glob languages are not proof of disjointness from
        // protected paths. A source owner must narrow them or assign a writer.
        return (
          (/[*?\[\]{}]/.test(path) &&
            (/[*?\[\]{}]/.test(path.split('/')[0]) ||
              /(^|\/)(?:tests|oracles)(?:\/|$)/.test(path))) ||
          ['.', '', 'tests'].includes(path) ||
          /(^|\/)tests\/(?:.*\/)?oracles(?:\/|$)/.test(path)
        )
      }))
  )
}
function hold(status, reason, task = {}) {
  return {
    admitted: false,
    status,
    reason,
    requiredCapability: 'oracle-writer',
    effects: [],
    nextAction: {
      owner: task?.owner ?? null,
      action:
        status === 'ORACLE_REPAIR_SCOPE_REVIEW_REQUIRED'
          ? 'Reconsider bounded repair scope and independent test-engineering assignment'
          : 'Resolve source task and assign a lawful independent test engineer',
      checkAfterMs: 60000,
    },
  }
}

function counterScopeMatches(task, assignment, source) {
  const protocol = task.protocol ?? 'legacy'
  if ((assignment.scope?.protocol ?? 'legacy') !== protocol) return false
  if (protocol === 'run-v1') {
    const fields = ['runRevision', 'sourceRevision', 'owner', 'generation', 'revocationEpoch']
    return (
      ['runRevision', 'sourceRevision', 'owner'].every((field) => text(task[field])) &&
      ['generation', 'revocationEpoch'].every(
        (field) => Number.isSafeInteger(task[field]) && task[field] >= 0,
      ) &&
      fields.every((field) => assignment.scope?.[field] === task[field]) &&
      source.sourceRevision === task.sourceRevision &&
      ['epoch', 'fence'].every(
        (field) => task[field] === undefined && assignment.scope?.[field] === undefined,
      )
    )
  }
  return (
    protocol === 'legacy' &&
    Number.isSafeInteger(task.epoch) &&
    task.epoch >= 1 &&
    Number.isSafeInteger(task.fence) &&
    task.fence >= 1 &&
    ['epoch', 'fence'].every((field) => assignment.scope?.[field] === task[field])
  )
}

export function evaluateOracleWriterAdmission({
  task = {},
  assignment,
  resolveAuthority,
  target,
  now = new Date().toISOString(),
} = {}) {
  if (!requiresOracleWriter(task))
    return { admitted: true, status: 'ORACLE_CAPABILITY_NOT_REQUIRED', effects: [] }
  const reject = (status, reason) => hold(status, reason, task)
  if (!assignment || typeof assignment !== 'object')
    return reject(
      'ORACLE_WRITER_MISSING',
      'Protected-oracle work requires a persistent or bounded temporary independent test engineer',
    )
  if (typeof resolveAuthority !== 'function')
    return reject(
      'ORACLE_AUTHORITY_UNVERIFIED',
      'Oracle assignment requires a current source authority resolver; caller booleans are insufficient',
    )
  let source
  try {
    source = resolveAuthority({
      task: structuredClone(task),
      assignment: structuredClone(assignment),
    })
  } catch {
    return reject('ORACLE_AUTHORITY_UNVERIFIED', 'Oracle authority source could not be resolved')
  }
  if (
    source?.verified !== true ||
    !text(source.sourceRef) ||
    !text(source.sourceRevision) ||
    !source.assignment ||
    !source.task ||
    digest(source.assignment) !== digest(assignment) ||
    digest(source.task) !== digest(task)
  )
    return reject(
      'ORACLE_AUTHORITY_UNVERIFIED',
      'Assignment/task does not match the current resolved source revision',
    )
  if (
    assignment.role !== 'test-engineer' ||
    assignment.policySeat !== 'dev.test-eng' ||
    !['temporary', 'persistent'].includes(assignment.mode) ||
    !text(assignment.id) ||
    !text(assignment.identity) ||
    !text(assignment.authorityRef)
  )
    return reject(
      'ORACLE_ROLE_INVALID',
      'Source grant must explicitly assign test-engineering identity and canonical path-policy role',
    )
  if (
    !text(task.builderIdentity) ||
    !text(task.reviewerIdentity) ||
    task.builderIdentity === task.reviewerIdentity ||
    [task.builderIdentity, task.reviewerIdentity].includes(assignment.identity)
  )
    return reject(
      'ORACLE_INDEPENDENCE_REQUIRED',
      'Oracle writer, feature builder and read-only reviewer must have distinct source-bound identities',
    )
  if (target && assignment.target !== target)
    return reject(
      'ORACLE_TARGET_MISMATCH',
      'Dispatch destination does not match authorized test-engineering assignment',
    )
  if (!text(assignment.target))
    return reject('ORACLE_TARGET_MISMATCH', 'Assignment must identify its execution destination')
  if (
    !safePath(assignment.worktree) ||
    !/(^|[\\/])\.worktrees[\\/][^\\/]+/.test(assignment.worktree) ||
    assignment.worktree !== task.worktree
  )
    return reject(
      'ORACLE_WORKTREE_REQUIRED',
      'Assignment requires the exact isolated worktree bound by the source task',
    )
  if (
    !text(task.goal) ||
    !text(task.runId) ||
    !counterScopeMatches(task, assignment, source) ||
    ['goal', 'runId'].some((field) => assignment.scope?.[field] !== task[field]) ||
    digest(assignment.scope?.touchSurface) !== digest(task.touchSurface)
  )
    return reject(
      'ORACLE_SCOPE_MISMATCH',
      'Assignment must preserve task goal, run, tagged native counters or positive legacy epoch/fence, and bounded touch surface',
    )
  const expiry = Date.parse(assignment.expiresAt),
    clock = Date.parse(now)
  if (!Number.isFinite(expiry) || !Number.isFinite(clock) || expiry <= clock)
    return reject('ORACLE_ASSIGNMENT_EXPIRED', 'Assignment needs a current bounded expiry')
  const custody = assignment.custody
  if (
    custody?.owner !== assignment.identity ||
    (!/^[a-f0-9]{64}$/i.test(custody?.oracleDigest ?? '') &&
      !(custody?.state === 'uninitialized' && custody.oracleDigest === null))
  )
    return reject(
      'ORACLE_CUSTODY_REQUIRED',
      'Current oracle digest/custodian or explicit uninitialized custody is required',
    )
  const manifest = source.ownershipManifest
  const rules = Array.isArray(manifest?.rules)
    ? manifest.rules.filter(
        (rule) =>
          rule.seats?.includes(assignment.policySeat) ||
          rule.seatPrefixes?.some((part) => assignment.policySeat.startsWith(part)),
      )
    : []
  const canonical = rules?.find(
    (rule) => rule.id === 'test-eng-source-guard' && rule.defaultDeny === true,
  )
  if (
    manifest?.version !== 1 ||
    !canonical ||
    !Array.isArray(canonical.allow) ||
    !Array.isArray(assignment.allowedPaths) ||
    !assignment.allowedPaths.length
  )
    return reject(
      'ORACLE_PATH_POLICY_UNVERIFIED',
      'Canonical path-ownership manifest and explicit bounded allowed paths are required',
    )
  for (const grant of assignment.allowedPaths) {
    if (
      !safePath(grant) ||
      !canonical.allow.some((pattern) => covered(pattern, grant)) ||
      rules.some((rule) => rule.deny?.some((pattern) => overlap(pattern, grant)))
    )
      return reject(
        'ORACLE_PATH_PERMISSION_DENIED',
        'Assignment grants exceed canonical test-engineering path ownership',
      )
  }
  const protectedPaths =
    task.touchSurface?.filter((path) => requiresOracleWriter({ touchSurface: [path] })) ?? []
  if (protectedPaths.some((path) => !assignment.allowedPaths.some((grant) => covered(grant, path))))
    return reject(
      'ORACLE_PATH_PERMISSION_DENIED',
      'Assignment does not cover every protected-oracle target',
    )
  if (Number(task.reworkRound) >= 2) {
    const repair = assignment.repairScope
    if (
      !text(repair?.revision) ||
      !text(repair?.previousRevision) ||
      repair.revision === repair.previousRevision ||
      !text(repair.reason) ||
      repair.owner !== task.owner
    )
      return reject(
        'ORACLE_REPAIR_SCOPE_REVIEW_REQUIRED',
        'Repeated QA repair must receive a revised bounded scope and accountable owner before redispatch',
      )
  }
  return {
    admitted: true,
    status: 'ORACLE_WRITER_ASSIGNED',
    effects: [],
    assignment: {
      id: assignment.id,
      mode: assignment.mode,
      identity: assignment.identity,
      role: assignment.role,
      policySeat: assignment.policySeat,
      target: assignment.target,
      allowedPaths: [...assignment.allowedPaths],
      worktree: assignment.worktree,
      custody: structuredClone(custody),
      reviewerIdentity: task.reviewerIdentity,
      builderIdentity: task.builderIdentity,
      scope: structuredClone(assignment.scope),
      repairScope: assignment.repairScope ? structuredClone(assignment.repairScope) : null,
      sourceRef: source.sourceRef,
      sourceRevision: source.sourceRevision,
      authorityRef: assignment.authorityRef,
      assignmentDigest: digest(assignment),
    },
  }
}

export function resolveOracleDispatch({
  deps = {},
  request = {},
  now = new Date().toISOString(),
} = {}) {
  if (typeof deps.resolveOracleTask !== 'function')
    return hold(
      'TASK_SCOPE_UNVERIFIED',
      'Delivery task scope is unresolved; no trusted source task adapter is configured',
      request.task,
    )
  let resolved
  try {
    resolved = deps.resolveOracleTask({
      goal: request.goal,
      target: request.target ?? request.to,
      task: structuredClone(request.task ?? null),
    })
  } catch {
    return hold('TASK_SCOPE_UNVERIFIED', 'Source task inspection failed', request.task)
  }
  const task = resolved?.task
  if (
    resolved?.verified !== true ||
    !text(resolved.sourceRef) ||
    !text(resolved.sourceRevision) ||
    !task ||
    (task.requiredCapabilities !== undefined && !Array.isArray(task.requiredCapabilities)) ||
    !Array.isArray(task.touchSurface) ||
    task.touchSurface.some((path) => !safePath(path)) ||
    (request.goal && task.goal !== request.goal) ||
    (request.task && digest(request.task) !== digest(task))
  )
    return hold(
      'TASK_SCOPE_UNVERIFIED',
      'Declared task does not match a current resolved source task',
      task,
    )
  const admission = evaluateOracleWriterAdmission({
    task,
    assignment: request.oracleAssignment ?? task.oracleAssignment,
    resolveAuthority: deps.resolveOracleAuthority,
    target: request.target ?? request.to,
    now,
  })
  return {
    ...admission,
    taskBinding: {
      sourceRef: resolved.sourceRef,
      sourceRevision: resolved.sourceRevision,
      taskDigest: digest(task),
      scope: structuredClone({
        protocol: task.protocol ?? 'legacy',
        goal: task.goal,
        runId: task.runId,
        epoch: task.epoch,
        fence: task.fence,
      }),
    },
  }
}
