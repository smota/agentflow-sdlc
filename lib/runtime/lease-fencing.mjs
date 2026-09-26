/**
 * Cross-Machine Lease Fencing & Monotonic Token Manager
 * Prevents split-brain write collisions during cross-machine and multi-agent handoffs.
 */

export const LEASE_ERROR_CODES = Object.freeze({
  ERR_STALE_FENCING_TOKEN: 'ERR_STALE_FENCING_TOKEN',
  ERR_LEASE_EXPIRED: 'ERR_LEASE_EXPIRED',
  ERR_INVALID_LEASE_ARGUMENTS: 'ERR_INVALID_LEASE_ARGUMENTS',
})

export const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export function createLease({
  taskId,
  machineId,
  agentId = 'unspecified-agent',
  fencingToken = 1,
  ttlMs = DEFAULT_LEASE_TTL_MS,
  now = Date.now(),
} = {}) {
  if (!taskId || !machineId) {
    const err = new Error('taskId and machineId are required to create a lease')
    err.code = LEASE_ERROR_CODES.ERR_INVALID_LEASE_ARGUMENTS
    throw err
  }

  const currentTime = typeof now === 'number' ? now : new Date(now).getTime()
  return {
    taskId,
    machineId,
    agentId,
    fencingToken,
    acquiredAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + ttlMs).toISOString(),
    ttlMs,
    previousOwner: null,
  }
}

export function acquireLease({
  currentLease = null,
  taskId,
  machineId,
  agentId = 'unspecified-agent',
  ttlMs = DEFAULT_LEASE_TTL_MS,
  now = Date.now(),
} = {}) {
  if (!taskId || !machineId) {
    const err = new Error('taskId and machineId are required to acquire a lease')
    err.code = LEASE_ERROR_CODES.ERR_INVALID_LEASE_ARGUMENTS
    throw err
  }

  const currentTime = typeof now === 'number' ? now : new Date(now).getTime()
  const nextToken = currentLease ? (currentLease.fencingToken || 0) + 1 : 1

  return {
    taskId,
    machineId,
    agentId,
    fencingToken: nextToken,
    acquiredAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + ttlMs).toISOString(),
    ttlMs,
    previousOwner: currentLease ? currentLease.machineId : null,
  }
}

export function assertLeaseValid({
  activeLease,
  candidateToken,
  candidateMachineId,
  now = Date.now(),
} = {}) {
  if (!activeLease) {
    const err = new Error('No active lease exists')
    err.code = LEASE_ERROR_CODES.ERR_INVALID_LEASE_ARGUMENTS
    throw err
  }

  const currentTime = typeof now === 'number' ? now : new Date(now).getTime()

  // Monotonic token check (prevents stale machine writes)
  if (typeof candidateToken === 'number' && candidateToken < activeLease.fencingToken) {
    const err = new Error(
      `Candidate fencing token ${candidateToken} is stale. Active lease token is ${activeLease.fencingToken} held by machine ${activeLease.machineId}.`,
    )
    err.code = LEASE_ERROR_CODES.ERR_STALE_FENCING_TOKEN
    throw err
  }

  // Lease expiration check
  const expiresAtMs = new Date(activeLease.expiresAt).getTime()
  if (currentTime > expiresAtMs) {
    const err = new Error(
      `Active lease for task ${activeLease.taskId} expired at ${activeLease.expiresAt}. Current time is ${new Date(currentTime).toISOString()}.`,
    )
    err.code = LEASE_ERROR_CODES.ERR_LEASE_EXPIRED
    throw err
  }

  return true
}
