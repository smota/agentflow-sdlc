import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export const DEFAULT_MARKER_PATH = '.agentflow/dogfood/last-run-marker.json'

/**
 * Classifies a repo file path into a functional subsystem module.
 */
export function classifyModule(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('__tests__') || normalized.startsWith('tests/')) return 'tests'
  if (normalized.startsWith('bin/') || normalized.startsWith('scripts/cli/')) return 'cli'
  if (normalized.startsWith('adapters/')) return 'adapters'
  if (normalized.startsWith('skills/')) return 'skills'
  if (normalized.startsWith('lib/core/')) return 'lib/core'
  if (normalized.startsWith('lib/providers/')) return 'lib/providers'
  if (normalized.startsWith('lib/services/')) return 'lib/services'
  if (normalized.startsWith('lib/')) return 'lib'
  if (normalized.startsWith('schemas/')) return 'schemas'
  if (normalized.startsWith('manifests/')) return 'manifests'
  if (normalized.startsWith('docs/')) return 'docs'
  if (normalized.startsWith('scripts/dogfood/')) return 'dogfood'
  if (normalized.startsWith('scripts/telemetry/')) return 'telemetry'
  if (normalized.startsWith('scripts/')) return 'scripts'
  return 'root'
}

/**
 * Evaluates blast radius level based on changed files, count, and affected modules.
 */
export function calculateBlastRadius({ files = [], insertions = 0, deletions = 0 } = {}) {
  const modules = Array.from(new Set(files.map(classifyModule))).sort()
  const filesChanged = files.length

  let level = 'low'
  const isHighRiskModule = modules.some((m) =>
    ['cli', 'lib/core', 'schemas', 'manifests'].includes(m),
  )

  if (filesChanged > 20 || (isHighRiskModule && filesChanged >= 8) || modules.length >= 4) {
    level = 'high'
  } else if (filesChanged >= 5 || isHighRiskModule || modules.length >= 3) {
    level = 'medium'
  }

  return {
    level,
    modules,
    filesChanged,
    insertions,
    deletions,
    changedFiles: files,
  }
}

/**
 * Extracts issue numbers from commit messages or PR text (e.g. Closes #123, Fixes #456).
 */
export function extractIssueReferences(text) {
  if (typeof text !== 'string') return []
  const pattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|see)\s+#([0-9]+)/gi
  const matches = new Set()
  let match
  while ((match = pattern.exec(text)) !== null) {
    matches.add(Number(match[1]))
  }
  return Array.from(matches).sort((a, b) => a - b)
}

/**
 * Extracts PR number from commit messages (e.g. "feat (#123)" or "pull request ...#123").
 */
export function extractPrNumber(text) {
  if (typeof text !== 'string') return null
  const prPattern = /\(#([0-9]+)\)$/m
  const prMatch = prPattern.exec(text)
  if (prMatch) return Number(prMatch[1])

  const mergePattern = /pull request [^#\s]+#([0-9]+)/i
  const mergeMatch = mergePattern.exec(text)
  if (mergeMatch) return Number(mergeMatch[1])

  return null
}

/**
 * Parses markdown issue body to extract Acceptance Criteria and Anti-Goals / Out-of-Scope items.
 */
export function extractIssueCriteriaAndAntiGoals(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return { acceptanceCriteria: [], antiGoals: [] }
  }

  const lines = markdown.split(/\r?\n/)
  const acceptanceCriteria = []
  const antiGoals = []

  let currentSection = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Detect section headers
    if (/^#{1,4}\s+(.*)/i.test(line)) {
      const headerText = line
        .replace(/^#{1,4}\s+/, '')
        .trim()
        .toLowerCase()
      if (
        headerText.includes('acceptance') ||
        headerText.includes('criteria') ||
        headerText.includes('boundaries')
      ) {
        currentSection = 'criteria'
      } else if (
        headerText.includes('anti-goal') ||
        headerText.includes('anti goal') ||
        headerText.includes('out of scope') ||
        headerText.includes('exclusions') ||
        headerText.includes('non-goal')
      ) {
        currentSection = 'antigoals'
      } else {
        currentSection = null
      }
      continue
    }

    if (!currentSection) continue

    // Detect list items or bullet points
    if (/^[-*+]\s+(.*)/.test(line) || /^[0-9]+\.\s+(.*)/.test(line)) {
      const cleanItem = line
        .replace(/^[-*+]\s+/, '')
        .replace(/^[0-9]+\.\s+/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .trim()
      if (cleanItem.length > 0) {
        if (currentSection === 'criteria') {
          acceptanceCriteria.push(cleanItem)
        } else if (currentSection === 'antigoals') {
          antiGoals.push(cleanItem)
        }
      }
    } else if (
      line.length > 0 &&
      (line.startsWith('Given ') || line.startsWith('When ') || line.startsWith('Then '))
    ) {
      if (currentSection === 'criteria') {
        acceptanceCriteria.push(line)
      }
    }
  }

  return { acceptanceCriteria, antiGoals }
}

/**
 * Extracts accepted review trade-offs, deferred items, and caveats from PR body and comments.
 */
export function extractPrLimitations(prData = {}) {
  const limitations = []
  const prNum = prData.number || 'unknown'

  // Inspect PR body
  const body = String(prData.body || '')
  const followUpPattern = /##\s+Follow-up issues\s*\n+([\s\S]*?)(?=\n##\s+|$)/i
  const followUpMatch = followUpPattern.exec(body)
  if (followUpMatch) {
    const rawText = followUpMatch[1].trim()
    if (rawText && !/^none/i.test(rawText)) {
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      const followUpLines = lines.filter(
        (l) => !/(?:accepted limitation|known issue|deferred scope|trade-off|waiver):/i.test(l),
      )
      const cleanFollowUp = followUpLines.join('\n').trim()
      if (cleanFollowUp && !/^none/i.test(cleanFollowUp)) {
        limitations.push({
          source: `pr:${prNum}:body`,
          type: 'deferred-scope',
          text: cleanFollowUp,
        })
      }
    }
  }

  const explicitLimitationPattern =
    /(?:accepted limitation|known issue|deferred scope|trade-off|waiver):\s*([^\n\r.]+)/gi
  let m
  while ((m = explicitLimitationPattern.exec(body)) !== null) {
    limitations.push({
      source: `pr:${prNum}:body`,
      type: 'accepted-limitation',
      text: m[1].trim(),
    })
  }

  // Inspect comments
  for (const comment of prData.comments || []) {
    const commentBody = String(comment.body || '')
    const author = comment.author?.login || 'reviewer'
    let cm
    while ((cm = explicitLimitationPattern.exec(commentBody)) !== null) {
      limitations.push({
        source: `pr:${prNum}:comment:@${author}`,
        type: 'accepted-limitation',
        text: cm[1].trim(),
      })
    }
    if (/(?:defer(?:red)? to #([0-9]+)|addressed in #([0-9]+))/i.test(commentBody)) {
      limitations.push({
        source: `pr:${prNum}:comment:@${author}`,
        type: 'deferred-scope',
        text: commentBody.trim(),
      })
    }
  }

  return limitations
}

/**
 * Builds exclusion filter entries from anti-goals and accepted limitations.
 */
export function buildExclusionFilters({ antiGoals = [], acceptedLimitations = [] } = {}) {
  const filters = []

  antiGoals.forEach((antiGoal, idx) => {
    const str = String(antiGoal).trim()
    if (str) {
      filters.push({
        filterId: `anti-goal-${idx + 1}`,
        kind: 'anti-goal',
        pattern: str,
        reason: `Explicit anti-goal: ${str}`,
      })
    }
  })

  acceptedLimitations.forEach((lim, idx) => {
    filters.push({
      filterId: `limitation-${idx + 1}`,
      kind: lim.type || 'accepted-limitation',
      pattern: lim.text,
      source: lim.source,
      reason: `Review caveat / deferred scope: ${lim.text}`,
    })
  })

  return filters
}

/**
 * Loads the last dogfood run marker from disk.
 */
export function loadLastDogfoodMarker(markerPath, { fs = { existsSync, readFileSync } } = {}) {
  if (!fs.existsSync(markerPath)) return null
  try {
    const content = fs.readFileSync(markerPath, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Saves the dogfood run marker to disk.
 */
export function saveDogfoodMarker(
  markerPath,
  markerData = {},
  { fs = { mkdirSync, writeFileSync } } = {},
) {
  const parent = dirname(resolve(markerPath))
  fs.mkdirSync(parent, { recursive: true })
  fs.writeFileSync(markerPath, JSON.stringify(markerData, null, 2), 'utf8')
}

/**
 * Resolves commit delta and git stats between sinceRef and headRef.
 */
export function readGitDelta({
  since,
  head = 'HEAD',
  repoRoot = process.cwd(),
  exec = execFileSync,
} = {}) {
  const resolvedHead = exec('git', ['rev-parse', head], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()

  let resolvedSince = since
  if (!resolvedSince) {
    // If no since marker, default to parent of head or HEAD~1
    try {
      resolvedSince = exec('git', ['rev-parse', `${resolvedHead}~1`], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim()
    } catch {
      resolvedSince = resolvedHead
    }
  } else {
    resolvedSince = exec('git', ['rev-parse', resolvedSince], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
  }

  if (resolvedSince === resolvedHead) {
    return {
      since: resolvedSince,
      head: resolvedHead,
      commits: [],
      changedFiles: [],
      insertions: 0,
      deletions: 0,
    }
  }

  // Extract commit log
  const logFormat = '%H%x00%an%x00%ae%x00%at%x00%s%x00%b%x1e'
  const rawLog = exec(
    'git',
    ['log', `${resolvedSince}..${resolvedHead}`, `--pretty=format:${logFormat}`],
    { cwd: repoRoot, encoding: 'utf8' },
  )

  const rawCommits = rawLog
    .split('\x1e')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)

  const commits = rawCommits.map((chunk) => {
    const [sha, authorName, authorEmail, timestampStr, subject, body] = chunk.split('\x00')
    const fullText = `${subject || ''}\n${body || ''}`
    return {
      sha,
      author: { name: authorName, email: authorEmail },
      timestamp: Number(timestampStr) ? new Date(Number(timestampStr) * 1000).toISOString() : null,
      subject: subject || '',
      body: body || '',
      closesIssues: extractIssueReferences(fullText),
      prNumber: extractPrNumber(fullText),
    }
  })

  // Extract changed files and stats
  const diffOutput = exec('git', ['diff', '--name-only', `${resolvedSince}..${resolvedHead}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const changedFiles = diffOutput
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0)

  let insertions = 0
  let deletions = 0
  try {
    const numstat = exec('git', ['diff', '--numstat', `${resolvedSince}..${resolvedHead}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    for (const line of numstat.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        insertions += Number(parts[0]) || 0
        deletions += Number(parts[1]) || 0
      }
    }
  } catch {
    // numstat optional
  }

  return {
    since: resolvedSince,
    head: resolvedHead,
    commits,
    changedFiles,
    insertions,
    deletions,
  }
}

/**
 * Builds the complete dogfood surface manifest.
 */
export async function generateDogfoodSurface({
  since,
  head = 'HEAD',
  repoRoot = process.cwd(),
  markerPath = DEFAULT_MARKER_PATH,
  fetchIssue = null,
  fetchPr = null,
  exec = execFileSync,
  fs = { existsSync, readFileSync, writeFileSync, mkdirSync },
} = {}) {
  let effectiveSince = since
  if (!effectiveSince) {
    const marker = loadLastDogfoodMarker(resolve(repoRoot, markerPath), { fs })
    if (marker?.lastHead) {
      effectiveSince = marker.lastHead
    }
  }

  const gitDelta = readGitDelta({
    since: effectiveSince,
    head,
    repoRoot,
    exec,
  })

  const blastRadius = calculateBlastRadius({
    files: gitDelta.changedFiles,
    insertions: gitDelta.insertions,
    deletions: gitDelta.deletions,
  })

  // Collect all PR numbers
  const prNumbers = Array.from(
    new Set(gitDelta.commits.map((c) => c.prNumber).filter((n) => typeof n === 'number')),
  ).sort((a, b) => a - b)

  const acceptedLimitations = []
  const prClosedIssues = []

  for (const prNum of prNumbers) {
    let prData = null
    if (typeof fetchPr === 'function') {
      try {
        prData = await fetchPr(prNum)
      } catch {
        // fallback
      }
    } else {
      try {
        const out = exec(
          'gh',
          ['pr', 'view', String(prNum), '--json', 'number,title,body,comments,reviews'],
          {
            cwd: repoRoot,
            encoding: 'utf8',
          },
        )
        prData = JSON.parse(out)
      } catch {
        // skip
      }
    }

    if (prData) {
      const lims = extractPrLimitations(prData)
      acceptedLimitations.push(...lims)
      if (prData.body) {
        prClosedIssues.push(...extractIssueReferences(prData.body))
      }
    }
  }

  // Collect all unique closed issue numbers from commits and PR bodies
  const issueNumbers = Array.from(
    new Set([...gitDelta.commits.flatMap((c) => c.closesIssues), ...prClosedIssues]),
  ).sort((a, b) => a - b)

  const correlatedIssues = []
  const antiGoalsCollected = []

  for (const issueNum of issueNumbers) {
    let issueData = null
    if (typeof fetchIssue === 'function') {
      try {
        issueData = await fetchIssue(issueNum)
      } catch {
        // fallback
      }
    } else {
      try {
        const out = exec(
          'gh',
          ['issue', 'view', String(issueNum), '--json', 'number,title,body,labels,state'],
          {
            cwd: repoRoot,
            encoding: 'utf8',
          },
        )
        issueData = JSON.parse(out)
      } catch {
        // skip if offline/mock
      }
    }

    if (issueData) {
      const extracted = extractIssueCriteriaAndAntiGoals(issueData.body || '')
      correlatedIssues.push({
        number: issueData.number || issueNum,
        title: issueData.title || '',
        state: issueData.state || 'closed',
        acceptanceCriteria: extracted.acceptanceCriteria,
        antiGoals: extracted.antiGoals,
      })
      antiGoalsCollected.push(...extracted.antiGoals)
    } else {
      correlatedIssues.push({
        number: issueNum,
        title: `Issue #${issueNum}`,
        state: 'closed',
        acceptanceCriteria: [],
        antiGoals: [],
      })
    }
  }

  const exclusionFilters = buildExclusionFilters({
    antiGoals: antiGoalsCollected,
    acceptedLimitations,
  })

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    range: {
      since: gitDelta.since,
      head: gitDelta.head,
      commitCount: gitDelta.commits.length,
    },
    commits: gitDelta.commits,
    correlatedIssues,
    acceptedLimitations,
    blastRadius,
    exclusionFilters,
  }
}
