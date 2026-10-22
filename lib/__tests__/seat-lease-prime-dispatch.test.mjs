import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  claimSeatLease,
  listSeatLeases,
  readSeatLease,
  releaseSeatLease,
} from '../core/seat-lease.mjs'
import { callerSeat, claimExisting, claimSeat } from '../core/seat-claim.mjs'
import {
  extractMarkdownH2Pointers,
  parseWorldManifestYaml,
  primeSeat,
} from '../core/seat-prime.mjs'
import { dispatchEnvelope, resolveNextCoordinatorAction } from '../core/dispatch.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cliBin = join(repoRoot, 'bin/cli.mjs')

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentflow-slice1-'))
  writeFileSync(
    join(dir, 'AGENTS.md'),
    [
      '# AGENTS.md',
      '',
      '## Operating model',
      'Single-agent default with role-based phases.',
      '',
      '## Path ownership boundaries',
      'Builder seats cannot edit tests/oracles/**.',
      '',
      '## Review and safety',
      'High-assurance work requires human review.',
    ].join('\n'),
    'utf8',
  )
  mkdirSync(join(dir, '.agentflow'), { recursive: true })
  writeFileSync(
    join(dir, '.agentflow/PRODUCT.md'),
    ['# Product', '', '## Core Domain', 'Agentic SDLC orchestration.'].join('\n'),
    'utf8',
  )
  return dir
}

describe('L1 agentflow-world context pack manifest', () => {
  it('defines valid openrig.context-pack/v1 atoms with addressable h2 slugs and probes', () => {
    const manifestPath = join(repoRoot, 'adapters/openrig/agentflow-world/manifest.yaml')
    expect(existsSync(manifestPath)).toBe(true)
    const parsed = parseWorldManifestYaml(readFileSync(manifestPath, 'utf8'))
    expect(parsed.schema).toBe('openrig.context-pack/v1')
    expect(parsed.name).toBe('agentflow-world')
    expect(parsed.taxonomy).toBe('world')
    expect(parsed.atoms.length).toBeGreaterThanOrEqual(8)

    const regions = new Set(parsed.atoms.map((a) => a.region))
    for (const region of [
      'identity',
      'ontology',
      'terrain',
      'actors',
      'laws',
      'history',
      'state',
      'affordances',
    ]) {
      expect(regions.has(region)).toBe(true)
    }

    for (const atom of parsed.atoms) {
      expect(atom.source).toMatch(/^[^#]+\.md#[a-z0-9-]+$/)
      const [relFile] = atom.source.split('#')
      const absFile = join(repoRoot, relFile)
      expect(existsSync(absFile)).toBe(true)
      const { pointers } = extractMarkdownH2Pointers(relFile, readFileSync(absFile, 'utf8'))
      expect(pointers).toContain(atom.source)
      expect(atom.probe.prompt.length).toBeGreaterThan(5)
      expect(atom.probe.expect.length).toBeGreaterThan(5)
      expect(atom.probe.expectedPatterns.length).toBeGreaterThan(0)
    }
  })
})

describe('transition envelope schemas (6-way outcome + 3-primitive split)', () => {
  it('includes legacy 4-way and new 6-way decision values plus outcome, queueAction, domainStatus, and result', () => {
    for (const rel of [
      'schemas/transition-envelope.schema.json',
      'schemas/transition-envelope.cli.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'))
      expect(schema.properties.decision.enum).toEqual([
        'pass',
        'blocked',
        'returned',
        'skipped',
        'delivered',
        'no_change',
        'feasible_work_remains_same_worker',
        'concrete_blocker',
        'unknown_outcome',
        'repeated_failure',
      ])
      expect(schema.properties.outcome.enum).toEqual([
        'delivered',
        'no_change',
        'feasible_work_remains_same_worker',
        'concrete_blocker',
        'unknown_outcome',
        'repeated_failure',
      ])
      expect(schema.properties.queueAction.enum).toEqual(['close', 'handoff', 'keep_open'])
      expect(schema.properties.domainStatus.enum).toEqual([
        'in_progress',
        'slice_complete',
        'goal_complete',
      ])
      expect(schema.properties.result).toMatchObject({
        type: 'object',
        additionalProperties: true,
      })
    }
  })
})

describe('advisory seat lease lifecycle (seat-lease.mjs & seat-claim.mjs)', () => {
  it('claims, reads, lists, expires, and releases seat leases', () => {
    const dir = makeTempProject()
    const t0 = '2026-10-22T10:00:00.000Z'
    const lease = claimSeatLease(dir, {
      seat: 'dev.build',
      occupantSession: 'agy-cli:123',
      platform: 'agy-cli',
      desired: { model: 'gemini-3.8-flash' },
      observed: { client: 'agy' },
      worktree: dir,
      ttlSeconds: 600,
      now: t0,
    })

    expect(lease.seat).toBe('dev.build')
    expect(lease.occupantSession).toBe('agy-cli:123')
    expect(lease.expired).toBe(false)
    expect(existsSync(join(dir, '.agentflow/seats/dev.build.json'))).toBe(true)

    const active = readSeatLease(dir, 'dev.build', { now: '2026-10-22T10:05:00.000Z' })
    expect(active).toMatchObject({
      seat: 'dev.build',
      occupantSession: 'agy-cli:123',
      expired: false,
    })

    const expiredNull = readSeatLease(dir, 'dev.build', { now: '2026-10-22T10:15:00.000Z' })
    expect(expiredNull).toBeNull()

    const expiredInspect = readSeatLease(dir, 'dev.build', {
      now: '2026-10-22T10:15:00.000Z',
      inspect: true,
    })
    expect(expiredInspect).toMatchObject({
      seat: 'dev.build',
      expired: true,
    })

    expect(listSeatLeases(dir, { now: '2026-10-22T10:05:00.000Z' })).toHaveLength(1)
    expect(listSeatLeases(dir, { now: '2026-10-22T10:15:00.000Z' })).toHaveLength(0)

    expect(() =>
      releaseSeatLease(dir, 'dev.build', {
        occupantSession: 'other-session',
        now: '2026-10-22T10:05:00.000Z',
      }),
    ).toThrow(/cannot release seat dev\.build/)

    const released = releaseSeatLease(dir, 'dev.build', {
      occupantSession: 'agy-cli:123',
      now: '2026-10-22T10:05:00.000Z',
    })
    expect(released).toEqual({
      released: true,
      seat: 'dev.build',
      previousOccupant: 'agy-cli:123',
    })
    expect(readSeatLease(dir, 'dev.build')).toBeNull()
  })

  it('verifies external terminal sessions via active lease in claimSeat while preserving OpenRig session behavior', () => {
    const dir = makeTempProject()
    const now = '2026-10-22T10:00:00.000Z'
    claimSeatLease(dir, {
      seat: 'dev.build',
      occupantSession: 'agy-cli:777',
      platform: 'agy-cli',
      ttlSeconds: 3600,
      now,
    })

    // Positional signature with lease fallback
    expect(claimSeat('agy-cli:777', 'dev.build', { targetDir: dir, now })).toEqual({
      seatVerified: true,
      seatRig: 'agy-cli',
      lease: true,
    })

    // Mismatched external session is unverified
    expect(claimSeat('agy-cli:999', 'dev.build', { targetDir: dir, now })).toEqual({
      seatVerified: false,
      seatRig: null,
    })

    // OpenRig <logical>@<rig> session still works in both positional and object forms
    expect(claimSeat('dev-build@agentflow-dev', 'dev.build')).toEqual({
      seatVerified: true,
      seatRig: 'agentflow-dev',
    })
    expect(claimSeat({ seat: 'dev.build', caller: callerSeat('dev-build@agentflow-dev') })).toEqual(
      {
        seatVerified: true,
        seatRig: 'agentflow-dev',
      },
    )
    expect(() => claimSeat('orch-arch@agentflow-dev', 'dev.build')).toThrow(
      /holds seat orch\.arch and cannot append a transition as seat dev\.build/,
    )

    // claimExisting works in both object and positional forms
    const existing = { idempotencyKey: 'k1', seat: 'dev.build', seatRig: 'agentflow-dev' }
    expect(() => claimExisting(existing, 'dev-build@agentflow-dev')).not.toThrow()
    expect(() => claimExisting(existing, 'orch-arch@agentflow-dev')).toThrow(/cannot reuse key k1/)
  })
})

describe('deterministic 3-Layer Context Composer (seat-prime.mjs)', () => {
  it('composes L1, L2, and L3 for fresh, post-compaction, and reviewer situations and enforces L2 narrowing precedence', () => {
    const dir = makeTempProject()
    writeFileSync(
      join(dir, 'sdlc.config.json'),
      JSON.stringify({
        posture: 'high-assurance',
        allowsSelfReview: true,
        ciCommands: ['npm test'],
        seatOverrides: {
          'dev.build': {
            requiresPhase3OraclePin: false,
            allow: ['tests/oracles/**'],
          },
        },
      }),
      'utf8',
    )

    claimSeatLease(dir, {
      seat: 'dev.build',
      occupantSession: 'claude-cli:42',
      platform: 'claude-cli',
    })

    dispatchEnvelope(dir, {
      to: 'dev.build',
      from: 'orch.arch',
      outcome: 'feasible_work_remains_same_worker',
      summary: 'Finish slice 1 tests',
      sliceId: 'slice-1',
      issueRef: '#543',
      openrigActive: false,
    })

    const fresh = primeSeat(dir, {
      seat: 'dev.build',
      situation: 'fresh',
      sliceId: 'slice-1',
      issueRef: '#543',
    })
    expect(fresh.layers.l1.mode).toBe('compact-contract')
    expect(fresh.layers.l1.seatContract.pathBoundaries.deny).toContain('tests/oracles/**')
    expect(fresh.layers.l2.effectivePolicy.posture).toBe('high-assurance')
    expect(fresh.layers.l2.effectivePolicy.allowsSelfReview).toBe(false)
    expect(fresh.warnings.length).toBeGreaterThanOrEqual(2)
    expect(fresh.layers.l3.lease?.occupantSession).toBe('claude-cli:42')
    expect(fresh.layers.l3.inbox).toHaveLength(1)
    expect(fresh.markdown).toContain('## L1: Framework Law')
    expect(fresh.markdown).toContain('## L2: Project Domain')
    expect(fresh.markdown).toContain('## L3: Reconciled Live Facts')

    const compacted = primeSeat(dir, {
      seat: 'dev.build',
      situation: 'post-compaction',
    })
    expect(compacted.layers.l1.mode).toBe('pointers-only')
    expect(compacted.layers.l2.mode).toBe('pointers-only')
    expect(compacted.layers.l1.pointers).toContain('AGENTS.md#path-ownership-boundaries')

    const reviewer = primeSeat(dir, {
      seat: 'rev.review',
      situation: 'reviewer',
    })
    expect(reviewer.layers.l1.seatContract.reviewerIsolation).toEqual({
      blindToBuilderReasoning: true,
      verifyAgainst: ['SPEC.md', 'acceptance-criteria', 'deterministic-tests'],
    })
  })
})

describe('wire-agnostic handoff dispatcher (dispatch.mjs)', () => {
  it('maps all 6 outcomes to deterministic coordinator actions and enforces goal_complete authority', () => {
    const expectedActions = [
      ['delivered', 'fanout_qa_and_review', 'dev.qa'],
      ['no_change', 'close_slice', 'orch.arch'],
      ['feasible_work_remains_same_worker', 'redispatch_same_worker', 'dev.build'],
      ['concrete_blocker', 'escalate_coordinator', 'orch.arch'],
      ['unknown_outcome', 'reconcile_state', 'orch.arch'],
      ['repeated_failure', 'trip_circuit_breaker', 'steer.lead'],
    ]

    for (const [outcome, action, targetSeat] of expectedActions) {
      const resolved = resolveNextCoordinatorAction({
        from: 'dev.build',
        to: 'orch.arch',
        outcome,
      })
      expect(resolved.action).toBe(action)
      expect(resolved.targetSeat).toBe(targetSeat)
    }

    const dir = makeTempProject()
    expect(() =>
      dispatchEnvelope(dir, {
        to: 'orch.arch',
        from: 'dev.build',
        outcome: 'delivered',
        domainStatus: 'goal_complete',
        openrigActive: false,
      }),
    ).toThrow(/only steer\.lead or human holds goal completion authority/)

    const allowedGoalComplete = dispatchEnvelope(dir, {
      to: 'orch.arch',
      from: 'steer.lead',
      outcome: 'delivered',
      domainStatus: 'goal_complete',
      summary: 'All slices verified',
      openrigActive: false,
    })
    expect(allowedGoalComplete.mode).toBe('inbox-fallback')
    expect(allowedGoalComplete.envelope.domainStatus).toBe('goal_complete')
    expect(existsSync(allowedGoalComplete.envelopePath)).toBe(true)

    const rigCalls = []
    const openrigDispatched = dispatchEnvelope(dir, {
      to: 'dev.qa',
      from: 'dev.build',
      outcome: 'delivered',
      summary: 'Ready for QA',
      openrigActive: true,
      rigRunner: (args) => {
        rigCalls.push(args)
        return { status: 0 }
      },
    })
    expect(openrigDispatched.mode).toBe('openrig')
    expect(rigCalls).toHaveLength(1)
    expect(rigCalls[0]).toContain('handoff')
  })
})

describe('CLI integration (agentflow-sdlc seat & dispatch)', () => {
  it('executes seat claim, status, prime, release, and dispatch via bin/cli.mjs', () => {
    const dir = makeTempProject()

    const claimRes = spawnSync(
      process.execPath,
      [
        cliBin,
        'seat',
        'claim',
        'dev.build',
        '--session',
        'agy-cli:555',
        '--platform',
        'agy-cli',
        '--target',
        dir,
        '--json',
      ],
      { encoding: 'utf8' },
    )
    expect(claimRes.status).toBe(0)
    expect(JSON.parse(claimRes.stdout)).toMatchObject({
      seat: 'dev.build',
      occupantSession: 'agy-cli:555',
    })

    const statusRes = spawnSync(
      process.execPath,
      [cliBin, 'seat', 'status', 'dev.build', '--target', dir, '--json'],
      { encoding: 'utf8' },
    )
    expect(statusRes.status).toBe(0)
    expect(JSON.parse(statusRes.stdout).lease.occupantSession).toBe('agy-cli:555')

    const dispatchRes = spawnSync(
      process.execPath,
      [
        cliBin,
        'dispatch',
        '--to',
        'dev.build',
        '--from',
        'orch.arch',
        '--outcome',
        'feasible_work_remains_same_worker',
        '--summary',
        'Continue slice 1',
        '--no-openrig',
        '--target',
        dir,
        '--json',
      ],
      { encoding: 'utf8' },
    )
    expect(dispatchRes.status).toBe(0)
    const dispatchPayload = JSON.parse(dispatchRes.stdout)
    expect(dispatchPayload.mode).toBe('inbox-fallback')
    expect(dispatchPayload.nextAction.action).toBe('redispatch_same_worker')

    const primeRes = spawnSync(
      process.execPath,
      [cliBin, 'seat', 'prime', 'dev.build', '--situation', 'fresh', '--target', dir, '--json'],
      { encoding: 'utf8' },
    )
    expect(primeRes.status).toBe(0)
    const primePayload = JSON.parse(primeRes.stdout)
    expect(primePayload.layers.l3.inbox).toHaveLength(1)

    const releaseRes = spawnSync(
      process.execPath,
      [
        cliBin,
        'seat',
        'release',
        'dev.build',
        '--session',
        'agy-cli:555',
        '--target',
        dir,
        '--json',
      ],
      { encoding: 'utf8' },
    )
    expect(releaseRes.status).toBe(0)
    expect(JSON.parse(releaseRes.stdout).released).toBe(true)
  })
})
