import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// The coordinator's local kill switch (design item W0-14). Every guarded run reads it before it
// starts and while it runs. M1-8 extends it with draining, the control-repository pause flag and
// check-ins.
export const COORDINATOR_STATES = Object.freeze(['running', 'paused', 'killed'])

export function coordinatorStatePath(root) {
  return join(root, '.agentflow', 'coordinator.json')
}

// With no state file the coordinator has never been started, so it reads as paused: nothing runs
// until a person resumes it.
export function readCoordinatorState(root) {
  const path = coordinatorStatePath(root)
  if (!existsSync(path)) return { state: 'paused', since: null, reason: 'not initialized' }
  const record = JSON.parse(readFileSync(path, 'utf8'))
  if (!COORDINATOR_STATES.includes(record?.state)) {
    throw new Error(`Unknown coordinator state in ${path}: ${record?.state}`)
  }
  return { state: record.state, since: record.since ?? null, reason: record.reason ?? null }
}

export function writeCoordinatorState(root, { state, reason = null, now = new Date() }) {
  if (!COORDINATOR_STATES.includes(state)) throw new Error(`Unknown coordinator state: ${state}`)
  const record = { state, since: now.toISOString(), reason }
  const path = coordinatorStatePath(root)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(temporary, path)
  return record
}

// The dispatch check: only a running coordinator may start work.
export function dispatchAllowed(root) {
  const current = readCoordinatorState(root)
  return { allowed: current.state === 'running', ...current }
}
