import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, truncateSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectProcessObservation } from '../verification/process-collector.mjs'
import { computeOracleDigest } from '../verification/workspace.mjs'
import { resolveOraclePackage } from '../verification/oracle-package-resolver.mjs'
import { createOraclePackageRequest } from '../core/oracle-package.mjs'
import { createRunService } from '../application/run-service.mjs'
import { runDelivery } from '../../scripts/run-delivery.mjs'
import { createMemoryRunStore } from '../sources/run-store.mjs'
import { validateEvidenceContract } from '../evidence-contracts.mjs'
import Ajv2020 from 'ajv/dist/2020.js'
import { createRunEvent, RUN_EVENT_TYPES } from '../core/run-state.mjs'
const roots = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const controls = [
  'required-field',
  'null-presence',
  'bool-integer',
  'threshold',
  'replay-witness',
  'source-witness',
  'legacy-field',
]
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oracle-package-'))
  roots.push(root)
  mkdirSync(join(root, 'tests/oracles'), { recursive: true })
  const files = {
    'tests/oracles/helper.mjs': `import fs from 'node:fs'; import crypto from 'node:crypto'; const group=process.argv[2]; const cases=JSON.parse(fs.readFileSync('tests/oracles/cases.json')); const valid=x=>Object.hasOwn(x,'nullable')&&x.nullable===null&&Number.isInteger(x.count)&&x.count===2&&x.threshold===10&&x.replay==='r'&&x.source==='s'&&x.legacy==='kept'; let assertions; let witnesses={}; if(group==='calibration'){assertions=[{id:'positive',outcome:valid(cases.positive)?'pass':'fail'},...Object.entries(cases.negative).map(([id,x])=>({id,outcome:valid(x)?'fail':'pass'}))]}else if(group==='nativeBaseline'){const actual=JSON.parse(fs.readFileSync('tests/oracles/native.json'));assertions=[{id:'native-open',outcome:actual.format==='native-v1'&&actual.rows.length===2?'pass':'fail'}];witnesses={baselineInputDigest:crypto.createHash('sha256').update(fs.readFileSync('tests/oracles/native.json')).digest('hex'),expectedInputDigest:crypto.createHash('sha256').update(fs.readFileSync('tests/oracles/expected.json')).digest('hex'),schema:actual.format,rowCount:actual.rows.length,payloadDigest:crypto.createHash('sha256').update(JSON.stringify(actual)).digest('hex')}}else {assertions=[{id:'build-inputs',outcome:fs.readFileSync('tests/oracles/recipe.txt','utf8')==='rebuild-from-source'&&fs.readFileSync('tests/oracles/lock.txt','utf8')==='locked'?'pass':'fail'}]}; fs.writeFileSync(process.env.AGENTFLOW_REPORT_PATH,JSON.stringify({invocationId:process.env.AGENTFLOW_INVOCATION_ID,assertions,witnesses}));`,
    'tests/oracles/recipe.txt': 'rebuild-from-source',
    'tests/oracles/lock.txt': 'locked',
    'tests/oracles/native.json': JSON.stringify({ format: 'native-v1', rows: [1, 2] }),
    'tests/oracles/expected.json': JSON.stringify({
      count: 2,
      nullable: null,
      threshold: 10,
      replay: 'r',
      source: 's',
      legacy: 'kept',
    }),
  }
  const positive = JSON.parse(files['tests/oracles/expected.json'])
  const negative = Object.fromEntries(controls.map((id) => [id, { ...positive }]))
  delete negative['required-field'].count
  delete negative['null-presence'].nullable
  negative['bool-integer'].count = true
  negative.threshold.threshold = 9
  negative['replay-witness'].replay = 'wrong'
  negative['source-witness'].source = 'wrong'
  negative['legacy-field'].legacy = 'lost'
  files['tests/oracles/cases.json'] = JSON.stringify({ positive, negative })
  for (const [path, bytes] of Object.entries(files)) writeFileSync(join(root, path), bytes)
  const kinds = {
    'helper.mjs': ['source', 'executable'],
    'recipe.txt': ['build'],
    'lock.txt': ['dependency'],
    'native.json': ['native-fixture'],
    'expected.json': ['expectation'],
    'cases.json': ['negative-control'],
  }
  const manifest = {
    version: 1,
    artifacts: Object.entries(files).map(([path, bytes]) => ({
      path,
      digest: sha(bytes),
      sizeBytes: Buffer.byteLength(bytes),
      roles: kinds[path.split('/').at(-1)],
    })),
    controlMap: Object.fromEntries(
      controls.map((id) => [id, { assertion: id, artifact: 'tests/oracles/cases.json' }]),
    ),
    baselineInput: 'tests/oracles/native.json',
    expectedInput: 'tests/oracles/expected.json',
    runtimeCriterionId: 'feature-actual-output',
  }
  const manifestPath = 'tests/oracles/manifest.json'
  writeFileSync(join(root, manifestPath), JSON.stringify(manifest))
  const candidate = {
    inputs: [...Object.keys(files), manifestPath],
    context: {
      oracleRun: { runId: 'existing', goalRef: 'issue:525', generation: 0, revocationEpoch: 0 },
    },
  }
  const checks = Object.fromEntries(
    ['calibration', 'nativeBaseline', 'build'].map((group) => [
      group,
      {
        id: group,
        criterionId: `oracle-${group}`,
        executable: process.execPath,
        args: ['tests/oracles/helper.mjs', group],
        format: 'structured',
        assertions:
          group === 'calibration'
            ? ['positive', ...controls]
            : group === 'nativeBaseline'
              ? ['native-open']
              : ['build-inputs'],
        timeoutMs: 5000,
      },
    ]),
  )
  const policy = {
    baselineInput: 'tests/oracles/native.json',
    expectedInput: 'tests/oracles/expected.json',
    manifest: manifestPath,
    identities: Object.fromEntries(
      ['source', 'build', 'dependency', 'executable'].map((role) => [
        role,
        Object.keys(files).filter((path) => kinds[path.split('/').at(-1)].includes(role)),
      ]),
    ),
    controlAssertions: Object.fromEntries(controls.map((id) => [id, id])),
    candidate,
    proofs: Object.fromEntries(
      Object.keys(checks).map((group) => [
        group,
        {
          check: group,
          requiredAssertions: checks[group].assertions,
          entrypoint: 'tests/oracles/helper.mjs',
        },
      ]),
    ),
    requiredControls: [...controls],
    requiredWitnesses: ['schema', 'rowCount', 'payloadDigest'],
    witnessSchema: {
      type: 'object',
      required: ['schema', 'rowCount', 'payloadDigest'],
      properties: {
        schema: { const: 'native-v1' },
        rowCount: { const: 2 },
        payloadDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    runtimeCriterionId: 'feature-actual-output',
  }
  const config = { checks, oracleAssurance: policy }
  const observationRefs = {}
  for (const [group, check] of Object.entries(checks)) {
    const result = collectProcessObservation({
      root,
      definition: { ...check, ...candidate },
      boundary: 'mutate-worktree',
    })
    expect(
      result.observation.outcome,
      JSON.stringify({
        group,
        errors: result.observation.errors,
        stderr: result.observation.stderrExcerpt,
      }),
    ).toBe('pass')
    observationRefs[group] = `.agent-runs/verification/${result.observation.id}/observation.json`
  }
  const state = {
    runId: 'existing',
    goalRef: 'issue:525',
    revision: 'a'.repeat(64),
    generation: 0,
    revocationEpoch: 0,
    candidateDigest: null,
  }
  const proposal = { manifestDigest: sha(readFileSync(join(root, manifestPath))), observationRefs }
  const request = createOraclePackageRequest({
    state,
    sourceRevision: 'source-revision',
    oracleDigest: computeOracleDigest({ packageRoot: root }),
    proposal,
    stage: 'pin',
  })
  return { root, manifest, config, state, proposal, request }
}
describe('collector-resolved oracle package assurance', () => {
  it('admits calibrated package and native observations without claiming feature execution', () => {
    const f = fixture()
    const result = resolveOraclePackage(f)
    expect(result.verified).toBe(true)
    expect(result.receipt.candidateExecutionVerified).toBe(false)
    expect(result.receipt.runtimeCriterionId).toBe('feature-actual-output')
  })
  it('rejects missing negative controls rather than trusting the package own control list', () => {
    const f = fixture()
    f.config.oracleAssurance.requiredControls.push('additional-control')
    expect(() => resolveOraclePackage(f)).toThrow(/control/i)
  })
  it('rejects present-null, boolean/integer and other accepted-invalid probes through real calibration', () => {
    const f = fixture()
    const path = join(f.root, 'tests/oracles/cases.json')
    const cases = JSON.parse(readFileSync(path))
    cases.negative['bool-integer'] = cases.positive
    writeFileSync(path, JSON.stringify(cases))
    const calibration = collectProcessObservation({
      root: f.root,
      definition: { ...f.config.checks.calibration, ...f.config.oracleAssurance.candidate },
      boundary: 'mutate-worktree',
    })
    expect(calibration.observation.outcome).toBe('fail')
    expect(() => resolveOraclePackage(f)).toThrow(/artifact|candidate|changed/i)
  })
  it('rejects self-comparison and baseline witness omissions', () => {
    const f = fixture()
    f.manifest.baselineInput = f.manifest.expectedInput
    writeFileSync(join(f.root, f.config.oracleAssurance.manifest), JSON.stringify(f.manifest))
    expect(() => resolveOraclePackage(f)).toThrow(/manifest|comparison/i)
  })
  it('does not accept invented collector records', () => {
    const f = fixture()
    f.request.proposal.observationRefs.calibration = 'tests/oracles/expected.json'
    expect(() => resolveOraclePackage(f)).toThrow(/request|observation|proof|stale/i)
  })
  it('rejects oversized generated artifacts before hashing their contents', () => {
    const f = fixture()
    const path = join(f.root, 'tests/oracles/helper.mjs')
    truncateSync(path, 690 * 1024 * 1024)
    expect(() => resolveOraclePackage(f)).toThrow(/size|large|artifact/i)
  })
  it('rejects helper/dependency changes and unchecked cached executables', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'tests/oracles/lock.txt'), 'changed')
    expect(() => resolveOraclePackage(f)).toThrow(/artifact|changed|identity/i)
  })
  it('keeps the run-event schema aligned with every canonical existing kind', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../schemas/run-event.schema.json', import.meta.url)),
    )
    expect([...schema.properties.kind.enum].sort()).toEqual([...RUN_EVENT_TYPES].sort())
  })
})

async function serviceFixture(required = true) {
  const store = createMemoryRunStore()
  let snap = await store.append(
    createRunEvent({
      runId: 'existing',
      id: 'start',
      kind: 'started',
      payload: {
        goalRef: 'issue:525',
        owner: 'writer',
        profile: 'standard',
        boundary: 'mutate-worktree',
      },
    }),
    null,
  )
  for (let phase = 0; phase < 3; phase++)
    snap = await store.append(
      createRunEvent({
        runId: 'existing',
        id: `advance-${phase}`,
        previousDigest: snap.revision,
        kind: 'advanced',
        payload: {
          from: phase,
          to: phase + 1,
          candidateDigest: null,
          acceptanceDigest: 'b'.repeat(64),
        },
      }),
      snap.revision,
    )
  const f = fixture()
  const authority = { owner: 'writer', generation: 0 }
  const service = createRunService({
    store,
    authorize: async () => true,
    policy: { oracleAssurance: { required } },
    resolveOraclePackage: (request) => resolveOraclePackage({ ...f, request }),
  })
  return { ...f, service, authority, store }
}
describe('real source pin admission', () => {
  it('requires collector package proof for configured assured pins and stores it on the existing event', async () => {
    const f = await serviceFixture()
    await f.service.pinOracle({
      digest: f.request.oracleDigest,
      proposal: f.proposal,
      authority: f.authority,
    })
    expect((await f.service.read()).state.oraclePackage.receipt.candidateExecutionVerified).toBe(
      false,
    )
    expect((await f.store.read()).events.at(-1).kind).toBe('oracle-pinned')
  })
  it('holds an assured pin with no package and preserves legacy optional API behavior', async () => {
    const f = await serviceFixture()
    await expect(
      f.service.pinOracle({ digest: f.request.oracleDigest, authority: f.authority }),
    ).rejects.toThrow(/package|proposal/i)
    const legacy = await serviceFixture(false)
    await legacy.service.pinOracle({
      digest: legacy.request.oracleDigest,
      authority: legacy.authority,
    })
    expect((await legacy.service.read()).state.oraclePackage).toBeUndefined()
  })
})

it('binds observed baseline witness bytes and rejects edited post-execution reports', () => {
  const f = fixture()
  const path = join(
    f.root,
    f.proposal.observationRefs.nativeBaseline.replace('observation.json', 'report.json'),
  )
  const report = JSON.parse(readFileSync(path))
  report.witnesses.rowCount = 999
  writeFileSync(path, JSON.stringify(report))
  expect(() => resolveOraclePackage(f)).toThrow(/report.*identity|witness/i)
})
it('rechecks assured package identities before developer admission', async () => {
  const f = await serviceFixture()
  await f.service.pinOracle({
    digest: f.request.oracleDigest,
    proposal: f.proposal,
    authority: f.authority,
  })
  writeFileSync(join(f.root, 'tests/oracles/lock.txt'), 'changed')
  await expect(f.service.advance({ contract: {}, authority: f.authority })).rejects.toThrow(
    /artifact|changed/i,
  )
})
it('admits a real configured public oracle-pin command through the existing source ledger', async () => {
  const f = await serviceFixture()
  const events = (await f.store.read()).events
  mkdirSync(join(f.root, '.agent-runs/runs/existing'), { recursive: true })
  writeFileSync(join(f.root, '.agent-runs/runs/existing/events.json'), JSON.stringify(events))
  writeFileSync(
    join(f.root, 'agent-workflow.config.json'),
    JSON.stringify({
      posture: 'autonomous',
      delivery: {
        ...f.config,
        source: { kind: 'local-preview' },
        candidate: { inputs: ['tests/oracles/native.json'] },
      },
    }),
  )
  writeFileSync(
    join(f.root, 'sdlc.config.json'),
    JSON.stringify({
      ...JSON.parse(readFileSync(new URL('../../defaults/sdlc.config.json', import.meta.url))),
      deliveryPolicy: { oracleAssurance: { required: true } },
    }),
  )
  writeFileSync(join(f.root, 'proposal.json'), JSON.stringify(f.proposal))
  const output = []
  const proofExit = await runDelivery(
    [
      'oracle-verify',
      'existing',
      '--target',
      f.root,
      '--check',
      'calibration',
      '--execute',
      '--writer',
      'writer',
      '--json',
    ],
    { emit: (value) => output.push(value) },
  )
  expect(proofExit).toBe(0)
  const exit = await runDelivery(
    [
      'oracle-pin',
      'existing',
      '--target',
      f.root,
      '--digest',
      f.request.oracleDigest,
      '--package',
      'proposal.json',
      '--execute',
      '--writer',
      'writer',
      '--json',
    ],
    { emit: (value) => output.push(value) },
  )
  expect(exit).toBe(0)
  const stored = JSON.parse(readFileSync(join(f.root, '.agent-runs/runs/existing/events.json')))
  expect(stored.at(-1).kind).toBe('oracle-pinned')
  expect(stored.at(-1).payload.oraclePackage.receipt.candidateExecutionVerified).toBe(false)
})

it('does not let a package relabel a demanded negative control as its positive check', () => {
  const f = fixture()
  f.manifest.controlMap['bool-integer'].assertion = 'positive'
  writeFileSync(join(f.root, f.config.oracleAssurance.manifest), JSON.stringify(f.manifest))
  const proposal = {
    ...f.proposal,
    manifestDigest: sha(readFileSync(join(f.root, f.config.oracleAssurance.manifest))),
  }
  const request = createOraclePackageRequest({
    state: f.state,
    sourceRevision: 'source-revision',
    oracleDigest: computeOracleDigest({ packageRoot: f.root }),
    proposal,
    stage: 'pin',
  })
  expect(() => resolveOraclePackage({ ...f, request })).toThrow(/control/i)
})

it('cannot downgrade source-latched assurance by changing live policy to false', async () => {
  const f = await serviceFixture()
  await f.service.pinOracle({
    digest: f.request.oracleDigest,
    proposal: f.proposal,
    authority: f.authority,
  })
  const downgraded = createRunService({
    store: f.store,
    authorize: async () => true,
    policy: { oracleAssurance: { required: false } },
  })
  await expect(downgraded.advance({ contract: {}, authority: f.authority })).rejects.toThrow(
    /package|verifier/i,
  )
})
it('rejects proof replay from another native run or generation', () => {
  const f = fixture()
  const request = createOraclePackageRequest({
    state: { ...f.state, runId: 'different-run', generation: 1 },
    sourceRevision: 'source-revision',
    oracleDigest: f.request.oracleDigest,
    proposal: f.proposal,
    stage: 'pin',
  })
  expect(() => resolveOraclePackage({ ...f, request })).toThrow(/proof|candidate|group/i)
})

it('persists a current developer recheck and rejects advancement that omits it', async () => {
  const f = await serviceFixture()
  await f.service.pinOracle({
    digest: f.request.oracleDigest,
    proposal: f.proposal,
    authority: f.authority,
  })
  const snapshot = await f.service.read()
  const request = createOraclePackageRequest({
    state: snapshot.state,
    sourceRevision: snapshot.revision,
    oracleDigest: f.request.oracleDigest,
    proposal: f.proposal,
    stage: 'developer',
  })
  const { receipt } = resolveOraclePackage({ ...f, request })
  const base = {
    runId: 'existing',
    id: 'developer',
    previousDigest: snapshot.revision,
    kind: 'advanced',
    payload: { from: 3, to: 4, candidateDigest: null, acceptanceDigest: 'b'.repeat(64) },
  }
  const omitted = createMemoryRunStore()
  let previous = null
  for (const event of (await f.store.read()).events) {
    await omitted.append(event, previous)
    previous = event.digest
  }
  await expect(omitted.append(createRunEvent(base), snapshot.revision)).rejects.toThrow(
    /developer proof/i,
  )
  await f.store.append(
    createRunEvent({
      ...base,
      payload: { ...base.payload, oraclePackageVerification: { request, receipt } },
    }),
    snapshot.revision,
  )
  expect((await f.service.read()).state.oraclePackageDeveloper.receipt.digest).toBe(receipt.digest)
  expect(validateEvidenceContract('oracle-package-receipt', receipt, {}, {}, { request }).ok).toBe(
    true,
  )
  expect(validateEvidenceContract('oracle-package-receipt', receipt).ok).toBe(false)
  const schema = JSON.parse(
    readFileSync(new URL('../../schemas/oracle-package.schema.json', import.meta.url)),
  )
  const validate = new Ajv2020({ strict: false }).compile(schema)
  expect(validate(request), JSON.stringify(validate.errors)).toBe(true)
  expect(validate(receipt), JSON.stringify(validate.errors)).toBe(true)
})

it('holds baseline inputs with swapped roles or identical content despite distinct paths', () => {
  for (const mutation of ['roles', 'bytes']) {
    const f = fixture()
    const baseline = f.manifest.artifacts.find((a) => a.path === f.manifest.baselineInput)
    const expected = f.manifest.artifacts.find((a) => a.path === f.manifest.expectedInput)
    if (mutation === 'roles') [baseline.roles, expected.roles] = [expected.roles, baseline.roles]
    else {
      const bytes = readFileSync(join(f.root, expected.path))
      writeFileSync(join(f.root, baseline.path), bytes)
      baseline.digest = sha(bytes)
      baseline.sizeBytes = bytes.length
    }
    writeFileSync(join(f.root, f.config.oracleAssurance.manifest), JSON.stringify(f.manifest))
    const request = createOraclePackageRequest({
      state: f.state,
      sourceRevision: 'source-revision',
      oracleDigest: computeOracleDigest({ packageRoot: f.root }),
      proposal: {
        ...f.proposal,
        manifestDigest: sha(readFileSync(join(f.root, f.config.oracleAssurance.manifest))),
      },
      stage: 'pin',
    })
    expect(() => resolveOraclePackage({ ...f, request })).toThrow(
      /baseline.*(?:identit|role|independent)/i,
    )
  }
})
