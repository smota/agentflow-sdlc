import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const DEFAULT_TELEMETRY_DIR = '.agentflow/telemetry'

/**
 * Safely parses JSON lines from string content, ignoring malformed lines.
 */
export function parseJsonLines(content) {
  if (!content || typeof content !== 'string') return []
  const lines = content.split('\n')
  const records = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // Ignore partially written / truncated JSONL lines
    }
  }
  return records
}

/**
 * Extracts command execution status from tool calls or direct event records.
 */
function extractCommandResult(record) {
  // Check if this record is a tool call or result
  const toolCalls = Array.isArray(record.tool_calls)
    ? record.tool_calls
    : record.tool_call
      ? [record.tool_call]
      : []

  const results = []

  for (const tc of toolCalls) {
    const cmd =
      tc?.args?.CommandLine ||
      tc?.args?.command ||
      tc?.command ||
      (tc?.name === 'run_command' ? tc?.args?.cmd : null)

    if (cmd) {
      const exitCode =
        tc?.result?.exit_code !== undefined
          ? tc.result.exit_code
          : tc?.exit_code !== undefined
            ? tc.exit_code
            : tc?.status === 'ERROR'
              ? 1
              : 0

      results.push({
        command: String(cmd).slice(0, 120),
        exitCode: Number(exitCode),
        failed: Number(exitCode) !== 0,
      })
    }
  }

  // Also check direct shell event records
  if (record.command || record.cmd) {
    const cmd = record.command || record.cmd
    const exitCode = record.exit_code !== undefined ? record.exit_code : record.exitCode || 0
    results.push({
      command: String(cmd).slice(0, 120),
      exitCode: Number(exitCode),
      failed: Number(exitCode) !== 0,
    })
  }

  return results
}

/**
 * Extracts token usage from standard model responses or OpenRig records.
 */
function extractTokens(record) {
  const usage = record.usage || record.tokens || {}
  const prompt =
    usage.prompt_tokens ??
    usage.promptTokens ??
    usage.input_tokens ??
    usage.inputTokens ??
    usage.prompt ??
    0

  const completion =
    usage.completion_tokens ??
    usage.completionTokens ??
    usage.output_tokens ??
    usage.outputTokens ??
    usage.completion ??
    0

  return {
    promptTokens: Number(prompt) || 0,
    completionTokens: Number(completion) || 0,
    totalTokens: (Number(prompt) || 0) + (Number(completion) || 0),
  }
}

/**
 * Ingests a collection of transcript records and aggregates execution metrics.
 */
export function aggregateTraceRecords(records = [], runId = 'unknown') {
  let totalTurns = 0
  let promptTokens = 0
  let completionTokens = 0
  let commandExecutions = 0
  let commandFailures = 0
  let reworkCount = 0
  let freezeCount = 0
  let unfreezeCount = 0
  let circuitBreakerTrips = 0

  const turnsByRole = {}
  const tokensByRole = {}
  const commandsByRole = {}
  const byPhase = {}
  const failedCommands = []
  const eventTimeline = []

  let firstTimestamp = null
  let lastTimestamp = null

  for (const record of records) {
    if (!record || typeof record !== 'object') continue

    // Track timestamps
    const ts = record.created_at || record.timestamp || record.time
    if (ts) {
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts
    }

    const role =
      record.role ||
      record.seat ||
      record.source_role ||
      (record.source === 'USER_EXPLICIT' ? 'user' : 'agentflow')

    const phase =
      record.phase !== undefined
        ? String(record.phase)
        : record.sdlc_phase !== undefined
          ? String(record.sdlc_phase)
          : 'unknown'

    // Count turns
    const isTurn =
      record.type === 'PLANNER_RESPONSE' ||
      record.type === 'USER_INPUT' ||
      record.type === 'turn' ||
      record.event === 'turn' ||
      record.turn !== undefined

    if (isTurn) {
      totalTurns++
      turnsByRole[role] = (turnsByRole[role] || 0) + 1
      byPhase[phase] = (byPhase[phase] || 0) + 1
    }

    // Accumulate tokens
    const tokens = extractTokens(record)
    promptTokens += tokens.promptTokens
    completionTokens += tokens.completionTokens

    if (tokens.totalTokens > 0) {
      tokensByRole[role] = (tokensByRole[role] || 0) + tokens.totalTokens
    }

    // Commands & errors
    const cmdResults = extractCommandResult(record)
    for (const res of cmdResults) {
      commandExecutions++
      commandsByRole[role] = (commandsByRole[role] || 0) + 1
      if (res.failed) {
        commandFailures++
        failedCommands.push({
          command: res.command,
          exitCode: res.exitCode,
          role,
          phase,
          timestamp: ts,
        })
      }
    }

    // Protocol events: rework, freeze, unfreeze, circuit-breaker
    const eventType = (record.event || record.type || '').toLowerCase()
    if (eventType.includes('rework') || record.isRework || record.reworkCount) {
      reworkCount++
      eventTimeline.push({
        event: 'rework',
        role,
        phase,
        timestamp: ts,
        details: record.reason || record.details,
      })
    }

    if (eventType.includes('freeze') && !eventType.includes('unfreeze')) {
      freezeCount++
      if (record.circuitBreaker || record.reason?.includes('circuit_breaker')) {
        circuitBreakerTrips++
      }
      eventTimeline.push({ event: 'freeze', role, phase, timestamp: ts, reason: record.reason })
    }

    if (eventType.includes('unfreeze')) {
      unfreezeCount++
      eventTimeline.push({
        event: 'unfreeze',
        role,
        phase,
        timestamp: ts,
        resolution: record.resolutionId,
      })
    }
  }

  const failureRate =
    commandExecutions > 0 ? Number((commandFailures / commandExecutions).toFixed(4)) : 0

  return {
    runId,
    extractedAt: new Date().toISOString(),
    timeRange: {
      startedAt: firstTimestamp,
      endedAt: lastTimestamp,
    },
    summary: {
      totalTurns,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      commands: {
        total: commandExecutions,
        failures: commandFailures,
        failureRate,
      },
      processHealth: {
        reworkCount,
        freezeCount,
        unfreezeCount,
        circuitBreakerTrips,
      },
    },
    breakdown: {
      turnsByRole,
      tokensByRole,
      commandsByRole,
      turnsByPhase: byPhase,
    },
    failedCommands,
    eventTimeline,
  }
}

/**
 * Discovers and parses trace files from paths or directory.
 */
export function extractSessionTelemetry(options = {}) {
  const runId = options.runId || `run-${Date.now().toString(36)}`
  const inputs = options.inputs || options.traces || []
  const filesToRead = []

  for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
    const target = resolve(options.targetDir || process.cwd(), input)
    if (!existsSync(target)) continue

    const stat = statSync(target)
    if (stat.isDirectory()) {
      const entries = readdirSync(target)
      for (const entry of entries) {
        if (entry.endsWith('.jsonl') || entry.endsWith('.log')) {
          filesToRead.push(join(target, entry))
        }
      }
    } else if (stat.isFile()) {
      filesToRead.push(target)
    }
  }

  const allRecords = []
  for (const file of filesToRead) {
    try {
      const content = readFileSync(file, 'utf8')
      const records = parseJsonLines(content)
      allRecords.push(...records)
    } catch {
      // Ignore unreadable files
    }
  }

  const digest = aggregateTraceRecords(allRecords, runId)

  if (options.save !== false) {
    saveTelemetryDigest(digest, options)
  }

  return digest
}

/**
 * Saves a telemetry digest to .agentflow/telemetry/run-<run-id>.json
 */
export function saveTelemetryDigest(digest, options = {}) {
  const telemetryDir = resolve(
    options.targetDir || process.cwd(),
    options.outDir || options.telemetryDir || DEFAULT_TELEMETRY_DIR,
  )

  mkdirSync(telemetryDir, { recursive: true })
  const outPath = join(telemetryDir, `${digest.runId}.json`)
  writeFileSync(outPath, JSON.stringify(digest, null, 2), 'utf8')
  return outPath
}

/**
 * Loads a telemetry digest from disk.
 */
export function loadTelemetryDigest(runId, options = {}) {
  const telemetryDir = resolve(
    options.targetDir || process.cwd(),
    options.telemetryDir || DEFAULT_TELEMETRY_DIR,
  )
  const filePath = join(telemetryDir, runId.endsWith('.json') ? runId : `${runId}.json`)
  if (!existsSync(filePath)) return null
  return JSON.parse(readFileSync(filePath, 'utf8'))
}
