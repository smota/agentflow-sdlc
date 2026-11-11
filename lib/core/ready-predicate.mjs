// Readiness rules a project declares for source work items. Pure; the adapter declares which leaf
// kinds it can answer (readyPredicateKinds), and a predicate using any other kind is reported as
// unsupported before anything is evaluated, so a partial answer never reads as "ready".
import { READY_PREDICATE_KINDS } from './source-adapter.mjs'

export const MAX_PREDICATE_DEPTH = 4
const LIFECYCLES = ['open', 'closed', 'merged']
const LEAF_KEYS = { label: ['has', 'lacks'], status: ['in'], lifecycle: ['state'] }
const nonEmpty = (value) => typeof value === 'string' && value.length > 0

function leafProblems(leaf) {
  const problems = []
  const allowed = LEAF_KEYS[leaf.kind]
  if (!allowed) return [`unknown predicate kind: ${leaf.kind}`]
  for (const key of Object.keys(leaf)) {
    if (key !== 'kind' && !allowed.includes(key))
      problems.push(`unexpected key ${key} in ${leaf.kind} leaf`)
  }
  if (leaf.kind === 'label' && nonEmpty(leaf.has) === nonEmpty(leaf.lacks)) {
    problems.push('label leaf needs exactly one of has or lacks')
  }
  if (
    leaf.kind === 'status' &&
    (!Array.isArray(leaf.in) || leaf.in.length === 0 || !leaf.in.every(nonEmpty))
  ) {
    problems.push('status leaf needs a non-empty in list')
  }
  if (leaf.kind === 'lifecycle' && !LIFECYCLES.includes(leaf.state)) {
    problems.push(`lifecycle state must be one of ${LIFECYCLES.join('|')}`)
  }
  return problems
}

function collectProblems(predicate, depth, problems) {
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) {
    problems.push('predicate must be an object')
    return
  }
  if ('kind' in predicate) {
    problems.push(...leafProblems(predicate))
    return
  }
  const combinators = ['all', 'any'].filter((key) => key in predicate)
  if (combinators.length !== 1) {
    problems.push('a combinator has exactly one of all or any')
    return
  }
  const [key] = combinators
  for (const extra of Object.keys(predicate)) {
    if (extra !== key) problems.push(`unexpected key ${extra} in ${key} combinator`)
  }
  if (depth + 1 > MAX_PREDICATE_DEPTH) {
    problems.push(`predicate nesting exceeds depth ${MAX_PREDICATE_DEPTH}`)
    return
  }
  if (!Array.isArray(predicate[key]) || predicate[key].length === 0) {
    problems.push(`${key} needs at least one predicate`)
    return
  }
  for (const child of predicate[key]) collectProblems(child, depth + 1, problems)
}

export function readyPredicateProblems(predicate) {
  const problems = []
  collectProblems(predicate, 0, problems)
  return [...new Set(problems)]
}

export function predicateKinds(predicate, kinds = new Set()) {
  if (!predicate || typeof predicate !== 'object') return kinds
  if ('kind' in predicate) kinds.add(predicate.kind)
  for (const key of ['all', 'any']) {
    for (const child of Array.isArray(predicate[key]) ? predicate[key] : [])
      predicateKinds(child, kinds)
  }
  return kinds
}

function evaluateLeaf(leaf, workItem) {
  const labels = workItem?.labels ?? []
  if (leaf.kind === 'label' && leaf.has !== undefined) {
    return labels.includes(leaf.has) ? [] : [`label ${leaf.has} missing`]
  }
  if (leaf.kind === 'label')
    return labels.includes(leaf.lacks) ? [`label ${leaf.lacks} present`] : []
  if (leaf.kind === 'status') {
    const status = workItem?.status ?? null
    return leaf.in.includes(status)
      ? []
      : [`status ${status ?? 'none'} not in [${leaf.in.join(', ')}]`]
  }
  const lifecycle = workItem?.lifecycle ?? 'unknown'
  return lifecycle === leaf.state ? [] : [`lifecycle ${lifecycle} is not ${leaf.state}`]
}

// Returns the reasons the predicate fails; an empty list means it holds.
function failures(predicate, workItem) {
  if ('kind' in predicate) return evaluateLeaf(predicate, workItem)
  const results = (predicate.all ?? predicate.any).map((child) => failures(child, workItem))
  if (predicate.all) return results.flat()
  return results.some((reasons) => reasons.length === 0) ? [] : results.flat()
}

export function evaluateReadyPredicate(
  predicate,
  workItem,
  { supportedKinds = READY_PREDICATE_KINDS } = {},
) {
  const problems = readyPredicateProblems(predicate)
  if (problems.length) throw new Error(`invalid ready predicate: ${problems.join('; ')}`)
  const supported = new Set(supportedKinds ?? [])
  const unsupportedKinds = [...predicateKinds(predicate)].filter((kind) => !supported.has(kind))
  if (unsupportedKinds.length)
    return { status: 'unsupported', unsupportedKinds: unsupportedKinds.sort() }
  const reasons = failures(predicate, workItem)
  return reasons.length ? { status: 'not-ready', reasons } : { status: 'ready' }
}
