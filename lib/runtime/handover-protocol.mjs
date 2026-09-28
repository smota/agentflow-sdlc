import {
  cleanupGitLocks,
  compressContextPayload,
  normalizePathToPosix,
  scrubObject,
  scrubSecretsAndPii,
} from './context-sanitizer.mjs'
import {
  acquireLease,
  assertLeaseValid,
  createLease,
  DEFAULT_LEASE_TTL_MS,
} from './lease-fencing.mjs'

export const HANDOVER_REASONS = Object.freeze({
  AGENT_SWITCH: 'agent_switch',
  RATE_LIMIT_429: 'rate_limit_429',
  WORKSTATION_MIGRATION: 'workstation_migration',
  SCHEDULED_HANDOFF: 'scheduled_handoff',
})

/**
 * Creates a sanitized, token-budgeted handover packet for cross-machine / cross-agent continuation.
 */
export function createHandoffPacket({
  taskId,
  issueId,
  fromAgent,
  toAgent,
  currentBranch,
  wipBranch = null,
  fencingToken = 1,
  statusSummary = '',
  uncommittedChanges = [],
  reason = HANDOVER_REASONS.AGENT_SWITCH,
  activeLease = null,
  timestamp = new Date().toISOString(),
  maxChars = 60000,
} = {}) {
  if (!taskId) throw new Error('taskId is required to create handoff packet')

  const effectiveWipBranch = wipBranch || `wip/${taskId}`
  const rawPacket = {
    taskId,
    issueId: issueId || taskId,
    fromAgent: fromAgent || 'unspecified-agent',
    toAgent: toAgent || 'unspecified-agent',
    currentBranch: currentBranch || 'development',
    wipBranch: effectiveWipBranch,
    fencingToken,
    reason,
    timestamp,
    statusSummary,
    uncommittedChanges: (uncommittedChanges || []).map((ch) => ({
      file: normalizePathToPosix(ch.file || ch.path || ''),
      status: ch.status || 'modified',
      diff: ch.diff || '',
    })),
  }

  const { payload, compressed, estimatedTokens } = compressContextPayload(rawPacket, { maxChars })

  const markdownSummary = [
    `<!-- agentflow:handover-packet -->`,
    `### Agent Handoff Packet: Task ${taskId}`,
    `- **From Agent:** ${payload.fromAgent}`,
    `- **To Agent:** ${payload.toAgent}`,
    `- **Handover Reason:** \`${payload.reason}\``,
    `- **Active Branch:** \`${payload.currentBranch}\``,
    `- **WIP Remote Branch:** \`${payload.wipBranch}\``,
    `- **Fencing Token:** \`${payload.fencingToken}\``,
    `- **Timestamp:** ${payload.timestamp}`,
    `- **Estimated Context Tokens:** ~${estimatedTokens}`,
    ``,
    `#### Status Summary`,
    payload.statusSummary || '_No additional notes provided._',
    ``,
    `#### Machine-Readable State Payload`,
    '```json:handover-payload',
    JSON.stringify(payload, null, 2),
    '```',
    `<!-- /agentflow:handover-packet -->`,
  ].join('\n')

  return {
    packet: payload,
    markdown: markdownSummary,
    compressed,
    estimatedTokens,
  }
}

/**
 * Parses machine-readable handover packet from issue comments or Markdown strings.
 */
export function parseHandoffPacket(markdown) {
  if (typeof markdown !== 'string') return null
  const regex = /```json:handover-payload\s*([\s\S]*?)\s*```/
  const match = markdown.match(regex)
  if (!match) return null

  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/**
 * Resumes execution from a handover packet:
 * - Cleans stale git lock files
 * - Validates fencing lease
 * - Acquires new lease token
 * - Returns resumption environment context
 */
export function resumeHandoff() {
  throw new Error('Legacy packet cannot authorize recovery; use source-backed run resume')
}
