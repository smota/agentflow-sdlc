// Deterministic multi-agent role alternation vocabulary (issue #56). This module complements
// lib/role-routing.mjs (the roleAlternationPlan config: routing.roles owner/fallbacks) and
// lib/execution-targets.mjs (launcher/executor/transport/delegationBoundary) rather than
// duplicating them. It answers the question those two modules do not: for a run that claims
// multi-agent contribution, did the SDLC roles actually alternate across independent
// intelligences, and is that alternation evidenced?
//
// Concepts (see docs/agent-workflow.md and docs/execution-targets.md for the full contract):
// - roleAlternationPlan: the planned role -> agent assignment, i.e. `routing.roles` in
//   agent-workflow.config.json. Not redefined here; see lib/role-routing.mjs.
// - roleIntelligence: the actual intelligence source for a role. Reuses the resolved
//   `executionTarget` (lib/execution-targets.mjs) rather than a separate field.
// - contextBoundary: a human-readable derivation of (transport, delegationBoundary) — reused,
//   not duplicated, from lib/execution-targets.mjs.
// - independenceBoundary: whether a role was cognitively independent from another role.
// - roleAttributionMatrix: the durable evidence table parsed by parseRoleAttributionMatrixRows.
// - multiAgentClaim: whether workflow evidence asserts multi-agent mode (the `Mode` field).
// - selfReviewDisclosure: the explicit rationale required when developer and review share an
//   intelligence.

import { SUPPORTED_AGENT_SLUGS, WORKFLOW_ROLES } from './role-routing.mjs'

export const ROLE_ATTRIBUTION_MATRIX_HEADING = 'Role attribution matrix'

export const ROLE_ATTRIBUTION_COLUMNS = [
  'Phase',
  'Role',
  'Planned owner',
  'Actual agent',
  'Executor',
  'Context boundary',
  'Independence boundary',
  'Status',
]

const ROLE_ATTRIBUTION_ROW_KEYS = [
  'phase',
  'role',
  'plannedOwner',
  'actualAgent',
  'executor',
  'contextBoundary',
  'independenceBoundary',
  'status',
]

export const CONTEXT_BOUNDARIES = [
  'current-session',
  'fresh-session',
  'forked-context',
  'local-cli-child-process',
  'provider-api-call',
  'human-handoff',
  'worktree',
  'intercom-session',
]

export const INDEPENDENCE_BOUNDARIES = ['independent', 'self-review', 'not-applicable']

export const ROLE_STATUSES = ['pass', 'blocked', 'returned', 'skipped']

const VALID_INTELLIGENCES = new Set([...SUPPORTED_AGENT_SLUGS, 'human'])

// Maps (transport, delegationBoundary) pairs — the #54 execution-target vocabulary — onto the
// richer contextBoundary vocabulary this issue introduces. Derived, not stored separately, so the
// two vocabularies cannot drift apart.
const CONTEXT_BOUNDARY_BY_TRANSPORT_DELEGATION = {
  'local-cli:current-session': 'current-session',
  'local-cli:child-worktree': 'worktree',
  'provider-api:current-session': 'provider-api-call',
  'pi-subagent:child-subagent': 'forked-context',
  'intercom-session:separate-local-session': 'fresh-session',
  'orchestrated-worktree:child-worktree': 'worktree',
  'manual:human-handoff': 'human-handoff',
}

export function deriveContextBoundary({ transport, delegationBoundary } = {}) {
  return CONTEXT_BOUNDARY_BY_TRANSPORT_DELEGATION[`${transport}:${delegationBoundary}`] ?? null
}

/**
 * Turn a parsed markdown table (see lib/markdown-sections.mjs#parseMarkdownTable) into role
 * attribution matrix row objects, keyed positionally per ROLE_ATTRIBUTION_COLUMNS.
 */
export function rowsFromTable(table) {
  if (!table) {
    return []
  }

  return table.rows
    .filter((cells) => cells.some((cell) => cell !== ''))
    .map((cells) => {
      const row = {}
      ROLE_ATTRIBUTION_ROW_KEYS.forEach((key, index) => {
        row[key] = (cells[index] ?? '').trim()
      })
      return row
    })
    .filter((row) => row.role && !/^-+$/.test(row.role))
}

function rowLabel(row) {
  return row.role || row.phase || 'unknown row'
}

/**
 * Validate a role attribution matrix against the deterministic multi-agent requirements in issue
 * #56. Single-agent evidence (multiAgentClaim: false) is always valid without a matrix — role
 * alternation is optional, and this must never force artificial alternation.
 */
export function validateRoleAttributionMatrix({
  rows = [],
  multiAgentClaim = false,
  workflowProfile,
  selfReviewDisclosure,
} = {}) {
  const errors = []
  const warnings = []

  if (!multiAgentClaim) {
    return { ok: true, errors, warnings }
  }

  if (!rows || rows.length === 0) {
    errors.push(
      'multi-agent claim (Mode: multi-agent) requires a role attribution matrix with at least one row',
    )
    return { ok: false, errors, warnings }
  }

  for (const row of rows) {
    const label = rowLabel(row)
    if (!WORKFLOW_ROLES.includes(row.role) && row.role !== 'orchestrator') {
      warnings.push(`role attribution matrix row "${label}" uses an unrecognized role`)
    }
    if (!row.plannedOwner) {
      errors.push(
        `role attribution matrix row "${label}" is missing a planned owner; a fallback cannot be verified`,
      )
    } else if (!VALID_INTELLIGENCES.has(row.plannedOwner)) {
      errors.push(
        `role attribution matrix row "${label}" has an unsupported planned owner: ${row.plannedOwner}`,
      )
    }
    if (!row.actualAgent) {
      errors.push(`role attribution matrix row "${label}" is missing an actual agent`)
    } else if (!VALID_INTELLIGENCES.has(row.actualAgent)) {
      errors.push(
        `role attribution matrix row "${label}" has an unsupported actual agent: ${row.actualAgent}`,
      )
    }
    if (!row.contextBoundary) {
      errors.push(`role attribution matrix row "${label}" is missing a context boundary`)
    } else if (!CONTEXT_BOUNDARIES.includes(row.contextBoundary)) {
      errors.push(
        `role attribution matrix row "${label}" has an invalid context boundary: "${row.contextBoundary}"`,
      )
    }
    if (!row.independenceBoundary) {
      errors.push(`role attribution matrix row "${label}" is missing an independence boundary`)
    } else if (!INDEPENDENCE_BOUNDARIES.includes(row.independenceBoundary)) {
      errors.push(
        `role attribution matrix row "${label}" has an invalid independence boundary: "${row.independenceBoundary}"`,
      )
    }
    const statusHead = (row.status ?? '').split(':')[0]
    if (!ROLE_STATUSES.includes(statusHead)) {
      errors.push(`role attribution matrix row "${label}" has an invalid status: "${row.status}"`)
    }
  }

  const distinctIntelligences = new Set(rows.map((row) => row.actualAgent).filter(Boolean))
  if (distinctIntelligences.size < 2) {
    errors.push(
      `multi-agent claim requires at least two distinct role intelligences across the role attribution matrix; found: ${
        [...distinctIntelligences].join(', ') || 'none'
      }`,
    )
  }

  const developerRow = rows.find((row) => row.role === 'developer')
  const reviewRow = rows.find((row) => row.role === 'review')
  if (developerRow?.actualAgent && reviewRow?.actualAgent) {
    const sameIntelligence = developerRow.actualAgent === reviewRow.actualAgent
    if (sameIntelligence) {
      const hasDisclosure =
        !!selfReviewDisclosure && selfReviewDisclosure.trim().toLowerCase() !== 'not-applicable'
      const disclosed = reviewRow.independenceBoundary === 'self-review' && hasDisclosure
      if (!disclosed) {
        errors.push(
          'developer and review roles use the same intelligence without an explicit self-review disclosure' +
            ' (set the review row\'s independence boundary to "self-review" and record a "Self-review disclosure" rationale)',
        )
      } else if (workflowProfile === 'high-assurance') {
        errors.push(
          'high-assurance workflow profile forbids self-review; developer and review roles must use independent intelligences',
        )
      }
    } else if (reviewRow.independenceBoundary && reviewRow.independenceBoundary === 'self-review') {
      errors.push(
        'review row is marked "self-review" but its actual agent differs from the developer row; independence boundary must be "independent"',
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
