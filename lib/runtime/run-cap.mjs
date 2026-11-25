import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// A persisted run-count cap per time window (design item W0-14). The limit and window live in the
// same file as the admitted runs, so a person sets them by editing `.agentflow/run-cap.json`.
export const DEFAULT_RUN_CAP = Object.freeze({ limit: 10, windowHours: 24 })

export function runCapPath(root) {
  return join(root, '.agentflow', 'run-cap.json')
}

function readRunCap(root) {
  const path = runCapPath(root)
  if (!existsSync(path)) return { ...DEFAULT_RUN_CAP, runs: [] }
  const record = JSON.parse(readFileSync(path, 'utf8'))
  const limit = record.limit ?? DEFAULT_RUN_CAP.limit
  const windowHours = record.windowHours ?? DEFAULT_RUN_CAP.windowHours
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`Invalid run cap limit in ${path}`)
  if (!(typeof windowHours === 'number' && windowHours > 0)) {
    throw new Error(`Invalid run cap window in ${path}`)
  }
  const runs = Array.isArray(record.runs) ? record.runs : []
  return { limit, windowHours, runs }
}

// Admits a run when fewer than `limit` runs were admitted in the window, and records it. Runs older
// than the window are dropped from the file.
export function admitRun(root, { id, now = new Date() }) {
  if (!id) throw new Error('A run id is required')
  const cap = readRunCap(root)
  const windowStart = now.getTime() - cap.windowHours * 3600 * 1000
  const recent = cap.runs.filter((run) => Date.parse(run.at) >= windowStart)
  const decision = { limit: cap.limit, windowHours: cap.windowHours, count: recent.length }
  if (recent.length >= cap.limit) {
    return { admitted: false, ...decision, reason: 'run cap reached for the current window' }
  }
  const runs = [...recent, { id, at: now.toISOString() }]
  const path = runCapPath(root)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(
    temporary,
    `${JSON.stringify({ limit: cap.limit, windowHours: cap.windowHours, runs }, null, 2)}\n`,
  )
  renameSync(temporary, path)
  return { admitted: true, ...decision, count: runs.length, reason: null }
}
