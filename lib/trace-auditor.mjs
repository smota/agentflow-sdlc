import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkPathOwnership, loadPathOwnership } from '../scripts/validate-path-ownership.mjs'

export const VIOLATION_SEVERITIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
}

export const SUPERVISORY_VERBS = [
  'steer assign',
  'steer unfreeze',
  'steer triage',
  'steer merge-check',
  'scripts/steer.mjs',
]

export const STEERING_PERSONAS = [
  'steer.lead',
  'orch.steer',
  'steer-lead',
  'orch-steer',
  'supervisory lead',
]

/**
 * Normalizes tool call file targets from tool arguments.
 */
function extractTargetFiles(toolCall) {
  const args = toolCall?.args || {}
  const targets = []

  if (args.TargetFile) targets.push(args.TargetFile)
  if (args.path) targets.push(args.path)
  if (args.file) targets.push(args.file)
  if (args.filePath) targets.push(args.filePath)

  // Detect shell redirects to files: > path or >> path
  const cmd = args.CommandLine || args.command || toolCall?.command
  if (cmd && typeof cmd === 'string') {
    const redirectMatches = cmd.match(/(?:>|>>)\s*([^\s;&|]+)/g)
    if (redirectMatches) {
      for (const m of redirectMatches) {
        const cleanPath = m.replace(/^(?:>>|>)\s*/, '').trim()
        if (cleanPath && !cleanPath.startsWith('/dev/')) {
          targets.push(cleanPath)
        }
      }
    }
  }

  return targets
}

/**
 * Checks if a command represents a git commit.
 */
function isGitCommitCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false
  return (
    /(?:^|\s|;)git\s+commit\b/.test(cmd) &&
    !/(?:git\s+log|git\s+show|git\s+status|git\s+diff)/.test(cmd)
  )
}

/**
 * Checks if a command represents an external supervisory steering verb.
 */
function isSupervisoryVerbCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false
  return SUPERVISORY_VERBS.some((verb) => cmd.includes(verb))
}

/**
 * Audits transcript records for protocol deviations, path-ownership violations,
 * persona drift, and decider-port bypass attempts.
 */
export function auditTraceRecords(records = [], options = {}) {
  const packageRoot = options.packageRoot || process.cwd()
  let manifest = options.manifest
  if (!manifest) {
    try {
      manifest = loadPathOwnership(packageRoot)
    } catch {
      manifest = { rules: [] }
    }
  }

  const violations = []
  let recordIndex = 0

  for (const record of records) {
    recordIndex++
    if (!record || typeof record !== 'object') continue

    const seat =
      record.seat ||
      record.role ||
      record.source_role ||
      (record.source === 'USER_EXPLICIT' ? 'user' : 'unknown')

    const stepIndex = record.step_index ?? record.step ?? recordIndex
    const timestamp = record.created_at || record.timestamp || null

    const toolCalls = Array.isArray(record.tool_calls)
      ? record.tool_calls
      : record.tool_call
        ? [record.tool_call]
        : []

    // 1. Audit Tool Calls: Path Ownership & File Writes
    for (const tc of toolCalls) {
      const tcName = tc.name || ''
      const isWriteTool =
        tcName === 'write_to_file' ||
        tcName === 'replace_file_content' ||
        tcName.includes('write') ||
        tcName.includes('edit')

      const targets = extractTargetFiles(tc)

      if (isWriteTool && targets.length > 0 && seat !== 'unknown' && seat !== 'user') {
        const ownershipCheck = checkPathOwnership({ seat, paths: targets, manifest })
        if (!ownershipCheck.ok) {
          for (const err of ownershipCheck.errors) {
            violations.push({
              severity: VIOLATION_SEVERITIES.HIGH,
              category: 'path-ownership-violation',
              seat,
              stepIndex,
              timestamp,
              finding: `Unauthorized file write attempted by ${seat}`,
              evidence: err,
              toolCall: tcName,
            })
          }
        }
      }

      // Check command inside tool call
      const cmd = tc?.args?.CommandLine || tc?.args?.command || tc?.command
      if (cmd) {
        // 2. Audit Git Commit by Non-Builder Seats
        if (isGitCommitCommand(cmd)) {
          const isBuilder =
            seat.startsWith('dev.build') ||
            seat === 'dev.test-eng' ||
            seat === 'build' ||
            seat === 'build-jr' ||
            seat === 'build-sr' ||
            seat === 'test-eng'

          if (!isBuilder) {
            violations.push({
              severity: VIOLATION_SEVERITIES.HIGH,
              category: 'unauthorized-git-commit',
              seat,
              stepIndex,
              timestamp,
              finding: `Non-builder seat ${seat} attempted to execute git commit`,
              evidence: `Command: ${String(cmd).slice(0, 100)}`,
            })
          }
        }

        // 3. Audit Decider Port / Supervisory Steer Verbs by In-Rig Seats
        if (isSupervisoryVerbCommand(cmd)) {
          const isSteerLead = seat === 'steer.lead' || seat === 'steer-lead'
          if (!isSteerLead) {
            violations.push({
              severity: VIOLATION_SEVERITIES.CRITICAL,
              category: 'decider-port-bypass',
              seat,
              stepIndex,
              timestamp,
              finding: `In-rig seat ${seat} attempted to execute external supervisory verb out-of-turn`,
              evidence: `Command: ${String(cmd).slice(0, 100)}`,
            })
          }
        }
      }
    }

    // Direct shell commands in record
    if (record.command || record.cmd) {
      const cmd = record.command || record.cmd
      if (isGitCommitCommand(cmd)) {
        const isBuilder =
          seat.startsWith('dev.build') ||
          seat === 'dev.test-eng' ||
          seat === 'build' ||
          seat === 'build-jr' ||
          seat === 'build-sr' ||
          seat === 'test-eng'

        if (!isBuilder) {
          violations.push({
            severity: VIOLATION_SEVERITIES.HIGH,
            category: 'unauthorized-git-commit',
            seat,
            stepIndex,
            timestamp,
            finding: `Non-builder seat ${seat} attempted to execute git commit`,
            evidence: `Command: ${String(cmd).slice(0, 100)}`,
          })
        }
      }

      if (isSupervisoryVerbCommand(cmd)) {
        const isSteerLead = seat === 'steer.lead' || seat === 'steer-lead'
        if (!isSteerLead) {
          violations.push({
            severity: VIOLATION_SEVERITIES.CRITICAL,
            category: 'decider-port-bypass',
            seat,
            stepIndex,
            timestamp,
            finding: `In-rig seat ${seat} attempted to execute external supervisory verb out-of-turn`,
            evidence: `Command: ${String(cmd).slice(0, 100)}`,
          })
        }
      }
    }

    // 4. Audit Steering Persona Hallucinations & Role Confusion
    const textContent = [record.thinking, record.content].filter(Boolean).join('\n')
    if (textContent && seat !== 'steer.lead' && seat !== 'steer-lead' && seat !== 'user') {
      // Check if in-rig seat asserts it is the steering supervisor
      const claimsSteerPersona =
        /\b(?:I am|acting as|as the|as)\s+(?:orch\.steer|steer\.lead|supervisory lead)\b/i.test(
          textContent,
        ) ||
        /\b(?:unfreezing the ledger myself|granting self-approval|overriding steering gate)\b/i.test(
          textContent,
        )

      if (claimsSteerPersona) {
        violations.push({
          severity: VIOLATION_SEVERITIES.CRITICAL,
          category: 'steering-persona-hallucination',
          seat,
          stepIndex,
          timestamp,
          finding: `In-rig seat ${seat} hallucinated supervisory persona or attempted self-unfreeze`,
          evidence: textContent.slice(0, 150),
        })
      }

      // Check deprecated role naming (orch.steer instead of steer.lead)
      if (/\borch\.steer\b/.test(textContent)) {
        violations.push({
          severity: VIOLATION_SEVERITIES.LOW,
          category: 'deprecated-role-reference',
          seat,
          stepIndex,
          timestamp,
          finding: `Deprecated role identifier orch.steer referenced; should use steer.lead`,
          evidence: `Reference found in text content`,
        })
      }
    }
  }

  const counts = {
    critical: violations.filter((v) => v.severity === VIOLATION_SEVERITIES.CRITICAL).length,
    high: violations.filter((v) => v.severity === VIOLATION_SEVERITIES.HIGH).length,
    medium: violations.filter((v) => v.severity === VIOLATION_SEVERITIES.MEDIUM).length,
    low: violations.filter((v) => v.severity === VIOLATION_SEVERITIES.LOW).length,
    total: violations.length,
  }

  return {
    auditedAt: new Date().toISOString(),
    totalRecords: records.length,
    verdict: counts.critical > 0 || counts.high > 0 ? 'FAIL' : 'PASS',
    counts,
    violations,
  }
}
