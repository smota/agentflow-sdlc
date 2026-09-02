export const ROLE_PASS_STATUSES = ['pass', 'blocked', 'returned', 'skipped']
export const CORE_ROLES = Object.freeze([
  { phase: 0, slug: 'product-manager', label: 'Product manager' },
  { phase: 1, slug: 'analyst', label: 'Analyst' },
  { phase: 2, slug: 'architect', label: 'Architect' },
  { phase: 3, slug: 'implementation-planner', label: 'Implementation planner' },
  { phase: 4, slug: 'developer', label: 'Developer' },
  { phase: 5, slug: 'tester', label: 'Tester' },
  { phase: 6, slug: 'reviewer', label: 'Reviewer' },
  { phase: 7, slug: 'technical-writer', label: 'Technical writer' },
  { phase: 8, slug: 'pr-readiness', label: 'PR readiness' },
])
export const DEFAULT_PROFILE_REQUIREMENTS = Object.freeze({
  bounded: {
    required: [
      'analyst',
      'implementation-planner',
      'developer',
      'tester',
      'reviewer',
      'pr-readiness',
    ],
    optional: ['product-manager', 'architect', 'technical-writer'],
  },
  standard: {
    required: [
      'analyst',
      'architect',
      'implementation-planner',
      'developer',
      'tester',
      'reviewer',
      'pr-readiness',
    ],
    optional: ['product-manager', 'technical-writer'],
  },
  'high-assurance': { required: CORE_ROLES.map((role) => role.slug), optional: [] },
  exploratory: {
    required: ['product-manager', 'analyst', 'architect', 'reviewer'],
    optional: ['implementation-planner', 'developer', 'tester', 'technical-writer', 'pr-readiness'],
  },
})
export const ARTIFACT_KINDS = [
  'goal',
  'requirement',
  'design',
  'plan',
  'implementation',
  'validation',
  'review',
  'release',
  'incident',
  'other',
]
export const SOURCE_AUTHORITIES = ['authoritative', 'working-copy', 'mirror']
export const ARTIFACT_RELATIONSHIPS = [
  'input',
  'output',
  'supersedes',
  'verifies',
  'implements',
  'observes',
]
export const ACTION_BOUNDARIES = [
  'observe',
  'propose',
  'mutate-worktree',
  'open-pr',
  'external-action',
]
export const DEFAULT_PROFILE_MAXIMUMS = Object.freeze({
  bounded: 'open-pr',
  standard: 'open-pr',
  'high-assurance': 'open-pr',
  exploratory: 'propose',
})

export function sdlcVocabulary(config = {}) {
  const configured = config.vocabulary ?? {}
  const roles = config.roles?.length ? config.roles : CORE_ROLES
  const paths =
    config.paths && Object.keys(config.paths).length ? config.paths : DEFAULT_PROFILE_REQUIREMENTS
  return {
    roles: roles.map((role) => role.slug),
    profiles: Object.keys(paths),
    rolePassStatuses: configured.rolePassStatuses ?? ROLE_PASS_STATUSES,
    artifactKinds: configured.artifactKinds ?? ARTIFACT_KINDS,
    sourceAuthorities: configured.sourceAuthorities ?? SOURCE_AUTHORITIES,
    artifactRelationships: configured.artifactRelationships ?? ARTIFACT_RELATIONSHIPS,
    actionBoundaries: configured.actionBoundaries ?? ACTION_BOUNDARIES,
  }
}

export function actionBoundaryRank(boundary, config = {}) {
  return sdlcVocabulary(config).actionBoundaries.indexOf(boundary)
}

export function actionBoundaryAllows(parentBoundary, childBoundary, config = {}) {
  const parentRank = actionBoundaryRank(parentBoundary, config)
  const childRank = actionBoundaryRank(childBoundary, config)
  return parentRank >= 0 && childRank >= 0 && childRank <= parentRank
}

export function canonicalRole(role, config = {}) {
  const normalized = String(role ?? '')
    .trim()
    .toLowerCase()
  const match = (config.roles?.length ? config.roles : CORE_ROLES).find(
    (item) => item.slug === normalized || item.label?.toLowerCase() === normalized,
  )
  return match?.slug ?? null
}

export function normalizeRole(role, config = {}) {
  const input = String(role ?? '')
    .trim()
    .toLowerCase()
  const canonical = canonicalRole(input, config)
  return {
    input,
    canonical,
  }
}

export function isAllowedTransition(fromRole, toRole, config = {}) {
  return (config.transitions ?? []).some(([from, to]) => from === fromRole && to === toRole)
}
