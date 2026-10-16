import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { steerAssign } from '../steer.mjs'
import { recordDigest } from '../../lib/core/record-digest.mjs'
const roots = [],
  nowMs = 1000000
function fixture() {
  const targetDir = mkdtempSync(join(tmpdir(), 'steer-assignment-authority-'))
  roots.push(targetDir)
  const briefPath = join(targetDir, 'brief.md')
  writeFileSync(briefPath, '# Bounded goal\nDo only the agreed work.\n')
  const briefDigest = recordDigest({ brief: readFileSync(briefPath, 'utf8') })
  const source = {
    verified: true,
    subjectId: 'assignment-1',
    subjectDigest: recordDigest({ goal: 'goal-516', task: 'assignment-1' }),
    goal: 'goal-516',
    task: 'assignment-1',
    sourceRevision: 'coordination-1',
    returnRoute: 'external:operator',
    destination: 'pm-manager@fixture',
    briefDigest,
  }
  const args = {
    destination: source.destination,
    briefFile: 'brief.md',
    summary: 'Bounded goal',
    goal: source.goal,
    transition: 'phase:0',
    actor: 'steer.lead',
    targetDir,
    nowMs,
    clock: () => nowMs,
    steeringBinding: {
      authorityId: 'steer.lead',
      replyRoute: source.returnRoute,
      goal: source.goal,
      task: source.task,
      powers: ['assign'],
      issuedAt: nowMs - 1000,
      expiresAt: nowMs + 60000,
    },
    steeringRequest: {
      goal: source.goal,
      task: source.task,
      power: 'assign',
      challenge: 'c'.repeat(48),
      deadlineAt: nowMs + 60000,
      subjectId: source.subjectId,
      subjectDigest: source.subjectDigest,
    },
    resolveSteeringAssignment: () => structuredClone(source),
  }
  args.steeringRequest.actionDigest = recordDigest({
    action: 'assign',
    actor: args.actor,
    destination: args.destination,
    briefDigest,
    summary: args.summary,
    goal: source.goal,
    task: source.task,
    transition: args.transition,
    noNudge: false,
    sourceRevision: source.sourceRevision,
    returnRoute: source.returnRoute,
  })
  let consumed = false,
    calls = []
  args.verifySteeringEndpoint = ({ binding, request }) => {
    if (consumed) return null
    consumed = true
    return {
      ...request,
      authorityId: binding.authorityId,
      replyRoute: binding.replyRoute,
      authenticated: true,
      reachable: true,
      nonceConsumed: true,
      decision: 'approve',
      observedAt: nowMs,
      expiresAt: nowMs + 60000,
    }
  }
  args.spawnFn = (command, params, options) => {
    calls.push({ command, params, options })
    return {
      status: 0,
      stdout: JSON.stringify({
        qitemId: params[params.indexOf('--id') + 1],
        destinationSession: args.destination,
      }),
    }
  }
  return { args, source, targetDir, briefPath, calls }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
async function heldWithoutEffects(f) {
  let result
  try {
    result = await steerAssign(f.args)
  } catch {
    result = { ok: false }
  }
  expect(result.ok).toBe(false)
  expect(f.calls).toHaveLength(0)
  expect(readdirSync(f.targetDir)).toEqual(['brief.md'])
}
describe('actual steering assignment requires source-bound consumed authority (#520)', () => {
  it('holds a named actor without trusted authentication', async () => {
    const f = fixture()
    delete f.args.verifySteeringEndpoint
    await heldWithoutEffects(f)
  })
  it('holds absent source binding or an implicit actor', async () => {
    const f = fixture()
    delete f.args.resolveSteeringAssignment
    await heldWithoutEffects(f)
    const g = fixture()
    delete g.args.actor
    await heldWithoutEffects(g)
  })
  it.each(['briefDigest', 'goal', 'destination', 'returnRoute'])(
    'holds wrong source %s',
    async (field) => {
      const f = fixture()
      f.source[field] = 'wrong'
      await heldWithoutEffects(f)
    },
  )
  it('dispatches exactly one approved queue operation without claiming successor acceptance', async () => {
    const f = fixture(),
      result = await steerAssign(f.args)
    expect(result).toMatchObject({ ok: true, authorized: true, dispatched: true, accepted: false })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].options.input).toBe(readFileSync(f.briefPath, 'utf8'))
    expect(f.calls[0].params[f.calls[0].params.indexOf('--body-file') + 1]).toBe('-')
    expect(f.calls[0].params).toEqual(expect.arrayContaining(['queue', 'create', '--id', '--json']))
    expect(f.calls[0].params).not.toContain('send')
    await steerAssign(f.args)
    expect(f.calls).toHaveLength(1)
  })
  it('rechecks brief bytes and source revision after consuming the decision', async () => {
    const f = fixture(),
      verify = f.args.verifySteeringEndpoint
    f.args.verifySteeringEndpoint = (context) => {
      const receipt = verify(context)
      writeFileSync(f.briefPath, 'changed brief')
      return receipt
    }
    await heldWithoutEffects(f)
    const g = fixture(),
      verify2 = g.args.verifySteeringEndpoint
    g.args.verifySteeringEndpoint = (context) => {
      const receipt = verify2(context)
      g.source.sourceRevision = 'coordination-2'
      return receipt
    }
    await heldWithoutEffects(g)
  })
  it('holds changed summary/action, unused nonce, and expired final clock', async () => {
    const f = fixture()
    f.args.summary = 'never approved'
    await heldWithoutEffects(f)
    const g = fixture(),
      verify = g.args.verifySteeringEndpoint
    g.args.verifySteeringEndpoint = (context) => ({ ...verify(context), nonceConsumed: false })
    await heldWithoutEffects(g)
    const h = fixture()
    h.args.clock = () => nowMs + 60001
    await heldWithoutEffects(h)
  })
  it('does not persist an alternate local queue when rig is absent', async () => {
    const f = fixture()
    f.args.spawnFn = () => ({
      status: null,
      error: Object.assign(new Error('PRIVATE_FIXTURE_ERROR'), { code: 'ENOENT' }),
    })
    const result = await steerAssign(f.args)
    expect(result).toMatchObject({ ok: false, dispatched: false, accepted: false })
    expect(readdirSync(f.targetDir)).toEqual(['brief.md'])
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FIXTURE')
  })
  it('holds malformed queue acknowledgement as uncertain without exposing raw output', async () => {
    const f = fixture()
    f.args.spawnFn = () => ({ status: 0, stdout: 'PRIVATE_FIXTURE_ACK' })
    const result = await steerAssign(f.args)
    expect(result).toMatchObject({
      ok: false,
      accepted: false,
      status: 'STEERING_ASSIGNMENT_OUTCOME_UNKNOWN',
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FIXTURE')
  })
  it('allows a plain preview without authentication or effects', async () => {
    const f = fixture()
    f.args.dryRun = true
    delete f.args.verifySteeringEndpoint
    delete f.args.resolveSteeringAssignment
    delete f.args.actor
    expect(await steerAssign(f.args)).toMatchObject({ dryRun: true, dispatched: false })
    expect(f.calls).toHaveLength(0)
  })
  it('standalone CLI holds with exit 3 without invoking a rig transport', () => {
    const f = fixture()
    const result = spawnSync(
      process.execPath,
      [
        'bin/cli.mjs',
        'steer',
        'assign',
        '--destination',
        f.source.destination,
        '--brief',
        f.briefPath,
        '--json',
      ],
      { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } },
    )
    expect(result.status).toBe(3)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      dispatched: false,
      accepted: false,
    })
    expect(readdirSync(f.targetDir)).toEqual(['brief.md'])
  })
})
