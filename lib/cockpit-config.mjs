import { readFileSync } from 'node:fs'
import { createAuthPolicy, parseAllowlist } from './cockpit-auth.mjs'
import { normalizeRepoId } from './cockpit-domain.mjs'

export function loadCockpitConfig(env = process.env) {
  const repositories = parseAllowlist(env.AGENTFLOW_REPOSITORIES || env.COCKPIT_REPOSITORIES).map(
    normalizeRepoId,
  )
  const publicUrl = env.COCKPIT_PUBLIC_URL || `http://127.0.0.1:${env.PORT || 3975}`
  return {
    enabled: env.COCKPIT_ENABLED !== 'false',
    remote: env.COCKPIT_REMOTE === 'true',
    publicUrl,
    port: Number(env.PORT || env.COCKPIT_PORT || 3975),
    github: {
      clientId: env.GITHUB_CLIENT_ID || '',
      clientSecret: env.GITHUB_CLIENT_SECRET || '',
      token: env.GITHUB_TOKEN || env.GH_TOKEN || '',
    },
    authPolicy: createAuthPolicy({
      allowedUsers: parseAllowlist(env.GITHUB_ALLOWED_USERS),
      allowedOrgs: parseAllowlist(env.GITHUB_ALLOWED_ORGS),
      allowedTeams: parseAllowlist(env.GITHUB_ALLOWED_TEAMS),
      repositories,
    }),
    repositories,
    sessionSecret: env.COCKPIT_SESSION_SECRET || '',
    writeActions: env.COCKPIT_WRITE_ACTIONS === 'true',
    chat: env.COCKPIT_CHAT === 'true',
    runnerTelemetry: env.COCKPIT_RUNNER_TELEMETRY === 'true',
    rateLimit: {
      limit: Number(env.COCKPIT_RATE_LIMIT || 120),
      windowMs: Number(env.COCKPIT_RATE_LIMIT_WINDOW_MS || 60_000),
    },
    dataDir: env.COCKPIT_DATA_DIR || '.agent-runs/cockpit',
  }
}

export function validateCockpitConfig(config) {
  const errors = []
  const warnings = []
  if (!config.repositories.length) errors.push('AGENTFLOW_REPOSITORIES required')
  if (config.remote) {
    if (!config.github.clientId) errors.push('GITHUB_CLIENT_ID required for remote mode')
    if (!config.github.clientSecret) errors.push('GITHUB_CLIENT_SECRET required for remote mode')
    if (!config.sessionSecret || config.sessionSecret.length < 32)
      errors.push('COCKPIT_SESSION_SECRET must be at least 32 chars for remote mode')
    if (!config.publicUrl.startsWith('https://'))
      warnings.push('COCKPIT_PUBLIC_URL should be https in remote mode')
  }
  if (
    !config.authPolicy.allowedUsers.length &&
    !config.authPolicy.allowedOrgs.length &&
    !config.authPolicy.allowedTeams.length
  ) {
    warnings.push('No GitHub allowlist configured; repo permissions still apply')
  }
  return { ok: errors.length === 0, errors, warnings }
}

export function loadJsonFile(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}
