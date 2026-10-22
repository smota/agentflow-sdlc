import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  evaluateDormantSeatWake,
  install,
  joinParallelVerdicts,
  resolveProjectSpecChannel,
  resolveWorldSituationProfile,
  siblingRecord,
  squadPlan,
  squadProvision,
  squadRigName,
  versionedBaseName,
} from '../../adapters/openrig/lifecycle.mjs'

const OPENRIG_ADAPTER_DIR = resolve('adapters/openrig')
const UNIFIED_RIG_YAML = resolve('adapters/openrig/agentflow/rig.yaml')

const tempDirs = []
function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeCtx({ home, cwd = process.cwd(), options = {}, operands = [] } = {}) {
  const logs = []
  return {
    adapterDir: OPENRIG_ADAPTER_DIR,
    home,
    cwd,
    env: { ...process.env, HOME: makeTempDir('isolated-user-home-') },
    options,
    operands,
    out: (msg) => logs.push(msg),
    logs,
  }
}

describe('Version-Pinned Base Specs vs @dev Dogfood Channel (#545)', () => {
  describe('resolveProjectSpecChannel and versionedBaseName', () => {
    it('resolves @<version> channel when agent-framework-lock.json is present', () => {
      const adoptedDir = makeTempDir('adopted-project-')
      writeFileSync(
        join(adoptedDir, 'agent-framework-lock.json'),
        JSON.stringify({ frameworkVersion: '1.10.0' }, null, 2),
      )

      const channel = resolveProjectSpecChannel(adoptedDir)
      expect(channel).toEqual({
        channel: 'versioned',
        version: '1.10.0',
        suffix: '@1.10.0',
      })
      expect(versionedBaseName('agentflow', channel)).toBe('agentflow@1.10.0')
      expect(versionedBaseName('agentflow', '1.10.0')).toBe('agentflow@1.10.0')
      expect(versionedBaseName('agentflow', '@1.10.0')).toBe('agentflow@1.10.0')
    })

    it('resolves @<version> channel from .agentflow/adoption-lock.json', () => {
      const adoptedDir = makeTempDir('adopted-dot-agentflow-')
      mkdirSync(join(adoptedDir, '.agentflow'), { recursive: true })
      writeFileSync(
        join(adoptedDir, '.agentflow', 'adoption-lock.json'),
        JSON.stringify({ version: '1.9.4' }, null, 2),
      )

      const channel = resolveProjectSpecChannel(adoptedDir)
      expect(channel).toEqual({
        channel: 'versioned',
        version: '1.9.4',
        suffix: '@1.9.4',
      })
    })

    it('resolves @dev channel for the framework dogfood repository itself', () => {
      const dogfoodChannel = resolveProjectSpecChannel(resolve('.'))
      expect(dogfoodChannel).toEqual({
        channel: 'dev',
        version: 'dev',
        suffix: '@dev',
      })
      expect(versionedBaseName('agentflow', dogfoodChannel)).toBe('agentflow@dev')
    })

    it('falls back to default channel when directory has neither lockfile nor dogfood markers', () => {
      const plainDir = makeTempDir('plain-project-')
      const channel = resolveProjectSpecChannel(plainDir)
      expect(channel).toEqual({
        channel: 'default',
        version: null,
        suffix: '',
      })
      expect(versionedBaseName('agentflow', channel)).toBe('agentflow')
      expect(versionedBaseName('agentflow', null)).toBe('agentflow')
    })
  })

  describe('install and squadProvision isolation between @<version> and @dev', () => {
    it('installs version-pinned (@1.10.0) and dogfood (@dev) base snapshots and isolates adopted squads from @dev mutations', () => {
      const home = makeTempDir('openrig-home-')
      const installCtx = makeCtx({ home })
      expect(install(installCtx)).toBe(0)

      const specsDir = join(home, '.openrig', 'specs')
      expect(existsSync(join(specsDir, 'agentflow', 'rig.yaml'))).toBe(true)
      expect(existsSync(join(specsDir, 'agentflow@1.10.0', 'rig.yaml'))).toBe(true)
      expect(existsSync(join(specsDir, 'agentflow@dev', 'rig.yaml'))).toBe(true)

      // 1. Adopted project pinned to 1.10.0
      const adoptedDir = makeTempDir('adopted-repo-')
      writeFileSync(
        join(adoptedDir, 'agent-framework-lock.json'),
        JSON.stringify({ frameworkVersion: '1.10.0' }, null, 2),
      )
      const adoptedCtx = makeCtx({
        home,
        operands: ['adopted-app', adoptedDir],
      })
      expect(squadProvision(adoptedCtx)).toBe(0)

      // 2. Dogfood repository targeting @dev
      const dogfoodDir = makeTempDir('dogfood-repo-')
      mkdirSync(join(dogfoodDir, 'manifests'), { recursive: true })
      mkdirSync(join(dogfoodDir, 'adapters', 'openrig'), { recursive: true })
      writeFileSync(join(dogfoodDir, 'manifests', 'product-payload.json'), '{}')
      writeFileSync(join(dogfoodDir, 'adapters', 'openrig', 'lifecycle.mjs'), '// dogfood')

      const dogfoodCtx = makeCtx({
        home,
        operands: ['dogfood-self', dogfoodDir],
      })
      expect(squadProvision(dogfoodCtx)).toBe(0)

      const adoptedContracts = JSON.parse(
        readFileSync(join(specsDir, 'agentflow-adopted-app', 'execution-contracts.json'), 'utf8'),
      )
      const dogfoodContracts = JSON.parse(
        readFileSync(join(specsDir, 'agentflow-dogfood-self', 'execution-contracts.json'), 'utf8'),
      )
      expect(adoptedContracts.baseChannel).toBe('versioned')
      expect(adoptedContracts.baseSpec).toBe('agentflow@1.10.0')
      expect(dogfoodContracts.baseChannel).toBe('dev')
      expect(dogfoodContracts.baseSpec).toBe('agentflow@dev')

      // Mutate @dev CULTURE.md and verify @1.10.0 adopted squad is completely unaffected
      const originalCulture = readFileSync(
        join(specsDir, 'agentflow-adopted-app', 'CULTURE.md'),
        'utf8',
      )
      writeFileSync(
        join(specsDir, 'agentflow@dev', 'CULTURE.md'),
        '# EXPERIMENTAL DOGFOOD MUTATION\n',
      )

      expect(readFileSync(join(specsDir, 'agentflow-dogfood-self', 'CULTURE.md'), 'utf8')).toBe(
        '# EXPERIMENTAL DOGFOOD MUTATION\n',
      )
      expect(readFileSync(join(specsDir, 'agentflow-adopted-app', 'CULTURE.md'), 'utf8')).toBe(
        originalCulture,
      )
    })
  })
})

describe('Unified Multi-Pod Rig Topology & Parallel QA/Review Join (#547)', () => {
  describe('canonical unified rig.yaml structure', () => {
    it('declares pm, orch, dev, rev, and eval pods in a single rig while keeping steer.lead out-of-rig', () => {
      const rigText = readFileSync(UNIFIED_RIG_YAML, 'utf8')
      const rig = parse(rigText)

      const podIds = rig.pods.map((p) => p.id)
      expect(podIds).toEqual(expect.arrayContaining(['pm', 'orch', 'dev', 'rev', 'eval']))
      expect(podIds).not.toContain('steer')

      const allSeats = rig.pods.flatMap((p) => p.members.map((m) => `${p.id}.${m.id}`))
      expect(allSeats).toEqual(
        expect.arrayContaining([
          'pm.manager',
          'pm.analyst',
          'orch.arch',
          'dev.build',
          'dev.qa',
          'rev.review',
          'eval.tester',
        ]),
      )
      expect(allSeats).not.toContain('steer.lead')

      // Verify internal pm pod edges: manager -> analyst (delegates_to) and analyst -> manager (escalates_to)
      const pmPod = rig.pods.find((p) => p.id === 'pm')
      expect(pmPod.edges).toEqual(
        expect.arrayContaining([
          { kind: 'delegates_to', from: 'manager', to: 'analyst' },
          { kind: 'escalates_to', from: 'analyst', to: 'manager' },
        ]),
      )

      // Verify lateral concurrent delegation from dev.build to dev.qa and rev.review, plus pm.manager -> orch.arch
      const devPod = rig.pods.find((p) => p.id === 'dev')
      expect(devPod.edges).toContainEqual({
        kind: 'delegates_to',
        from: 'build',
        to: 'qa',
      })
      expect(rig.edges).toEqual(
        expect.arrayContaining([
          { kind: 'delegates_to', from: 'pm.manager', to: 'orch.arch' },
          { kind: 'delegates_to', from: 'orch.arch', to: 'dev.build' },
          { kind: 'delegates_to', from: 'dev.build', to: 'rev.review' },
        ]),
      )

      // Verify dormant / on-demand lifecycle metadata on qa, review, tester, and analyst
      for (const [podId, memberId] of [
        ['dev', 'qa'],
        ['rev', 'review'],
        ['eval', 'tester'],
        ['pm', 'analyst'],
      ]) {
        const member = rig.pods.find((p) => p.id === podId).members.find((m) => m.id === memberId)
        expect(member.lifecycle).toBe('dormant-on-demand')
      }
    })

    it('provisions a unified squad via --kind unified with all pods and Pi guard on pm seats', () => {
      const home = makeTempDir('openrig-unified-home-')
      const projectDir = makeTempDir('unified-project-')

      expect(squadRigName('portal', 'unified')).toBe('agentflow-portal')
      expect(squadRigName('agentflow-portal', 'unified')).toBe('agentflow-portal')

      const ctx = makeCtx({
        home,
        options: { kind: 'unified', steer: 'agentflow-portal-steer' },
        operands: ['portal', projectDir],
      })
      expect(squadProvision(ctx)).toBe(0)

      const specDir = join(home, '.openrig', 'specs', 'agentflow-portal')
      const provisionedRig = parse(readFileSync(join(specDir, 'rig.yaml'), 'utf8'))
      expect(provisionedRig.name).toBe('agentflow-portal')
      expect(provisionedRig.pods.map((p) => p.id)).toEqual(
        expect.arrayContaining(['pm', 'orch', 'dev', 'rev', 'eval']),
      )

      const siblingText = readFileSync(join(specDir, 'sibling.md'), 'utf8')
      expect(siblingText).toContain('Unified Multi-Pod Topology')
      expect(siblingText).toContain('steer-lead@agentflow-portal-steer')
      expect(siblingRecord('unified', 'agentflow-portal', '', { steer: 'steer-rig' })).toContain(
        'Supervisory steering (`steer.lead`) remains strictly out-of-rig',
      )

      // Plan also supports --kind unified
      const planCtx = makeCtx({
        home,
        options: { kind: 'unified', json: true },
        operands: ['portal', projectDir],
      })
      expect(squadPlan(planCtx)).toBe(0)
      const parsedPlan = JSON.parse(planCtx.logs.join('\n'))
      expect(parsedPlan.ok).toBe(true)
      expect(parsedPlan.plans[0].kind).toBe('unified')
    })
  })

  describe('joinParallelVerdicts', () => {
    it('approves and routes to orch.arch when both dev.qa and rev.review pass on the same commit SHA', () => {
      const decision = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'pass', summary: 'all 42 tests green' },
        reviewEnvelope: { commitSha: 'abc1234', verdict: 'approved', summary: 'LGTM' },
        sliceTier: 'P2',
      })

      expect(decision).toEqual({
        ok: true,
        status: 'approved',
        outcome: 'ready_for_integration',
        nextSeat: 'orch.arch',
        sliceTier: 'P2',
        commitSha: 'abc1234',
        reasons: [],
      })
    })

    it('rejects mismatched commit SHAs between dev.qa and rev.review', () => {
      const decision = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'pass' },
        reviewEnvelope: { commitSha: 'def5678', verdict: 'approved' },
        sliceTier: 'P2',
        builderSeat: 'dev.build-sr',
      })

      expect(decision.ok).toBe(false)
      expect(decision.status).toBe('sha_mismatch')
      expect(decision.outcome).toBe('stale_verdict_rejected')
      expect(decision.nextSeat).toBe('dev.build-sr')
      expect(decision.reasons[0]).toContain('commit SHA mismatch')
    })

    it('routes back to sticky builder (rework_required) when dev.qa fails or rev.review returns concrete_blocker', () => {
      const qaFailed = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'fail', reason: 'oracle assertion failed' },
        reviewEnvelope: { commitSha: 'abc1234', verdict: 'pass' },
        builderSeat: 'dev.build',
      })
      expect(qaFailed.ok).toBe(false)
      expect(qaFailed.status).toBe('rework_required')
      expect(qaFailed.outcome).toBe('return_to_builder')
      expect(qaFailed.nextSeat).toBe('dev.build')
      expect(qaFailed.reasons).toEqual(['dev.qa: oracle assertion failed'])

      const reviewBlocked = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'delivered' },
        reviewEnvelope: {
          commitSha: 'abc1234',
          outcome: 'concrete_blocker',
          reason: 'missing null check in parser',
        },
        builderSeat: 'dev.build',
      })
      expect(reviewBlocked.ok).toBe(false)
      expect(reviewBlocked.status).toBe('rework_required')
      expect(reviewBlocked.nextSeat).toBe('dev.build')
      expect(reviewBlocked.reasons).toEqual(['rev.review: missing null check in parser'])
    })

    it('escalates to steer.lead (status: blocked) when rework rounds trip the fence or repeated_failure is reported', () => {
      const fenceDecision = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'fail', reason: 'still failing' },
        reviewEnvelope: { commitSha: 'abc1234', status: 'pass' },
        reworkRounds: 2,
        maxReworkRounds: 2,
      })
      expect(fenceDecision.ok).toBe(false)
      expect(fenceDecision.status).toBe('blocked')
      expect(fenceDecision.outcome).toBe('escalate_to_steer')
      expect(fenceDecision.nextSeat).toBe('steer.lead')

      const repeatedDecision = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'pass' },
        reviewEnvelope: {
          commitSha: 'abc1234',
          outcome: 'repeated_failure',
          reason: 'same architectural violation after 2 rounds',
        },
      })
      expect(repeatedDecision.status).toBe('blocked')
      expect(repeatedDecision.nextSeat).toBe('steer.lead')
    })

    it('returns pending when either envelope is missing', () => {
      const pendingReview = joinParallelVerdicts({
        qaEnvelope: { commitSha: 'abc1234', status: 'pass' },
        reviewEnvelope: null,
      })
      expect(pendingReview.ok).toBe(false)
      expect(pendingReview.status).toBe('pending')
      expect(pendingReview.nextSeat).toBeNull()
      expect(pendingReview.reasons).toEqual(['awaiting parallel verdict from rev.review'])
    })
  })

  describe('resolveWorldSituationProfile and evaluateDormantSeatWake', () => {
    it('maps seats and lifecycle states to agentflow-world situation profiles', () => {
      expect(resolveWorldSituationProfile({ seat: 'rev.review', phase: 6 })).toEqual({
        pack: 'agentflow-world',
        seat: 'rev.review',
        situation: 'reviewer',
        command: 'rig context profile agentflow-world --situation reviewer',
        cliFallback: 'agentflow-sdlc seat prime rev.review --situation reviewer',
      })

      expect(
        resolveWorldSituationProfile({ seat: 'orch.arch', phase: 3, isCompacted: true }),
      ).toMatchObject({
        pack: 'agentflow-world',
        seat: 'orch.arch',
        situation: 'post-compaction',
        command: 'rig context profile agentflow-world --situation post-compaction',
      })

      expect(
        resolveWorldSituationProfile({ seat: 'pm.manager', phase: 0, isHandover: true }),
      ).toMatchObject({
        pack: 'agentflow-world',
        seat: 'pm.manager',
        situation: 'handover',
        command: 'rig context profile agentflow-world --situation handover',
      })

      expect(resolveWorldSituationProfile({ seat: 'dev.qa', phase: 5 })).toMatchObject({
        pack: 'agentflow-world',
        seat: 'dev.qa',
        situation: 'fresh',
        command: 'rig context profile agentflow-world --situation fresh',
      })
    })

    it('evaluates dormant seat wake-on-demand only when queueDepth > 0 and no active occupant', () => {
      const stayDormant = evaluateDormantSeatWake({
        seat: 'dev.qa',
        queueDepth: 0,
        activeOccupant: false,
        phase: 5,
      })
      expect(stayDormant.shouldWake).toBe(false)
      expect(stayDormant.mode).toBe('stay-dormant')
      expect(stayDormant.profile.situation).toBe('fresh')

      const wakeUp = evaluateDormantSeatWake({
        seat: 'rev.review',
        queueDepth: 1,
        activeOccupant: false,
        phase: 6,
      })
      expect(wakeUp.shouldWake).toBe(true)
      expect(wakeUp.mode).toBe('wake-on-demand')
      expect(wakeUp.profile.situation).toBe('reviewer')

      const alreadyActive = evaluateDormantSeatWake({
        seat: 'rev.review',
        queueDepth: 2,
        activeOccupant: true,
        phase: 6,
      })
      expect(alreadyActive.shouldWake).toBe(false)
      expect(alreadyActive.mode).toBe('wake-on-demand')
    })
  })
})
