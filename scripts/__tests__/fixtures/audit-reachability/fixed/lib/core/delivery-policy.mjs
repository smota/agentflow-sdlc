import {
  sealDeliveryRecord,
  requireText,
  requireDigest,
  requireUnique,
} from './delivery-record.mjs'

// W8d — trimmed from this fixture: resolveDeliveryPolicy, journeyCoverage, and budgetAdmission were
// copied here verbatim from the real lib/core/delivery-policy.mjs, but this fixture's small file set
// (unlike the real repo) has no lib/application/run-service.mjs to call them, and none of the five
// W7 instances this fixture exists to test concern them. Once detector B started checking every
// lib/core/ export regardless of name (W8d D2), keeping unrelated, uncalled functions here would
// make this "fixed" fixture fail its own "zero findings" acceptance test for a reason that has
// nothing to do with what this fixture is for. validateDeliveryContract (below), normalizeUsage, and
// resolveLifecycle stay — the first is exercised by scripts/run-delivery.mjs in this same fixture,
// the other two are declared, reasoned exemptions in the real audit (see OFF_PATH_EXEMPTIONS).

export function validateDeliveryContract(contract) {
  const errors = []
  try {
    if (contract?.version !== 2) throw new Error('Delivery acceptance requires contract version 2')
    requireText(contract.goalRevision, 'goalRevision')
    if (!Array.isArray(contract.criteria) || !contract.criteria.length)
      throw new Error('Acceptance criteria required')
    requireUnique(
      contract.criteria.map((c) => requireText(c.id, 'criterion id')),
      'criteria',
    )
    for (const c of contract.criteria) {
      requireDigest(c.definitionDigest, 'definitionDigest')
      requireUnique(c.assertions, 'assertions')
      if (!c.assertions.length || c.assertions.some((a) => typeof a !== 'string' || !a))
        throw new Error('Explicit assertions required')
      if (
        c.allowedOrigins &&
        (!c.allowedOrigins.length ||
          c.allowedOrigins.some((o) => !['collector-observed', 'external-resolved'].includes(o)))
      )
        throw new Error('Deterministic criteria require observed evidence')
      if (c.maxAgeMs !== undefined && (!Number.isFinite(c.maxAgeMs) || c.maxAgeMs < 0))
        throw new Error('Invalid evidence lifetime')
    }
  } catch (error) {
    errors.push(error.message)
  }
  return { ok: !errors.length, errors }
}

// Provider counters retain their original units. A reset starts a new measurement epoch.
export function normalizeUsage(measurements) {
  const seen = new Map(),
    latest = new Map(),
    totals = {}
  const unknown = []
  for (const m of measurements) {
    requireText(m.id, 'measurement id')
    requireText(m.provider, 'provider')
    requireText(m.epoch, 'measurement epoch')
    const key = `${m.provider}:${m.id}`
    const serialized = JSON.stringify(m)
    if (seen.has(key)) {
      if (seen.get(key) !== serialized) throw new Error('Conflicting usage measurement')
      continue
    }
    seen.set(key, serialized)
    if (!m.counters || m.available !== true) {
      unknown.push(key)
      continue
    }
    for (const [unit, value] of Object.entries(m.counters)) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid usage counter')
      const scope = `${m.provider}:${m.epoch}:${unit}`
      const previous = latest.get(scope) ?? 0
      if (m.mode === 'cumulative' && value < previous)
        throw new Error('Counter reset requires a new epoch')
      if (!['cumulative', 'delta'].includes(m.mode)) throw new Error('Invalid usage mode')
      const delta = m.mode === 'cumulative' ? value - previous : value
      totals[`${m.provider}:${unit}`] = (totals[`${m.provider}:${unit}`] ?? 0) + delta
      latest.set(scope, value)
    }
  }
  return { version: 1, totals, unknown, measurementCount: seen.size }
}

export function resolveLifecycle({ candidateDigest, observations = [], required = [] }) {
  const kinds = ['merge', 'checks', 'tag', 'release', 'deployment', 'rollback']
  const results = required.map(({ kind, target, maxAgeMs, exercised = false, channel = 'any' }) => {
    if (!kinds.includes(kind)) throw new Error('Invalid lifecycle kind')
    if (
      !['any', 'stable', 'prerelease'].includes(channel) ||
      (kind !== 'release' && channel !== 'any')
    )
      throw new Error('Invalid lifecycle release channel')
    if (maxAgeMs !== undefined && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0))
      throw new Error('Invalid lifecycle evidence lifetime')
    const candidates = observations.filter(
      (o) => o.kind === kind && o.target === target && o.candidateDigest === candidateDigest,
    )
    // Conflicting observations remain visible; a later pass must not erase an unresolved failed deployment.
    const valid = candidates.filter(
      (o) =>
        o.sourceVerified === true &&
        o.outcome === 'pass' &&
        (channel === 'any' || o.prerelease === (channel === 'prerelease')) &&
        (!exercised || o.exercised === true) &&
        Number.isFinite(o.ageMs) &&
        o.ageMs >= 0 &&
        (maxAgeMs === undefined || o.ageMs <= maxAgeMs),
    )
    const pass = valid.length > 0 && !candidates.some((o) => o.unresolved === true)
    return {
      kind,
      target,
      channel,
      status: pass ? 'pass' : 'blocked',
      observationIds: valid.map((o) => o.id),
    }
  })
  return sealDeliveryRecord('lifecycle-resolution', {
    candidateDigest,
    results,
    status: results.every((r) => r.status === 'pass') ? 'pass' : 'blocked',
  })
}
