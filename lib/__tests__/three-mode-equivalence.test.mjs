import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimSeatLease,
  listSeatLeases,
  readSeatLease,
  releaseSeatLease,
} from '../core/seat-lease.mjs'
import { OUTCOME_ENUM, primeSeat } from '../core/seat-prime.mjs'
import { dispatchEnvelope, resolveNextCoordinatorAction } from '../core/dispatch.mjs'
import {
  ackWorld,
  ALLOWED_ATOM_KEYS,
  applyWorld,
  parseWorldManifestYaml,
  refineWorld,
  scanWorld,
} from '../world/world-builder.mjs'
import { inspectDoctor } from '../services/doctor-service.mjs'
import {
  install,
  resolveProjectSpecChannel,
  squadProvision,
} from '../../adapters/openrig/lifecycle.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ADAPTER_DIR = join(REPO_ROOT, 'adapters', 'openrig')

const tempDirs = []

function makeTmpDir(prefix = 'three-mode-eq-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Builds the three realistic mode fixtures in isolated temporary directories:
 * 1. Dogfood Host (`agentflow-sdlc` mode)
 * 2. AgentFlow-Only Adopter (`environment-contract` mode)
 * 3. AgentFlow + OpenRig Adopter (`dendro` mode)
 */
function setupThreeModeFixtures() {
  const workspaceRoot = makeTmpDir('three-mode-workspace-')
  const dogfoodDir = join(workspaceRoot, 'agentflow-sdlc')
  const envContractDir = join(workspaceRoot, 'environment-contract')
  const dendroDir = join(workspaceRoot, 'dendro')

  mkdirSync(join(dogfoodDir, 'manifests'), { recursive: true })
  mkdirSync(join(dogfoodDir, 'adapters', 'openrig'), { recursive: true })
  mkdirSync(join(envContractDir, 'docs'), { recursive: true })
  mkdirSync(join(dendroDir, '.agentflow'), { recursive: true })
  mkdirSync(join(dendroDir, 'docs'), { recursive: true })

  // Fixture 1: Dogfood Host (`agentflow-sdlc` mode)
  writeFileSync(
    join(dogfoodDir, 'manifests', 'product-payload.json'),
    JSON.stringify({ name: 'agentflow-sdlc', version: '1.10.0' }, null, 2),
    'utf8',
  )
  writeFileSync(
    join(dogfoodDir, 'adapters', 'openrig', 'lifecycle.mjs'),
    '// dogfood marker\nexport const DOGFOOD = true\n',
    'utf8',
  )
  writeFileSync(
    join(dogfoodDir, 'AGENTS.md'),
    [
      '# AGENTS.md — Dogfood Repository Policy',
      '',
      '## Operating model',
      'AgentFlow dogfood repository identity, mission, and product purpose.',
      '',
      '## Path ownership boundaries',
      'Directory layout, repository terrain, module structure, and worktree ownership.',
      '',
      '## Review and safety',
      'Governance laws, security rules, branch discipline, and gate compliance invariants.',
      '',
      '## Tooling and validation',
      'CLI commands, verification scripts, and test runner affordances.',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dogfoodDir, 'sdlc.config.json'),
    JSON.stringify(
      {
        version: '1.0.0',
        posture: 'standard',
        allowsSelfReview: true,
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(
    join(dogfoodDir, 'agent-workflow.config.json'),
    JSON.stringify(
      {
        posture: 'standard',
        ciCommands: ['npm test', 'npm run validate:authority'],
        adapters: {
          openrig: {
            executionPolicy: {
              activation: 'active',
            },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  // Fixture 2: AgentFlow-Only Adopter (`environment-contract` mode)
  writeFileSync(
    join(envContractDir, 'agent-framework-lock.json'),
    JSON.stringify(
      {
        framework: 'agentflow-sdlc',
        frameworkVersion: '1.10.0',
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(
    join(envContractDir, 'AGENTS.md'),
    [
      '# AGENTS.md — Environment Contract Policy',
      '',
      '## Operating model',
      'Environment Contract product overview, mission, and operating model.',
      '',
      '## Review and safety',
      'Safety rules, governance policy, and compliance gate laws.',
      '',
      '## Tooling and validation',
      'CLI validation commands and verification scripts.',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(envContractDir, 'docs', 'stack-conventions.md'),
    [
      '# Stack Conventions',
      '',
      '## Repository Structure',
      'Directory layout, terrain boundaries, and package architecture.',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(envContractDir, 'sdlc.config.json'),
    JSON.stringify(
      {
        version: '1.0.0',
        allowsSelfReview: true,
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(
    join(envContractDir, 'agent-workflow.config.json'),
    JSON.stringify(
      {
        posture: 'assisted',
        ciCommands: ['npm run check:contracts'],
      },
      null,
      2,
    ),
    'utf8',
  )

  // Fixture 3: AgentFlow + OpenRig Adopter (`dendro` mode)
  writeFileSync(
    join(dendroDir, 'agent-framework-lock.json'),
    JSON.stringify(
      {
        framework: 'agentflow-sdlc',
        frameworkVersion: '1.10.0',
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(
    join(dendroDir, 'AGENTS.md'),
    [
      '# AGENTS.md — Dendro Policy',
      '',
      '## Operating model',
      'Dendro is a Rust and DuckDB columnar analytical engine mission and product vision.',
      '',
      '## Review and safety',
      'Strict four-eyes review laws, memory safety invariants, and governance gates.',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dendroDir, '.agentflow', 'PRODUCT.md'),
    [
      '# Dendro Product Specification',
      '',
      '## Product Mission',
      'Zero-copy analytical query execution over DuckDB and Arrow in Rust.',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dendroDir, 'docs', 'stack-conventions.md'),
    [
      '# Dendro Stack Conventions',
      '',
      '## Rust Workspace Terrain',
      'Cargo workspace directory structure, crate boundaries, and module layout.',
      '',
      '## Cargo Build Affordances',
      'CLI commands and cargo verification tooling for workspace builds.',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dendroDir, 'sdlc.config.json'),
    JSON.stringify(
      {
        version: '1.0.0',
        allowsSelfReview: false,
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(
    join(dendroDir, 'agent-workflow.config.json'),
    JSON.stringify(
      {
        posture: 'autonomous',
        ciCommands: ['cargo check --workspace', 'cargo test --workspace'],
        adapters: {
          openrig: {
            executionPolicy: {
              activation: 'active',
            },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  return {
    dogfoodDir,
    envContractDir,
    dendroDir,
    all: [
      { mode: 'agentflow-sdlc', dir: dogfoodDir },
      { mode: 'environment-contract', dir: envContractDir },
      { mode: 'dendro', dir: dendroDir },
    ],
  }
}

describe('Three-Mode Equivalence Suite (Dogfood vs AgentFlow-Only vs AgentFlow + OpenRig)', () => {
  it('(a) L1/L2/L3 primeSeat equivalence across fresh, post-compaction, and reviewer situations', () => {
    const { dogfoodDir, envContractDir, dendroDir, all } = setupThreeModeFixtures()

    const freshResults = Object.fromEntries(
      all.map(({ mode, dir }) => [mode, primeSeat(dir, { seat: 'dev.build', situation: 'fresh' })]),
    )

    // 1. Identical L1 framework law structures across all 3 modes
    const referenceL1 = freshResults['agentflow-sdlc'].layers.l1
    expect(referenceL1.mode).toBe('compact-contract')
    expect(referenceL1.seatContract.outcomes).toEqual(OUTCOME_ENUM)
    expect(referenceL1.seatContract.pathBoundaries.deny).toContain('tests/oracles/**')

    for (const { mode } of all) {
      const l1 = freshResults[mode].layers.l1
      expect(l1.packName).toBe(referenceL1.packName)
      expect(l1.mode).toBe('compact-contract')
      expect(l1.seatContract).toEqual(referenceL1.seatContract)
      expect(l1.atoms.map((a) => a.id)).toEqual(referenceL1.atoms.map((a) => a.id))
    }

    // 2. L2 narrowing precedence and domain discovery in each fixture
    expect(freshResults['agentflow-sdlc'].layers.l2.effectivePolicy).toEqual({
      posture: 'standard',
      allowsSelfReview: true,
      ciCommands: ['npm test', 'npm run validate:authority'],
    })
    expect(freshResults['environment-contract'].layers.l2.effectivePolicy).toEqual({
      posture: 'assisted',
      allowsSelfReview: true,
      ciCommands: ['npm run check:contracts'],
    })
    expect(freshResults.dendro.layers.l2.effectivePolicy).toEqual({
      posture: 'autonomous',
      allowsSelfReview: false,
      ciCommands: ['cargo check --workspace', 'cargo test --workspace'],
    })
    expect(freshResults.dendro.layers.l2.pointers).toContain(
      '.agentflow/PRODUCT.md#product-mission',
    )

    // Verify L2 cannot widen L1 high-assurance self-review prohibition
    writeFileSync(
      join(dendroDir, 'sdlc.config.json'),
      JSON.stringify(
        {
          version: '1.0.0',
          posture: 'high-assurance',
          allowsSelfReview: true,
        },
        null,
        2,
      ),
      'utf8',
    )
    const narrowedDendro = primeSeat(dendroDir, { seat: 'dev.build', situation: 'fresh' })
    expect(narrowedDendro.layers.l2.effectivePolicy.allowsSelfReview).toBe(false)
    expect(narrowedDendro.warnings.some((w) => w.includes('L2 precedence violation blocked'))).toBe(
      true,
    )

    // Restore dendro sdlc.config.json
    writeFileSync(
      join(dendroDir, 'sdlc.config.json'),
      JSON.stringify({ version: '1.0.0', allowsSelfReview: false }, null, 2),
      'utf8',
    )

    // 3. Post-compaction emits pointer-only L1 and L2 references across all 3 modes
    for (const { dir } of [{ dir: dogfoodDir }, { dir: envContractDir }, { dir: dendroDir }]) {
      const compacted = primeSeat(dir, { seat: 'dev.build', situation: 'post-compaction' })
      expect(compacted.layers.l1.mode).toBe('pointers-only')
      expect(compacted.layers.l1.pointers).toContain('AGENTS.md#path-ownership-boundaries')
      expect(compacted.layers.l1.atoms.every((a) => !('summary' in a))).toBe(true)
      expect(compacted.layers.l2.mode).toBe('pointers-only')
      expect(compacted.layers.l2.sectionDigests).toBeUndefined()
    }

    // 4. Reviewer situation enforces reviewerIsolation across all 3 modes
    for (const { dir } of all) {
      const reviewerPrime = primeSeat(dir, { seat: 'rev.review', situation: 'reviewer' })
      expect(reviewerPrime.layers.l1.seatContract.pathBoundaries.readOnly).toBe(true)
      expect(reviewerPrime.layers.l1.seatContract.reviewerIsolation).toEqual({
        blindToBuilderReasoning: true,
        verifyAgainst: ['SPEC.md', 'acceptance-criteria', 'deterministic-tests'],
      })
    }
  })

  it('(b) Assisted zero-copy world scan -> refine -> apply -> doctor (world-integrity) equivalence across all 3 fixtures', () => {
    const { all } = setupThreeModeFixtures()

    for (const { dir } of all) {
      // 1. Scan & Refine
      const scan = scanWorld(dir)
      expect(scan.zeroProseCopied).toBe(true)
      expect(scan.missingCoreRegions).toEqual([])

      const plan = refineWorld(dir, { generatedAt: '2026-10-22T00:00:00.000Z' })
      expect(plan.quality.ok).toBe(true)

      // 2. Apply with confirmation digest
      const applied = applyWorld(dir, {
        confirm: plan.digest,
        generatedAt: '2026-10-22T00:00:00.000Z',
      })
      expect(applied.ok).toBe(true)

      const manifestPath = join(dir, '.agentflow', 'world', 'manifest.yaml')
      const lockPath = join(dir, '.agentflow', 'world', 'world-lock.json')
      expect(existsSync(manifestPath)).toBe(true)
      expect(existsSync(lockPath)).toBe(true)

      const parsedManifest = parseWorldManifestYaml(readFileSync(manifestPath, 'utf8'))
      expect(parsedManifest.atoms.length).toBeGreaterThan(0)
      for (const atom of parsedManifest.atoms) {
        for (const key of Object.keys(atom)) {
          expect(ALLOWED_ATOM_KEYS).toContain(key)
        }
        // Zero duplicated prose: no inline body/content keys
        expect(atom).not.toHaveProperty('content')
        expect(atom).not.toHaveProperty('body')
        expect(atom).not.toHaveProperty('text')
      }

      // 3. Doctor reports 0 world-integrity defects on clean applied world
      const cleanDoctor = inspectDoctor({ packageRoot: REPO_ROOT, targetDir: dir })
      const worldFindings = cleanDoctor.dimensions['world-integrity']
      expect(worldFindings.length).toBeGreaterThan(0)
      expect(
        worldFindings.every((f) => f.structural === 'valid' && f.alignment === 'matched'),
      ).toBe(true)

      // 4. Renaming an H2 heading triggers a structural pointer defect with an edit-distance Suggested fix
      const agentsPath = join(dir, 'AGENTS.md')
      const originalAgents = readFileSync(agentsPath, 'utf8')
      writeFileSync(
        agentsPath,
        originalAgents.replace('## Operating model', '## Operating models'),
        'utf8',
      )

      const brokenHeaderDoctor = inspectDoctor({ packageRoot: REPO_ROOT, targetDir: dir })
      const brokenHeaderFindings = brokenHeaderDoctor.dimensions['world-integrity'].filter(
        (f) => f.structural === 'invalid',
      )
      expect(brokenHeaderFindings.length).toBeGreaterThan(0)
      expect(
        brokenHeaderFindings.some(
          (f) =>
            f.reason.includes('Suggested fix: AGENTS.md#operating-models') ||
            (f.proposedChange && f.proposedChange.includes('AGENTS.md#operating-models')),
        ),
      ).toBe(true)

      // Restore heading
      writeFileSync(agentsPath, originalAgents, 'utf8')

      // 5. Mutating ciCommands in agent-workflow.config.json triggers a claim drift defect
      const workflowPath = join(dir, 'agent-workflow.config.json')
      const originalWorkflow = readFileSync(workflowPath, 'utf8')
      const mutatedWorkflow = JSON.parse(originalWorkflow)
      mutatedWorkflow.ciCommands = ['echo drifted-ci-command']
      writeFileSync(workflowPath, JSON.stringify(mutatedWorkflow, null, 2), 'utf8')

      const claimDriftDoctor = inspectDoctor({ packageRoot: REPO_ROOT, targetDir: dir })
      const claimDriftFindings = claimDriftDoctor.dimensions['world-integrity'].filter(
        (f) => f.structural === 'invalid' && f.reason.includes('workflow.ciCommands'),
      )
      expect(claimDriftFindings.length).toBe(1)

      // Restore workflow config
      writeFileSync(workflowPath, originalWorkflow, 'utf8')

      // 6. Modifying section prose triggers alignment='differing' hash drift; ackWorld clears it
      writeFileSync(
        agentsPath,
        `${originalAgents}\nAdditional operational note appended to the last section.\n`,
        'utf8',
      )
      const proseDriftDoctor = inspectDoctor({ packageRoot: REPO_ROOT, targetDir: dir })
      const differingFindings = proseDriftDoctor.dimensions['world-integrity'].filter(
        (f) => f.alignment === 'differing',
      )
      expect(differingFindings.length).toBeGreaterThan(0)

      const ackResult = ackWorld(dir, { all: true })
      expect(ackResult.ok).toBe(true)
      expect(ackResult.updatedAtoms.length).toBeGreaterThan(0)

      const postAckDoctor = inspectDoctor({ packageRoot: REPO_ROOT, targetDir: dir })
      const postAckWorldFindings = postAckDoctor.dimensions['world-integrity']
      expect(
        postAckWorldFindings.every((f) => f.structural === 'valid' && f.alignment === 'matched'),
      ).toBe(true)
    }
  })

  it('(c) 6-way outcome dispatchEnvelope & seat lease equivalence across inbox-fallback and OpenRig-runner modes', () => {
    const { dogfoodDir, envContractDir, dendroDir, all } = setupThreeModeFixtures()

    const expectedMapping = {
      delivered: {
        action: 'fanout_qa_and_review',
        targetSeats: ['dev.qa', 'rev.review'],
        targetSeat: 'dev.qa',
      },
      no_change: {
        action: 'close_slice',
        targetSeat: 'orch.arch',
      },
      feasible_work_remains_same_worker: {
        action: 'redispatch_same_worker',
        targetSeat: 'dev.build',
      },
      concrete_blocker: {
        action: 'escalate_coordinator',
        targetSeat: 'orch.arch',
      },
      unknown_outcome: {
        action: 'reconcile_state',
        targetSeat: 'orch.arch',
      },
      repeated_failure: {
        action: 'trip_circuit_breaker',
        targetSeat: 'steer.lead',
      },
    }

    // 1. Verify seat lease lifecycle & L3 prime reflection in all 3 fixtures
    for (const { mode, dir } of all) {
      const lease = claimSeatLease(dir, {
        seat: 'dev.build',
        occupantSession: `session-${mode}`,
        platform: mode === 'environment-contract' ? 'local-cli' : 'openrig',
        ttlSeconds: 1800,
        now: '2026-10-22T10:00:00.000Z',
      })
      expect(lease.seat).toBe('dev.build')
      expect(lease.expired).toBe(false)

      const readBack = readSeatLease(dir, 'dev.build', { now: '2026-10-22T10:05:00.000Z' })
      expect(readBack?.occupantSession).toBe(`session-${mode}`)
      expect(listSeatLeases(dir, { now: '2026-10-22T10:05:00.000Z' })).toHaveLength(1)

      const primed = primeSeat(dir, {
        seat: 'dev.build',
        situation: 'fresh',
        now: '2026-10-22T10:05:00.000Z',
      })
      expect(primed.layers.l3.lease?.occupantSession).toBe(`session-${mode}`)

      const released = releaseSeatLease(dir, 'dev.build', {
        occupantSession: `session-${mode}`,
        now: '2026-10-22T10:05:00.000Z',
      })
      expect(released.released).toBe(true)
    }

    // 2. Verify all 6 outcomes map deterministically in both inbox-fallback (environment-contract) and OpenRig-runner (dendro / dogfood) modes
    for (const outcome of OUTCOME_ENUM) {
      const fallbackDispatch = dispatchEnvelope(envContractDir, {
        from: 'dev.build',
        to: 'orch.arch',
        outcome,
        summary: `Fallback ${outcome}`,
        openrigActive: false,
      })
      expect(fallbackDispatch.mode).toBe('inbox-fallback')
      expect(fallbackDispatch.nextAction).toEqual(expectedMapping[outcome])
      expect(existsSync(fallbackDispatch.envelopePath)).toBe(true)

      const rigCalls = []
      const openrigDispatch = dispatchEnvelope(dendroDir, {
        from: 'dev.build',
        to: 'orch.arch',
        outcome,
        summary: `OpenRig ${outcome}`,
        openrigActive: true,
        rigRunner: (args, env) => {
          rigCalls.push({ args, outcome: env.outcome })
          return { status: 0 }
        },
      })
      expect(openrigDispatch.mode).toBe('openrig')
      expect(openrigDispatch.nextAction).toEqual(expectedMapping[outcome])
      expect(openrigDispatch.nextAction).toEqual(fallbackDispatch.nextAction)
      expect(rigCalls).toHaveLength(1)
      expect(rigCalls[0].args).toContain('--outcome')
      expect(rigCalls[0].args).toContain(outcome)
      expect(existsSync(openrigDispatch.envelopePath)).toBe(true)

      expect(resolveNextCoordinatorAction({ from: 'dev.build', to: 'orch.arch', outcome })).toEqual(
        expectedMapping[outcome],
      )
    }

    // 3. Enforce steer.lead / human authority for domainStatus: 'goal_complete' across all 3 modes
    for (const { dir } of [{ dir: dogfoodDir }, { dir: envContractDir }, { dir: dendroDir }]) {
      expect(() =>
        dispatchEnvelope(dir, {
          from: 'dev.build',
          to: 'orch.arch',
          outcome: 'delivered',
          domainStatus: 'goal_complete',
          openrigActive: false,
        }),
      ).toThrow(/only steer\.lead or human holds goal completion authority/)

      const steerComplete = dispatchEnvelope(dir, {
        from: 'steer.lead',
        to: 'orch.arch',
        outcome: 'delivered',
        domainStatus: 'goal_complete',
        openrigActive: false,
      })
      expect(steerComplete.envelope.domainStatus).toBe('goal_complete')
    }
  })

  it('(d) Version-pinned @1.10.0 vs @dev dogfood spec isolation & unified multi-pod provisioning', () => {
    const { dogfoodDir, envContractDir, dendroDir } = setupThreeModeFixtures()
    const fakeHome = makeTmpDir('openrig-home-')

    // 1. Verify channel detection for each mode
    expect(resolveProjectSpecChannel(dogfoodDir)).toEqual({
      channel: 'dev',
      version: 'dev',
      suffix: '@dev',
    })
    expect(resolveProjectSpecChannel(envContractDir)).toEqual({
      channel: 'versioned',
      version: '1.10.0',
      suffix: '@1.10.0',
    })
    expect(resolveProjectSpecChannel(dendroDir)).toEqual({
      channel: 'versioned',
      version: '1.10.0',
      suffix: '@1.10.0',
    })

    // 2. Install base specs into isolated fakeHome
    const installLogs = []
    const installCode = install({
      adapterDir: ADAPTER_DIR,
      home: fakeHome,
      options: {},
      operands: [],
      cwd: REPO_ROOT,
      env: process.env,
      out: (msg) => installLogs.push(msg),
    })
    expect(installCode).toBe(0)

    const specsRoot = join(fakeHome, '.openrig', 'specs')
    expect(existsSync(join(specsRoot, 'agentflow@1.10.0', 'rig.yaml'))).toBe(true)
    expect(existsSync(join(specsRoot, 'agentflow@dev', 'rig.yaml'))).toBe(true)

    // 3. Provision dendro in unified mode (`--kind unified`) -> binds to `agentflow@1.10.0`
    const dendroCode = squadProvision({
      adapterDir: ADAPTER_DIR,
      home: fakeHome,
      options: { kind: 'unified' },
      operands: ['dendro', dendroDir],
      cwd: dendroDir,
      env: process.env,
      out: () => {},
    })
    expect(dendroCode).toBe(0)

    // 4. Provision dogfood squad -> binds to `agentflow@dev`
    const dogfoodCode = squadProvision({
      adapterDir: ADAPTER_DIR,
      home: fakeHome,
      options: { kind: 'unified' },
      operands: ['dogfood-host', dogfoodDir],
      cwd: dogfoodDir,
      env: process.env,
      out: () => {},
    })
    expect(dogfoodCode).toBe(0)

    const dendroSquadDir = join(specsRoot, 'agentflow-dendro')
    const dogfoodSquadDir = join(specsRoot, 'agentflow-dogfood-host')

    const dendroContracts = JSON.parse(
      readFileSync(join(dendroSquadDir, 'execution-contracts.json'), 'utf8'),
    )
    const dogfoodContracts = JSON.parse(
      readFileSync(join(dogfoodSquadDir, 'execution-contracts.json'), 'utf8'),
    )

    expect(dendroContracts.baseChannel).toBe('versioned')
    expect(dendroContracts.baseSpec).toBe('agentflow@1.10.0')
    expect(dogfoodContracts.baseChannel).toBe('dev')
    expect(dogfoodContracts.baseSpec).toBe('agentflow@dev')

    // Verify unified topology sibling.md and in-rig pods
    const dendroSibling = readFileSync(join(dendroSquadDir, 'sibling.md'), 'utf8')
    expect(dendroSibling).toContain('# Unified Multi-Pod Topology')
    expect(dendroSibling).toContain('`pm`, `orch`, `dev`, `rev`, and `eval`')

    const dendroRigYaml = readFileSync(join(dendroSquadDir, 'rig.yaml'), 'utf8')
    expect(dendroRigYaml).toContain('id: pm')
    expect(dendroRigYaml).toContain('id: orch')
    expect(dendroRigYaml).toContain('id: dev')
    expect(dendroRigYaml).toContain('id: rev')
    expect(dendroRigYaml).toContain('id: eval')
    expect(dendroRigYaml).not.toContain('id: steer')

    // 5. Verify symlink isolation: mutating a file inside `agentflow@dev` does NOT alter `dendro`'s bridged files in `agentflow@1.10.0`
    const dendroCulturePath = join(dendroSquadDir, 'CULTURE.md')
    const dogfoodCulturePath = join(dogfoodSquadDir, 'CULTURE.md')
    expect(lstatSync(dendroCulturePath).isSymbolicLink()).toBe(true)
    expect(lstatSync(dogfoodCulturePath).isSymbolicLink()).toBe(true)

    const originalDendroCulture = readFileSync(dendroCulturePath, 'utf8')
    const devBaseCulturePath = join(specsRoot, 'agentflow@dev', 'CULTURE.md')
    writeFileSync(
      devBaseCulturePath,
      `${originalDendroCulture}\n<!-- mutated in @dev channel only -->\n`,
      'utf8',
    )

    expect(readFileSync(dogfoodCulturePath, 'utf8')).toContain(
      '<!-- mutated in @dev channel only -->',
    )
    expect(readFileSync(dendroCulturePath, 'utf8')).toBe(originalDendroCulture)
    expect(readFileSync(dendroCulturePath, 'utf8')).not.toContain(
      '<!-- mutated in @dev channel only -->',
    )
  })
})
