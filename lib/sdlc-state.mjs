import { existsSync, readFileSync } from 'node:fs'

export const SDLC_CONFIG_PATH = 'sdlc.config.json'
export const DEFAULT_SDLC_CONFIG_PATH = 'defaults/sdlc.config.json'

export function loadSdlcConfig(repoRoot = process.cwd(), configPath = SDLC_CONFIG_PATH) {
  const path = `${repoRoot}/${configPath}`
  const fallback = `${repoRoot}/${DEFAULT_SDLC_CONFIG_PATH}`
  const source = existsSync(path) ? path : fallback
  return JSON.parse(readFileSync(source, 'utf8'))
}

export function roleSlugs(config) {
  return new Set((config.roles || []).map((role) => role.slug))
}

export function validateSdlcConfigShape(config = {}) {
  const findings = []
  if (config.version !== 1) findings.push(finding('blocker', 'config.version', 'version must be 1'))
  for (const key of [
    'authority',
    'roles',
    'paths',
    'labels',
    'release',
    'gateways',
    'extensionPolicy',
  ]) {
    if (config[key] === undefined)
      findings.push(finding('blocker', `config.${key}`, `${key} is required`))
  }
  if (!Array.isArray(config.roles) || !config.roles.length) {
    findings.push(finding('blocker', 'config.roles', 'at least one role is required'))
  }
  const slugs = roleSlugs(config)
  if (slugs.size !== (config.roles ?? []).length) {
    findings.push(finding('high', 'config.roles', 'role slugs must be unique'))
  }
  for (const [pathName, path] of Object.entries(config.paths || {})) {
    for (const role of [...(path.requiredRoles || []), ...(path.optionalRoles || [])]) {
      if (!slugs.has(role))
        findings.push(finding('high', `paths.${pathName}`, `unknown role ${role}`))
    }
    if (pathName === 'high-assurance' && path.requiresHumanApproval !== true) {
      findings.push(
        finding('blocker', 'paths.high-assurance', 'high-assurance must require human approval'),
      )
    }
    if (pathName === 'high-assurance' && path.allowsSelfReview !== false) {
      findings.push(
        finding('blocker', 'paths.high-assurance', 'high-assurance must forbid self-review'),
      )
    }
  }
  for (const pair of config.transitions || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !slugs.has(pair[0]) || !slugs.has(pair[1])) {
      findings.push(
        finding('medium', 'config.transitions', `invalid transition ${JSON.stringify(pair)}`),
      )
    }
  }
  if (config.vocabulary !== undefined) {
    for (const field of [
      'rolePassStatuses',
      'artifactKinds',
      'sourceAuthorities',
      'artifactRelationships',
      'actionBoundaries',
    ]) {
      const values = config.vocabulary?.[field]
      if (values === undefined) continue
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.some((value) => typeof value !== 'string' || !value.trim()) ||
        new Set(values).size !== values.length
      ) {
        findings.push(
          finding(
            'high',
            `config.vocabulary.${field}`,
            `${field} must be unique non-empty strings`,
          ),
        )
      }
    }
  }
  if (config.actionPolicy !== undefined) {
    const boundaries = new Set(config.vocabulary?.actionBoundaries ?? [])
    if (config.actionPolicy.profileMaximums !== undefined) {
      for (const pathName of Object.keys(config.paths ?? {})) {
        const maximum = config.actionPolicy.profileMaximums?.[pathName]
        if (!maximum || (boundaries.size && !boundaries.has(maximum))) {
          findings.push(
            finding(
              'high',
              `config.actionPolicy.profileMaximums.${pathName}`,
              `missing or unknown action boundary for profile ${pathName}`,
            ),
          )
        }
      }
    }
    if (config.actionPolicy.delegationMayNotWidenBoundary === false) {
      findings.push(
        finding(
          'blocker',
          'config.actionPolicy.delegationMayNotWidenBoundary',
          'delegation must not widen the action boundary',
        ),
      )
    }
  }
  return report(findings)
}

export function releaseCandidateFromIssue(issue = {}) {
  const body = issue.body || ''
  const explicit = body.match(
    /(?:target release|release|version)\s*:?\s*(v\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
  )?.[1]
  if (explicit) return explicit
  const milestone = typeof issue.milestone === 'string' ? issue.milestone : issue.milestone?.title
  if (/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(milestone || '')) return milestone
  return null
}

export function releaseImpactFromIssue(issue = {}) {
  const body = issue.body || ''
  const labels = (issue.labels || []).map((label) =>
    typeof label === 'string' ? label : label.name,
  )
  if (/no release impact|internal-only/i.test(body)) return 'none'
  if (/docs-only|documentation/i.test(body) || labels.includes('documentation')) return 'docs-only'
  if (/breaking|major/i.test(body)) return 'major'
  if (/feature|minor/i.test(body) || labels.includes('feature')) return 'minor'
  if (/bug|fix|patch/i.test(body) || labels.includes('bug')) return 'patch'
  return 'unknown'
}

export function releaseAssignmentState(issue = {}) {
  const impact = releaseImpactFromIssue(issue)
  if (impact === 'none') return 'no-release-impact'
  if (issue.state === 'closed' && !hasLabel(issue, 'awaiting-release')) return 'released'
  return releaseCandidateFromIssue(issue) ? 'assigned' : 'needs-assignment'
}

export function selectedPathFromIssue(issue = {}, config = loadSdlcConfig()) {
  const body = issue.body || ''
  const explicit = body.match(
    /(?:profile|workflow classification)\s*:?\s*(bounded|standard|high-assurance|exploratory)/i,
  )?.[1]
  if (explicit) return explicit.toLowerCase()
  const labels = (issue.labels || []).map((label) =>
    typeof label === 'string' ? label : label.name,
  )
  if (
    /security|auth|remote|migration|data loss|production|high-assurance/i.test(body) ||
    labels.some((label) => /security|high-risk/i.test(label))
  )
    return 'high-assurance'
  if (/exploratory|spike|research/i.test(body) || labels.includes('exploratory'))
    return 'exploratory'
  if (/docs-only|typo|bounded|low-risk/i.test(body)) return 'bounded'
  return config.paths?.standard ? 'standard' : Object.keys(config.paths || {})[0]
}

export function readinessDenominatorForPath(pathName, config = loadSdlcConfig()) {
  return new Set(config.paths?.[pathName]?.requiredRoles || [])
}

export function parseEnvelope(markdown = '', type = 'ROLE-PASS') {
  const re = new RegExp(
    `<!-- \\[AGENTFLOW-${type}-v1\\] -->([\\s\\S]*?)<!-- \\[/AGENTFLOW-${type}-v1\\] -->`,
    'g',
  )
  const entries = []
  for (const match of markdown.matchAll(re)) {
    const json = match[1].match(/```json\s*([\s\S]*?)```/i)?.[1]
    if (!json) continue
    try {
      entries.push(JSON.parse(json))
    } catch {
      entries.push({ malformed: true, raw: json.slice(0, 200) })
    }
  }
  return entries
}

export function validateNoForbiddenEvidenceText(text = '') {
  const findings = []
  if (/BEGIN (RSA|OPENSSH|PRIVATE) KEY|api[_-]?key\s*=|secret\s*=|token\s*=/i.test(text)) {
    findings.push(finding('blocker', 'evidence.secrets', 'possible secret in durable evidence'))
  }
  if (/(^|\n)(User|Assistant|Tool|System):/i.test(text) && text.length > 2000) {
    findings.push(
      finding('high', 'evidence.raw-log', 'possible raw prompt/transcript/log in durable evidence'),
    )
  }
  return report(findings)
}

export function validateIssueAgainstSdlc(issue = {}, config = loadSdlcConfig()) {
  const findings = []
  const labels = (issue.labels || [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter(Boolean)
  const typeLabels = new Set(config.labels?.type || [])
  if (!labels.some((label) => typeLabels.has(label)))
    findings.push(finding('high', 'issue.labels.type', 'missing primary type/domain label'))
  if (
    labels.some((label) =>
      (config.labels?.forbiddenPrefixes || []).some((prefix) => label.startsWith(prefix)),
    )
  )
    findings.push(
      finding('blocker', 'issue.labels.forbidden', 'forbidden deprecated label prefix present'),
    )
  if (!/##\s+Acceptance criteria/im.test(issue.body || ''))
    findings.push(finding('medium', 'issue.acceptance', 'missing Acceptance criteria section'))
  if (
    releaseAssignmentState(issue) === 'needs-assignment' &&
    releaseImpactFromIssue(issue) !== 'unknown'
  )
    findings.push(
      finding(
        'medium',
        'issue.release.assignment',
        'release-impact issue needs release assignment or no-impact decision',
      ),
    )
  return report(findings)
}

export function finding(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra }
}

export function report(findings = [], profile = 'sdlc') {
  return {
    ok: findings.every((item) => !['blocker', 'high'].includes(item.severity)),
    profile,
    findings,
  }
}

function hasLabel(issue, name) {
  return (issue.labels || []).some(
    (label) => (typeof label === 'string' ? label : label.name) === name,
  )
}
