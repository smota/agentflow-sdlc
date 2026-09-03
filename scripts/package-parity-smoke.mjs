#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const scratch = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-package-parity-'))
const packDir = join(scratch, 'pack')
const consumer = join(scratch, 'consumer')
const target = join(scratch, 'target')
const roleTarget = join(scratch, 'role-target')
const npmCli = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find(existsSync)
if (!npmCli) throw new Error('Unable to locate the npm CLI bundled with Node')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  }
  return result.stdout
}

try {
  mkdirSync(packDir)
  mkdirSync(consumer)
  const packed = JSON.parse(
    run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', packDir], {
      cwd: root,
    }),
  )
  const tarball = join(packDir, packed[0].filename)
  run(process.execPath, [npmCli, 'init', '-y'], { cwd: consumer })
  run(
    process.execPath,
    [npmCli, 'install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: consumer,
    },
  )
  const packageRoot = join(consumer, 'node_modules', 'agentflow-sdlc')
  const installedCli = join(packageRoot, 'bin', 'cli.mjs')
  let symlinkRuntimeChecked = false
  if (process.platform === 'linux') {
    const { inspectProcessRuntime } = await import(
      pathToFileURL(join(packageRoot, 'lib/verification/process-collector.mjs'))
    )
    const invocationPath = join(scratch, 'node-invocation')
    symlinkSync(process.execPath, invocationPath)
    const linked = inspectProcessRuntime(scratch, { executable: invocationPath })
    const direct = inspectProcessRuntime(scratch, { executable: process.execPath })
    if (
      linked.executablePath !== invocationPath ||
      linked.identity.executablePathDigest === direct.identity.executablePathDigest ||
      linked.identity.executableContentDigest !== direct.identity.executableContentDigest ||
      run(linked.executablePath, ['--version']).trim() !== process.version
    )
      throw new Error('Runtime fingerprinting changed symlink invocation identity')
    symlinkRuntimeChecked = true
  }
  const sourceHelp = run(process.execPath, [join(root, 'bin', 'cli.mjs'), '--help'])
  const installedHelp = run(process.execPath, [installedCli, '--help'], { cwd: consumer })
  if (sourceHelp !== installedHelp) throw new Error('packed CLI help differs from source checkout')
  const roleValidation = JSON.parse(
    run(process.execPath, [installedCli, 'roles', 'validate', '--json'], { cwd: consumer }),
  )
  if (!roleValidation.ok) throw new Error('packed role catalog validation failed')
  const methodValidation = JSON.parse(
    run(process.execPath, [installedCli, 'methods', 'validate', '--json'], { cwd: consumer }),
  )
  if (!methodValidation.ok) throw new Error('packed method catalog validation failed')
  const rolePreview = JSON.parse(
    run(
      process.execPath,
      [installedCli, 'roles', 'sync', '--target', roleTarget, '--dry-run', '--json'],
      { cwd: consumer },
    ),
  )
  if (rolePreview.mode !== 'dry-run' || existsSync(roleTarget)) {
    throw new Error('packed role adapter preview wrote to the target')
  }
  const plan = JSON.parse(
    run(process.execPath, [installedCli, 'adopt', 'plan', '--target', target, '--json'], {
      cwd: consumer,
    }),
  )
  if (plan.blocked || plan.profile !== 'standard') {
    throw new Error('packed default adoption preview is not a ready standard plan')
  }
  const { applyAdoption, planAdoption, readAdoptionJournal, recoverAdoption, rollbackAdoption } =
    await import(pathToFileURL(join(packageRoot, 'lib', 'adoption', 'transaction.mjs')))
  const { resolveCompositionProfile } = await import(
    pathToFileURL(join(packageRoot, 'lib', 'adoption', 'profiles.mjs'))
  )
  const profileEntrypoints = {
    minimal: 'lib/core/execution-receipt.mjs',
    standard: 'lib/providers/registry.mjs',
    github: 'lib/sources/github.mjs',
    cockpit: 'lib/cockpit-github.mjs',
  }
  const verifiedProfiles = {}
  for (const [profile, entrypoint] of Object.entries(profileEntrypoints)) {
    const profileTarget = join(scratch, `profile-${profile}`)
    const profilePlan = planAdoption(packageRoot, profileTarget, { profile })
    if (profilePlan.blocked) throw new Error(`packed ${profile} adoption plan is blocked`)
    applyAdoption(packageRoot, profileTarget, profilePlan, {
      confirm: profilePlan.token,
      receiptDestination: `${profileTarget}.receipt.json`,
    })
    await import(pathToFileURL(join(profileTarget, entrypoint)))
    const selected = resolveCompositionProfile(profile).managedFiles
    for (const schema of selected.filter((path) => path.endsWith('.json'))) {
      const source = readFileSync(join(profileTarget, schema), 'utf8')
      for (const match of source.matchAll(/"\$ref"\s*:\s*"([^"]+)"/g)) {
        const reference = match[1].split('#', 1)[0]
        if (!reference || reference.includes('://')) continue
        const referenced = resolve(dirname(join(profileTarget, schema)), reference)
        if (!existsSync(referenced)) {
          throw new Error(`${profile} schema reference is missing: ${schema} -> ${reference}`)
        }
      }
    }
    verifiedProfiles[profile] = { files: selected.length, entrypoint }
  }
  const journeyTarget = join(scratch, 'delivery-consumer')
  const containedPlan = planAdoption(packageRoot, journeyTarget, {
    profile: 'standard',
    storage: 'project',
  })
  const containedReceipt = applyAdoption(packageRoot, journeyTarget, containedPlan, {
    confirm: containedPlan.token,
  })
  if (!existsSync(join(journeyTarget, containedReceipt.receiptPath)))
    throw new Error('Contained packed receipt missing')
  const module = (path) => import(pathToFileURL(join(packageRoot, path)))
  const { recordDigest } = await module('lib/core/record-digest.mjs')
  const { fingerprintCandidate } = await module('lib/verification/workspace.mjs')
  const { createAcceptanceContract, createDeliveryReceipt, createAcceptanceDecision } =
    await module('lib/core/role-collaboration.mjs')
  const { createRoleHandoff } = await module('lib/role-catalog.mjs')
  writeFileSync(
    join(journeyTarget, 'app.cjs'),
    'module.exports = value => value.trim().toLowerCase()',
  )
  writeFileSync(
    join(journeyTarget, 'app.test.cjs'),
    "const {test}=require('node:test');test('normalizes query',()=>require('node:assert/strict').equal(require('./app.cjs')(' Search '),'search'))",
  )
  const candidate = { inputs: ['app.cjs', 'app.test.cjs'] }
  const check = {
    id: 'suite',
    criterionId: 'query',
    executable: process.execPath,
    args: ['--test', '--test-reporter=junit', 'app.test.cjs'],
    assertions: ['normalizes query'],
    timeoutMs: 10000,
    format: 'junit-stdout',
  }
  const candidateDigest = fingerprintCandidate(journeyTarget, candidate).digest
  const contract = createAcceptanceContract({
    id: 'consumer-contract',
    subject: 'issue:1',
    ownerRole: 'agentflow:product-manager',
    deliveryRole: 'agentflow:product-manager',
    collaborationClass: 'linear',
    candidateDigest,
    criteria: [
      {
        id: 'query',
        description: 'Normalizes the query',
        verification: 'deterministic',
        required: true,
      },
    ],
    councilPolicy: { required: false, seats: [], decisionOwner: 'agentflow:product-manager' },
  })
  const handoff = createRoleHandoff({
    id: 'consumer-handoff',
    subject: 'issue:1',
    state: 'issued',
    fromRole: contract.ownerRole,
    toRole: contract.deliveryRole,
    acceptanceContract: contract,
  })
  const json = (name, value) => writeFileSync(join(journeyTarget, name), JSON.stringify(value))
  const config = {}
  config.delivery = {
    source: { kind: 'local-preview' },
    candidate,
    checks: { suite: check },
    contracts: { 'product-manager': 'acceptance.json' },
    collaboration: { 'product-manager': 'collaboration.json' },
  }
  json('agent-workflow.config.json', config)
  json('acceptance.json', {
    version: 2,
    goalRevision: 'fixture:1',
    ownerRole: contract.ownerRole,
    collaborationContractDigest: contract.digest,
    criteria: [
      {
        id: 'query',
        definitionDigest: recordDigest({ ...check, ...candidate }),
        assertions: check.assertions,
      },
    ],
  })
  const invoke = (...args) =>
    JSON.parse(
      run(process.execPath, [installedCli, 'run', ...args, '--target', journeyTarget, '--json'], {
        cwd: consumer,
      }),
    ).result
  const mutation = ['--writer', 'package-fixture', '--generation', '0', '--execute']
  invoke('start', 'package-demo', '--goal', 'issue:1', ...mutation)
  invoke('freeze', 'package-demo', ...mutation)
  const observed = invoke('verify', 'package-demo', '--check', 'suite', ...mutation)
  if (observed.verification.outcome !== 'pass')
    throw new Error('Packed workflow did not observe a passing test')
  const evidence = {
    kind: 'validation',
    system: 'local',
    uri: `observation:${observed.verification.observationDigest}`,
    authority: 'working-copy',
    relationship: 'verifies',
  }
  const delivery = createDeliveryReceipt({
    id: 'consumer-delivery',
    handoffDigest: handoff.digest,
    contractDigest: contract.digest,
    producerRole: contract.deliveryRole,
    candidateDigest,
    criteriaResults: [{ criterionId: 'query', status: 'pass', evidenceRefs: [evidence] }],
    evidenceRefs: [evidence],
    provenance: { platform: 'codex', executor: 'package-test-fixture' },
  })
  const decision = createAcceptanceDecision({
    id: 'consumer-acceptance',
    handoff,
    contract,
    delivery,
    decidedByRole: contract.ownerRole,
    state: 'accepted',
    provenance: { platform: 'codex', executor: 'package-test-fixture' },
  })
  json('collaboration.json', { handoff, contract, delivery, decision })
  const next = invoke('next', 'package-demo')
  json('advance.json', next.advancePlan)
  const advanced = invoke(
    'advance',
    'package-demo',
    '--plan',
    'advance.json',
    '--confirm',
    next.confirm,
    ...mutation,
  )
  if (advanced.role !== 'analyst' || advanced.durable !== false)
    throw new Error('Packed workflow acceptance or preview authority mismatch')
  // Derive an explicit test-only upgrade from the packed payload, preserving the
  // real consumer's authored application and configuration throughout recovery.
  const upgradeSource = join(scratch, 'upgrade-fixture')
  cpSync(packageRoot, upgradeSource, { recursive: true })
  const changedPath = 'docs/evidence-contracts.md'
  const beforeUpgrade = readFileSync(join(journeyTarget, changedPath))
  const authoredBefore = readFileSync(join(journeyTarget, 'app.cjs'))
  writeFileSync(
    join(upgradeSource, changedPath),
    Buffer.concat([beforeUpgrade, Buffer.from('\nTest-only packaged upgrade fixture.\n')]),
  )
  const upgrade = planAdoption(upgradeSource, journeyTarget, {
    profile: 'standard',
    storage: 'project',
  })
  if (upgrade.blocked) throw new Error('Supported consumer upgrade fixture is blocked')
  const upgradePlanPath = join(scratch, 'upgrade-plan.json')
  writeFileSync(upgradePlanPath, JSON.stringify(upgrade))
  const interrupted = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {readFileSync} from 'node:fs'; const [url,source,target,path]=process.argv.slice(1); const {applyAdoption}=await import(url); const plan=JSON.parse(readFileSync(path,'utf8')); applyAdoption(source,target,plan,{confirm:plan.token,fault(point){if(point==='apply.after-replace')process.exit(97)}})",
      pathToFileURL(join(packageRoot, 'lib/adoption/transaction.mjs')).href,
      upgradeSource,
      journeyTarget,
      upgradePlanPath,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  )
  if (interrupted.status !== 97)
    throw new Error(`Upgrade interruption fixture failed: ${interrupted.stderr}`)
  const journal = readAdoptionJournal(journeyTarget)
  if (recoverAdoption(journeyTarget, { confirm: journal.recoveryToken }).status !== 'recovered')
    throw new Error('Interrupted packed upgrade did not recover')
  if (!readFileSync(join(journeyTarget, changedPath)).equals(beforeUpgrade))
    throw new Error('Recovery changed prior managed bytes')
  const retry = planAdoption(upgradeSource, journeyTarget, {
    profile: 'standard',
    storage: 'project',
  })
  const upgradedReceipt = applyAdoption(upgradeSource, journeyTarget, retry, {
    confirm: retry.token,
  })
  if (readFileSync(join(journeyTarget, changedPath)).equals(beforeUpgrade))
    throw new Error('Upgrade did not install the changed fixture')
  rollbackAdoption(journeyTarget, upgradedReceipt, { confirm: upgradedReceipt.receiptToken })
  if (
    !readFileSync(join(journeyTarget, changedPath)).equals(beforeUpgrade) ||
    !readFileSync(join(journeyTarget, 'app.cjs')).equals(authoredBefore)
  )
    throw new Error('Packed rollback did not preserve exact prior bytes')
  const required = JSON.parse(
    readFileSync(join(root, 'manifests', 'npm-package.json'), 'utf8'),
  ).requiredFiles
  const packedPaths = new Set(packed[0].files.map((item) => item.path))
  const missing = required.filter((path) => !packedPaths.has(path))
  if (missing.length)
    throw new Error(`packed artifact misses required files: ${missing.join(', ')}`)
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        package: packed[0].filename,
        packageDigest: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
        packageIntegrity: packed[0].integrity,
        payloadManifestDigest: recordDigest(
          JSON.parse(readFileSync(join(packageRoot, 'manifests/product-payload.json'), 'utf8')),
        ),
        runtime: { platform: process.platform, node: process.version, arch: process.arch },
        sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
        sourceDirty: Boolean(run('git', ['status', '--porcelain']).trim()),
        files: packed[0].files.length,
        sourceAndPackedHelpMatch: true,
        symlinkRuntimeChecked,
        roleCatalogValid: roleValidation.ok,
        methodCatalogValid: methodValidation.ok,
        rolePreviewEntries: rolePreview.entries.length,
        defaultProfile: plan.profile,
        adoptionActions: plan.actions.length,
        verifiedProfiles,
        packedDeliveryJourney: {
          containedReceipt: true,
          observedTest: true,
          acceptedTransition: advanced.role,
          durable: advanced.durable,
        },
        packedUpgradeRecovery: {
          testOnlyUpgrade: true,
          interruptedAfterReplacement: true,
          recovered: true,
          rollbackExact: true,
          authoredApplicationPreserved: true,
        },
      },
      null,
      2,
    )}\n`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
