import { normalizeRepoId } from './cockpit-domain.mjs'

const PERMISSION_RANK = { none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 }

export function parseAllowlist(value = '') {
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function createAuthPolicy({
  allowedUsers = [],
  allowedOrgs = [],
  allowedTeams = [],
  repositories = [],
} = {}) {
  return {
    allowedUsers: allowedUsers.map((user) => user.toLowerCase()),
    allowedOrgs: allowedOrgs.map((org) => org.toLowerCase()),
    allowedTeams: allowedTeams.map((team) => team.toLowerCase()),
    repositories: repositories.map(normalizeRepoId),
  }
}

export function authorizeCockpitUser({
  user = {},
  repo,
  repoPermission = 'none',
  policy = {},
  requiredPermission = 'read',
} = {}) {
  const login = user.login?.toLowerCase()
  const repoId = normalizeRepoId(repo)
  const reasons = []

  if (!login) reasons.push('missing-github-user')
  if (policy.repositories?.length && !policy.repositories.includes(repoId))
    reasons.push('repo-not-registered')

  const userAllowed = !policy.allowedUsers?.length || policy.allowedUsers.includes(login)
  const orgAllowed =
    !policy.allowedOrgs?.length ||
    (user.orgs || [])
      .map((org) => org.toLowerCase())
      .some((org) => policy.allowedOrgs.includes(org))
  const teamAllowed =
    !policy.allowedTeams?.length ||
    (user.teams || [])
      .map((team) => team.toLowerCase())
      .some((team) => policy.allowedTeams.includes(team))

  if (!userAllowed) reasons.push('user-not-allowed')
  if (!orgAllowed) reasons.push('org-not-allowed')
  if (!teamAllowed) reasons.push('team-not-allowed')

  if (PERMISSION_RANK[repoPermission] < PERMISSION_RANK[requiredPermission]) {
    reasons.push('insufficient-repo-permission')
  }

  return {
    ok: reasons.length === 0,
    reasons,
    actor: login,
    repo: repoId,
    requiredPermission,
    repoPermission,
  }
}

export function secureCookieOptions({
  https = true,
  sameSite = 'lax',
  maxAgeSeconds = 8 * 60 * 60,
} = {}) {
  return {
    httpOnly: true,
    secure: Boolean(https),
    sameSite,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function validateAllowedOrigin({ origin, publicUrl, extraOrigins = [] } = {}) {
  if (!origin) return false
  const allowed = new Set(
    [publicUrl, ...extraOrigins].filter(Boolean).map((value) => String(value).replace(/\/$/, '')),
  )
  return allowed.has(String(origin).replace(/\/$/, ''))
}

export function createAuditEvent({
  actor,
  action,
  target,
  allowed,
  reason = [],
  resultUrl,
  previewSummary,
} = {}) {
  return {
    type: 'cockpit.audit',
    actor,
    action,
    target,
    allowed: Boolean(allowed),
    reason,
    resultUrl,
    previewSummary,
  }
}
