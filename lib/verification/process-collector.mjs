import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  openSync,
  closeSync,
  unlinkSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { recordDigest } from '../core/record-digest.mjs'
import { sealDeliveryRecord, requireText, requireUnique } from '../core/delivery-record.mjs'
import { fingerprintCandidate, containedPath } from './workspace.mjs'
import { parseJUnitAssertions } from './junit-report.mjs'
import { resolveExecutable } from '../environment.mjs'

function executionEnvironment(definition) {
  return {
    ...Object.fromEntries(
      [
        'PATH',
        'Path',
        'PATHEXT',
        'SystemRoot',
        'WINDIR',
        'ComSpec',
        ...(definition.inheritEnv ?? []),
      ]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    ...(definition.env ?? {}),
  }
}

export function inspectProcessRuntime(root, definition) {
  const resolved = resolveExecutable(definition.executable, {
    cwd: root,
    env: executionEnvironment(definition),
  })
  if (!resolved) throw new Error('Executable runtime unavailable')
  const executablePath = resolved,
    canonicalPath = realpathSync(resolved),
    info = statSync(canonicalPath)
  if (!info.isFile() || info.size > 512 * 1024 * 1024)
    throw new Error('Executable runtime cannot be fingerprinted')
  return {
    executablePath,
    identity: sealDeliveryRecord('execution-context', {
      platform: process.platform,
      architecture: process.arch,
      collectorRuntime: process.version,
      executablePathDigest: recordDigest(executablePath),
      canonicalPathDigest: recordDigest(canonicalPath),
      executableContentDigest: createHash('sha256')
        .update(readFileSync(canonicalPath))
        .digest('hex'),
    }),
  }
}

export function collectProcessObservation({ root, definition, boundary, runner = spawnSync }) {
  if (!['mutate-worktree', 'open-pr', 'external-action'].includes(boundary))
    throw new Error('Process verification requires execution authority')
  const lock = containedPath(root, '.agent-runs/workspace-writer.lock', { allowMissing: true })
  mkdirSync(containedPath(root, '.agent-runs', { allowMissing: true }), { recursive: true })
  const descriptor = openSync(lock, 'wx', 0o600)
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({
        host: hostname(),
        pid: process.pid,
        instance: randomUUID(),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        kind: 'verification',
      }),
      { flush: true },
    )
    return collect({ root, definition, runner })
  } finally {
    closeSync(descriptor)
    unlinkSync(containedPath(root, lock))
  }
}

function collect({ root, definition, runner }) {
  requireText(definition.id, 'check id')
  requireText(definition.criterionId, 'criterionId')
  requireText(definition.executable, 'executable')
  if (!Array.isArray(definition.args) || definition.args.some((arg) => typeof arg !== 'string'))
    throw new Error('Arguments must be a string array')
  requireUnique(definition.assertions, 'assertions')
  if (
    !definition.assertions.length ||
    definition.assertions.some((id) => typeof id !== 'string' || !id)
  )
    throw new Error('Expected assertions required')
  if (
    !Number.isInteger(definition.timeoutMs) ||
    definition.timeoutMs < 1 ||
    definition.timeoutMs > 3600000
  )
    throw new Error('Bounded timeout required')
  const before = fingerprintCandidate(root, definition)
  const runtime = inspectProcessRuntime(root, definition)
  const invocationId = randomUUID()
  const outputDir = containedPath(root, `.agent-runs/verification/${invocationId}`, {
    allowMissing: true,
  })
  mkdirSync(outputDir, { recursive: true })
  const reportPath = containedPath(root, resolve(outputDir, 'report.json'), { allowMissing: true })
  const startedAt = new Date().toISOString()
  const execution = runner(runtime.executablePath, definition.args, {
    cwd: resolve(root),
    shell: false,
    encoding: 'utf8',
    timeout: definition.timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      ...executionEnvironment(definition),
      TEMP: outputDir,
      TMP: outputDir,
      AGENTFLOW_INVOCATION_ID: invocationId,
      AGENTFLOW_REPORT_PATH: reportPath,
    },
  })
  const errors = []
  let assertions = []
  if (execution.error || execution.status !== 0)
    errors.push('Check process failed, timed out or was interrupted')
  try {
    if (definition.format === 'junit-stdout') assertions = parseJUnitAssertions(execution.stdout)
    else {
      if (definition.format && definition.format !== 'structured')
        throw new Error('Unsupported report format')
      containedPath(root, reportPath)
      if (!lstatSync(reportPath).isFile() || lstatSync(reportPath).size > 1024 * 1024)
        throw new Error('Invalid report file')
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      if (report.invocationId !== invocationId)
        throw new Error('Report belongs to another invocation')
      if (!Array.isArray(report.assertions)) throw new Error('Missing report assertions')
      requireUnique(
        report.assertions.map((item) => item.id),
        'report assertions',
      )
      assertions = report.assertions.map(({ id, outcome }) => ({ id, outcome }))
    }
    for (const id of definition.assertions)
      if (!assertions.some((a) => a.id === id && a.outcome === 'pass'))
        errors.push(`Assertion ${id} did not pass`)
  } catch (error) {
    errors.push(error.message)
  }
  try {
    if (fingerprintCandidate(root, definition).digest !== before.digest)
      errors.push('Candidate changed during verification')
    if (inspectProcessRuntime(root, definition).identity.digest !== runtime.identity.digest)
      errors.push('Executable runtime changed during verification')
  } catch {
    errors.push('Candidate identity unavailable after execution')
  }
  const observation = sealDeliveryRecord('verification-observation', {
    id: invocationId,
    invocationId,
    criterionId: definition.criterionId,
    producer: 'agentflow:process-collector',
    origin: 'collector-observed',
    isolation: 'cooperative',
    candidateDigest: before.digest,
    definitionDigest: recordDigest(definition),
    executionContextDigest: runtime.identity.digest,
    executionContext: runtime.identity,
    outcome: errors.length ? 'fail' : 'pass',
    assertions,
    startedAt,
    completedAt: new Date().toISOString(),
    errors,
    exitCode: execution.status ?? null,
  })
  const observationPath = containedPath(root, resolve(outputDir, 'observation.json'), {
    allowMissing: true,
  })
  writeFileSync(observationPath, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' })
  return { observation, observationPath, candidate: before }
}
