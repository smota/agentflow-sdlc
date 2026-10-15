import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  evaluateSupervisorLiveness,
  steerUnfreeze,
  SUPERVISOR_STALE_TIMEOUT_MS,
} from '../steer.mjs'
import { tripLedgerBreaker } from '../../lib/core/role-collaboration.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'

const roots = [],
  nowMs = 1000000
function fixture() {
  const targetDir = mkdtempSync(join(tmpdir(), 'steering-authority-'))
  roots.push(targetDir)
  const path = join(targetDir, 'ledger.json')
  const { ledger } = tripLedgerBreaker({ fencingToken: 4 })
  writeFileSync(path, JSON.stringify(ledger))
  const steeringBinding = {
    authorityId: 'steer.lead',
    replyRoute: 'external:operator',
    goal: 'goal-516',
    task: 'task-520',
    powers: ['unfreeze'],
    issuedAt: nowMs - 1,
    expiresAt: nowMs + 120000,
  }
  const steeringRequest = {
    goal: 'goal-516',
    task: 'task-520',
    power: 'unfreeze',
    challenge: 'request-unique-12345678901234567890',
    deadlineAt: nowMs + 60000,
    subjectDigest: recordDigest(ledger),
    subjectId: 'ledger:fixture',
  }
  const args = {
    ledgerFile: 'ledger.json',
    resolution: 'slice-split',
    rationale: 'Bounded capability repair',
    actor: 'steer.lead',
    targetDir,
    nowMs,
    clock: () => nowMs,
    steeringBinding,
    steeringRequest,
  }
  steeringRequest.actionDigest = recordDigest({
    resolution: args.resolution,
    rationale: args.rationale,
    humanApproval: null,
    actor: args.actor,
    subjectDigest: steeringRequest.subjectDigest,
    subjectId: steeringRequest.subjectId,
    goal: steeringRequest.goal,
    task: steeringRequest.task,
    nextToken: ledger.fencingToken + 1,
  })
  args.resolveSteeringSubject = () => ({
    verified: true,
    subjectId: steeringRequest.subjectId,
    subjectDigest: recordDigest(ledger),
    goal: steeringRequest.goal,
    task: steeringRequest.task,
  })
  args.verifySteeringEndpoint = ({ binding, request }) => ({
    authenticated: true,
    decision: 'approve',
    nonceConsumed: true,
    deadlineAt: request.deadlineAt,
    subjectId: request.subjectId,
    reachable: true,
    authorityId: binding.authorityId,
    replyRoute: binding.replyRoute,
    goal: request.goal,
    task: request.task,
    power: request.power,
    challenge: request.challenge,
    subjectDigest: request.subjectDigest,
    actionDigest: request.actionDigest,
    expiresAt: nowMs + 60000,
    observedAt: nowMs,
  })
  return { args, path, ledger }
}
async function rejectedWithoutWrite(f) {
  const before = readFileSync(f.path, 'utf8')
  let failure
  try {
    const result = await steerUnfreeze(f.args)
    failure = result?.ok === false || result?.applied === false
  } catch {
    failure = true
  }
  expect(failure).toBe(true)
  expect(readFileSync(f.path, 'utf8')).toBe(before)
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('steering mutation authority integration (#520)', () => {
  it('holds a named steering actor without trusted endpoint verification', async () => {
    const f = fixture()
    delete f.args.verifySteeringEndpoint
    await rejectedWithoutWrite(f)
  })
  it('applies unfreeze using authenticated authority bound to the actual ledger digest', async () => {
    const f = fixture(),
      before = f.ledger.fencingToken
    const result = await steerUnfreeze(f.args)
    expect(result.applied).toBe(true)
    const after = JSON.parse(readFileSync(f.path, 'utf8'))
    expect(after.frozen).toBe(false)
    expect(after.fencingToken).toBe(before + 1)
  })
  it.each(['digest', 'actor', 'power'])(
    'holds wrong %s before changing the ledger',
    async (failure) => {
      const f = fixture()
      if (failure === 'digest') f.args.steeringRequest.subjectDigest = recordDigest({ other: true })
      if (failure === 'actor') f.args.steeringBinding.authorityId = 'human:another'
      if (failure === 'power') {
        f.args.steeringRequest.power = 'observe'
        f.args.steeringBinding.powers = ['observe']
      }
      await rejectedWithoutWrite(f)
    },
  )
  it('does not default an absent actor to steer.lead', async () => {
    vi.stubEnv('OPENRIG_SESSION_NAME', '')
    const f = fixture()
    delete f.args.actor
    await rejectedWithoutWrite(f)
  })
  it('rejects stale ledger authorization if verification changes the ledger', async () => {
    const f = fixture(),
      trustedVerifier = f.args.verifySteeringEndpoint
    const concurrent = {
      ...f.ledger,
      fencingToken: f.ledger.fencingToken + 1,
      concurrentMarker: 'preserve-this',
    }
    f.args.verifySteeringEndpoint = (context) => {
      writeFileSync(f.path, JSON.stringify(concurrent))
      return trustedVerifier(context)
    }
    let failure
    try {
      const result = await steerUnfreeze(f.args)
      failure = result?.ok === false || result?.applied === false
    } catch {
      failure = true
    }
    expect(failure).toBe(true)
    expect(JSON.parse(readFileSync(f.path, 'utf8'))).toEqual(concurrent)
  })
  it.each([{ dryRun: true }, { apply: false }])(
    'permits an unauthenticated preview without claiming application %j',
    async (mode) => {
      const f = fixture()
      delete f.args.verifySteeringEndpoint
      Object.assign(f.args, mode)
      const before = readFileSync(f.path, 'utf8'),
        result = await steerUnfreeze(f.args)
      expect(result.applied).toBe(false)
      expect(readFileSync(f.path, 'utf8')).toBe(before)
      expect(result.authorized).not.toBe(true)
    },
  )
  it('holds fresh heartbeat without authenticated steering authority', () => {
    const result = evaluateSupervisorLiveness({
      lastHeartbeatAt: nowMs - 1,
      nowMs,
      unmergedAcceptedCount: 1,
    })
    expect(result).toMatchObject({
      reachable: false,
      status: 'SUPERVISOR_UNVERIFIED',
      holdNewSliceAdmission: true,
    })
  })
  it('retains stale heartbeat as unreachable', () => {
    expect(
      evaluateSupervisorLiveness({
        lastHeartbeatAt: nowMs - SUPERVISOR_STALE_TIMEOUT_MS - 1,
        nowMs,
        unmergedAcceptedCount: 1,
      }),
    ).toMatchObject({
      reachable: false,
      status: 'SUPERVISOR_UNREACHABLE',
      holdNewSliceAdmission: true,
    })
  })
})
