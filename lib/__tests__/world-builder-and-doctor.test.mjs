import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectDoctor } from '../services/doctor-service.mjs'
import { readWorldIntegrity } from '../services/doctor-readers.mjs'
import {
  ALLOWED_ATOM_KEYS,
  CORE_REGIONS,
  COVERAGE_DIMENSIONS,
  OPENRIG_REGIONS,
  ackWorld,
  applyWorld,
  findClosestSlug,
  loadL1CoveredDimensions,
  parseWorldManifestYaml,
  refineWorld,
  resolveContainedPath,
  scanWorld,
  serializeWorldManifestYaml,
  validateWorldQuality,
} from '../world/world-builder.mjs'

const cliPath = path.resolve(process.cwd(), 'bin/cli.mjs')

describe('Zero-Copy World Builder, Quality Gate, and Doctor world-integrity (#544)', () => {
  let tmpDir

  function write(relPath, content) {
    const full = path.join(tmpDir, relPath)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }

  function seedCompleteRepo() {
    write(
      'AGENTS.md',
      [
        '# Repository Policy',
        '',
        '## Operating Model & Identity',
        '',
        'Our product mission and single-agent operating model define how work executes.',
        '',
        '```markdown',
        '## Fake Heading Inside Backtick Code Fence',
        '### Fake Subheading Inside Backtick Code Fence',
        '```',
        '',
        '~~~yaml',
        '## Fake Heading Inside Tilde Code Fence',
        '~~~',
        '',
        '## Path Ownership & Terrain Boundaries',
        '',
        'Repository directory structure, worktree isolation, and path ownership boundaries.',
        '',
        '### Builder Custody Rules',
        '',
        'Builder seats cannot edit `tests/oracles/**` and require a Phase 3 oracle digest pin.',
        '',
        '## Governance Laws & Safety Gates',
        '',
        'All changes must pass security review gates and branch discipline invariants.',
        '',
        '## CLI Commands & Verification Affordances',
        '',
        'Run `npm test` and `agentflow-sdlc doctor` to validate repository state.',
        '',
      ].join('\n'),
    )
    write(
      'agent-workflow.config.json',
      JSON.stringify(
        {
          posture: 'assisted',
          ciCommands: ['npm test', 'npm run lint'],
        },
        null,
        2,
      ),
    )
    write(
      'sdlc.config.json',
      JSON.stringify(
        {
          version: '1.0.0',
          posture: 'assisted',
          allowsSelfReview: true,
        },
        null,
        2,
      ),
    )
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'af-world-builder-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('scans H2/H3 sections deterministically, ignores fenced headings, maps regions/dimensions, and copies zero prose', () => {
    seedCompleteRepo()
    const scan = scanWorld(tmpDir)

    expect(scan.zeroProseCopied).toBe(true)
    const addresses = scan.sections.map((s) => s.address)
    expect(addresses).toEqual([
      'AGENTS.md#operating-model-identity',
      'AGENTS.md#path-ownership-terrain-boundaries',
      'AGENTS.md#path-ownership-terrain-boundaries/builder-custody-rules',
      'AGENTS.md#governance-laws-safety-gates',
      'AGENTS.md#cli-commands-verification-affordances',
    ])

    // Code fence headings must never be extracted
    expect(addresses.some((a) => a.includes('fake-heading'))).toBe(false)

    // Core regions are all covered
    expect(scan.missingCoreRegions).toEqual([])
    for (const coreRegion of CORE_REGIONS) {
      expect(scan.regionCoverage[coreRegion].covered).toBe(true)
    }

    // All 8 OpenRig regions and 10 coverage dimensions are present in the coverage maps
    expect(Object.keys(scan.regionCoverage)).toEqual([...OPENRIG_REGIONS])
    expect(Object.keys(scan.dimensionCoverage)).toEqual([...COVERAGE_DIMENSIONS])

    // L1 agentflow-world credits framework dimensions
    const creditedDimensions = Object.values(scan.dimensionCoverage).filter((d) => d.l1Credited)
    expect(creditedDimensions.length).toBeGreaterThan(0)

    // Each section has deterministic sha256 and positive token count, and no raw body text is stored
    for (const sec of scan.sections) {
      expect(sec.sectionSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sec.tokens).toBeGreaterThan(0)
      expect(sec).not.toHaveProperty('text')
      expect(sec).not.toHaveProperty('ownText')
    }
  })

  it('refines and applies a world manifest strictly conforming to ALLOWED_ATOM_KEYS and world-lock.json', () => {
    seedCompleteRepo()
    const plan = refineWorld(tmpDir)

    expect(plan.quality.ok).toBe(true)
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/)

    // Reject missing or mismatched confirmation digest
    expect(() => applyWorld(tmpDir, { confirm: 'wrong-digest' })).toThrow(
      /Confirmation digest mismatch/,
    )
    expect(() => applyWorld(tmpDir, {})).toThrow(/Confirmation digest mismatch/)

    const applied = applyWorld(tmpDir, { confirm: plan.digest })
    expect(applied.ok).toBe(true)

    const manifestRaw = readFileSync(path.join(tmpDir, '.agentflow/world/manifest.yaml'), 'utf8')
    const parsedManifest = parseWorldManifestYaml(manifestRaw)
    expect(parsedManifest.atoms.length).toBe(5)

    for (const atom of parsedManifest.atoms) {
      for (const key of Object.keys(atom)) {
        expect(ALLOWED_ATOM_KEYS).toContain(key)
      }
      // Explicitly verify no hash or token keys leaked into manifest.yaml
      expect(atom).not.toHaveProperty('sectionSha256')
      expect(atom).not.toHaveProperty('sha256')
      expect(atom).not.toHaveProperty('tokens')
    }

    const lock = JSON.parse(
      readFileSync(path.join(tmpDir, '.agentflow/world/world-lock.json'), 'utf8'),
    )
    expect(lock.version).toBe(1)
    expect(Object.keys(lock.atoms).length).toBe(5)
    for (const atomEntry of Object.values(lock.atoms)) {
      expect(atomEntry.address).toMatch(/^AGENTS\.md#/)
      expect(atomEntry.sectionSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(atomEntry.tokens).toBeGreaterThan(0)
    }
    expect(lock.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'agent-workflow.config.json',
          key: 'ciCommands',
          expected: ['npm test', 'npm run lint'],
        }),
        expect.objectContaining({
          file: 'sdlc.config.json',
          key: 'allowsSelfReview',
          expected: true,
        }),
      ]),
    )
  })

  it('enforces quality gate errors (broken pointer, missing core region, unresolved TODO, bad probe) and warnings (whole-file > 800 tokens)', () => {
    // Only identity section present -> missing terrain, laws, affordances
    write(
      'AGENTS.md',
      [
        '# Policy',
        '',
        '## Identity Overview',
        '',
        'Currently there are 5 services running in this project.',
        '',
      ].join('\n'),
    )

    const incompletePlan = refineWorld(tmpDir)
    expect(incompletePlan.quality.ok).toBe(false)
    expect(incompletePlan.quality.errors.some((e) => e.code === 'missing-core-region')).toBe(true)
    expect(incompletePlan.proposedGaps?.path).toBe('.agentflow/world/gaps.md')
    expect(incompletePlan.quality.warnings.some((w) => w.code === 'volatile-marker')).toBe(true)

    // With stubGaps: true, missing core regions are stubbed cleanly and pass quality gate
    const stubbedPlan = refineWorld(tmpDir, { stubGaps: true })
    expect(stubbedPlan.quality.ok).toBe(true)
    const appliedStubs = applyWorld(tmpDir, {
      confirm: stubbedPlan.digest,
      stubGaps: true,
    })
    expect(appliedStubs.gapsPath).toBe('.agentflow/world/gaps.md')
    expect(existsSync(path.join(tmpDir, '.agentflow/world/gaps.md'))).toBe(true)

    // Unresolved TODO in gaps.md fails unless allowStubs is true
    write(
      '.agentflow/world/gaps.md',
      '# Gaps\n\n## Terrain\n\nTODO: fill terrain\n\n## Laws\n\nLaws text\n\n## Affordances\n\nCLI text\n',
    )
    const todoCheck = validateWorldQuality(tmpDir, stubbedPlan.manifest, stubbedPlan.lock, {
      allowStubs: false,
    })
    expect(todoCheck.ok).toBe(false)
    expect(todoCheck.errors.some((e) => e.code === 'unresolved-gap-todo')).toBe(true)

    const allowedTodoCheck = validateWorldQuality(tmpDir, stubbedPlan.manifest, stubbedPlan.lock, {
      allowStubs: true,
    })
    expect(allowedTodoCheck.errors.some((e) => e.code === 'unresolved-gap-todo')).toBe(false)

    // Whole-file pointer > 800 tokens with H2 headings triggers a warning, and broken pointer triggers error
    const longWords = Array.from({ length: 700 }, (_, idx) => `word${idx}`).join(' ')
    write('README.md', `# Readme\n\n## Section One\n\n${longWords}\n`)

    const customManifest = {
      schema: 'openrig.context-pack/v1',
      name: 'custom-world',
      taxonomy: 'world',
      atoms: [
        ...stubbedPlan.manifest.atoms,
        {
          id: 'whole-readme',
          address: 'README.md',
          taxonomy: 'world',
          regions: ['ontology'],
          situations: ['fresh'],
          purpose: 'Whole file pointer',
          order: 10,
          priority: 'recommended',
        },
        {
          id: 'broken-ptr',
          address: 'AGENTS.md#non-existent-heading',
          taxonomy: 'world',
          regions: ['identity'],
          situations: ['fresh'],
          purpose: 'Broken pointer',
          order: 11,
          priority: 'core',
          probe: {
            prompt: 'Test?',
            expect: 'Test',
            expectedPatterns: ['[invalid-regex'],
          },
          extraDisallowedHash: '12345',
        },
      ],
    }

    const customValidation = validateWorldQuality(tmpDir, customManifest, null, {
      allowStubs: true,
    })
    expect(customValidation.ok).toBe(false)
    expect(customValidation.warnings.some((w) => w.code === 'whole-file-over-budget')).toBe(true)
    expect(customValidation.errors.some((e) => e.code === 'unresolved-address')).toBe(true)
    expect(customValidation.errors.some((e) => e.code === 'invalid-core-probe')).toBe(true)
    expect(customValidation.errors.some((e) => e.code === 'disallowed-atom-key')).toBe(true)
  })

  it('doctor 5th dimension world-integrity catches renamed H2 with edit-distance suggestion, ciCommands drift, and resolves content drift via world ack', () => {
    // 1. Before world manifest exists, world-integrity returns 0 findings
    seedCompleteRepo()
    expect(readWorldIntegrity({ targetDir: tmpDir })).toEqual([])

    // 2. Apply valid world manifest and lock
    const plan = refineWorld(tmpDir)
    applyWorld(tmpDir, { confirm: plan.digest })

    const cleanFindings = readWorldIntegrity({ targetDir: tmpDir })
    expect(cleanFindings).toHaveLength(1)
    expect(cleanFindings[0]).toMatchObject({
      id: 'world.manifest',
      dimension: 'world-integrity',
      structural: 'valid',
      alignment: 'matched',
    })

    // 3. Rename an H2 heading in AGENTS.md -> doctor catches structural pointer drift with edit-distance suggestion
    const agentsContent = readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')
    write(
      'AGENTS.md',
      agentsContent.replace(
        '## Path Ownership & Terrain Boundaries',
        '## Path Ownership & Terrain Rules',
      ),
    )

    const pointerDriftReport = inspectDoctor({ packageRoot: process.cwd(), targetDir: tmpDir })
    const worldDim = pointerDriftReport.dimensions['world-integrity']
    const pointerFinding = worldDim.find((f) => f.id.startsWith('world.pointer.'))
    expect(pointerFinding).toBeDefined()
    expect(pointerFinding.structural).toBe('invalid')
    expect(pointerFinding.reason).toContain('Suggested fix: AGENTS.md#path-ownership-terrain-rules')
    expect(
      findClosestSlug('path-ownership-terrain-boundaries', [
        'operating-model-identity',
        'path-ownership-terrain-rules',
        'governance-laws-safety-gates',
      ]),
    ).toBe('path-ownership-terrain-rules')

    // Restore heading name, but modify section body significantly and change ciCommands in agent-workflow.config.json
    write(
      'AGENTS.md',
      agentsContent.replace(
        'Our product mission and single-agent operating model define how work executes.',
        'Our product mission and single-agent operating model define how work executes across distributed OpenRig seats with deterministic verification and strict custody.',
      ),
    )
    write(
      'agent-workflow.config.json',
      JSON.stringify(
        {
          posture: 'assisted',
          ciCommands: ['npm run test:ci'],
        },
        null,
        2,
      ),
    )

    const driftFindings = readWorldIntegrity({ targetDir: tmpDir })
    const claimFinding = driftFindings.find((f) => f.id === 'world.claim.workflow.ciCommands')
    expect(claimFinding).toBeDefined()
    expect(claimFinding.structural).toBe('invalid')
    expect(claimFinding.alignment).toBe('differing')

    const contentDriftFinding = driftFindings.find(
      (f) => f.id === 'world.drift.agents-operating-model-identity',
    )
    expect(contentDriftFinding).toBeDefined()
    expect(contentDriftFinding.reason).toContain(
      'agentflow-sdlc world ack agents-operating-model-identity',
    )

    // Restore ciCommands and run ackWorld to resolve section content drift
    write(
      'agent-workflow.config.json',
      JSON.stringify(
        {
          posture: 'assisted',
          ciCommands: ['npm test', 'npm run lint'],
        },
        null,
        2,
      ),
    )

    const ackResult = ackWorld(tmpDir, { atomId: 'agents-operating-model-identity' })
    expect(ackResult.ok).toBe(true)
    expect(ackResult.updatedAtoms).toEqual(['agents-operating-model-identity'])

    const afterAckFindings = readWorldIntegrity({ targetDir: tmpDir })
    expect(afterAckFindings).toHaveLength(1)
    expect(afterAckFindings[0].alignment).toBe('matched')
  })

  it('supports CLI world scan, refine, apply, and ack commands end-to-end', () => {
    seedCompleteRepo()

    const scanRes = spawnSync(process.execPath, [cliPath, 'world', 'scan', tmpDir, '--json'], {
      encoding: 'utf8',
    })
    expect(scanRes.status).toBe(0)
    const scanJson = JSON.parse(scanRes.stdout)
    expect(scanJson.sections.length).toBe(5)

    const refineRes = spawnSync(
      process.execPath,
      [cliPath, 'world', 'refine', '--target', tmpDir, '--json'],
      { encoding: 'utf8' },
    )
    expect(refineRes.status).toBe(0)
    const refineJson = JSON.parse(refineRes.stdout)
    expect(refineJson.quality.ok).toBe(true)

    const applyRes = spawnSync(
      process.execPath,
      [cliPath, 'world', 'apply', tmpDir, '--confirm', refineJson.digest, '--json'],
      { encoding: 'utf8' },
    )
    expect(applyRes.status).toBe(0)
    expect(JSON.parse(applyRes.stdout).ok).toBe(true)

    const ackRes = spawnSync(
      process.execPath,
      [cliPath, 'world', 'ack', '--all', '--target', tmpDir, '--json'],
      { encoding: 'utf8' },
    )
    expect(ackRes.status).toBe(0)
    expect(JSON.parse(ackRes.stdout).updatedAtoms.length).toBe(5)
  })

  it('rejects path traversal (../../etc/passwd) and symlink escapes in resolveContainedPath, scanWorld, validateWorldQuality, and applyWorld', () => {
    seedCompleteRepo()

    expect(() => resolveContainedPath(tmpDir, '../../etc/passwd')).toThrow(/Unsafe path rejected/)
    expect(() => resolveContainedPath(tmpDir, '/etc/passwd')).toThrow(/Unsafe path rejected/)
    expect(() => resolveContainedPath(tmpDir, 'docs/\0bad.md')).toThrow(/Unsafe path rejected/)

    expect(() => scanWorld(tmpDir, { include: ['../../etc/passwd'] })).toThrow(
      /Unsafe path rejected/,
    )

    const traversalValidation = validateWorldQuality(
      tmpDir,
      {
        schema: 'openrig.context-pack/v1',
        name: 'traversal-test',
        taxonomy: 'world',
        atoms: [
          {
            id: 'escape-atom',
            address: '../../etc/passwd#root',
            taxonomy: 'world',
            regions: ['identity', 'terrain', 'laws', 'affordances'],
            situations: ['fresh'],
            purpose: 'Attempt traversal',
            order: 1,
            priority: 'core',
            probe: {
              prompt: 'Test?',
              expect: 'Test',
              expectedPatterns: ['root'],
            },
          },
        ],
      },
      {
        version: 1,
        atoms: {},
        claims: [
          {
            id: 'escape-claim',
            file: '../../etc/passwd',
            key: 'root',
            expected: true,
          },
        ],
      },
    )
    expect(traversalValidation.ok).toBe(false)
    expect(
      traversalValidation.errors.some(
        (e) => e.code === 'unresolved-address' && e.message.includes('unsafe address path'),
      ),
    ).toBe(true)
    expect(
      traversalValidation.errors.some(
        (e) => e.code === 'broken-claim-source' && e.message.includes('unsafe file path'),
      ),
    ).toBe(true)

    // Verify symlink rejection when .agentflow/world is a symlink to an external directory
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'af-world-outside-'))
    try {
      const plan = refineWorld(tmpDir)
      mkdirSync(path.join(tmpDir, '.agentflow'), { recursive: true })
      symlinkSync(outsideDir, path.join(tmpDir, '.agentflow/world'), 'dir')
      expect(() => applyWorld(tmpDir, { confirm: plan.digest })).toThrow(/symlink/)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }

    // Verify loadL1CoveredDimensions credits OpenRig regions and dimensions
    const l1 = loadL1CoveredDimensions(tmpDir)
    expect(l1.l1Regions.size).toBeGreaterThan(0)
    expect(l1.l1Dimensions.size).toBeGreaterThan(0)
  })
})
