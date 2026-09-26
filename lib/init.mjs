import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { COMPOSITION_PROFILES } from './adoption/profiles.mjs'
import { applyAdoption, planAdoption } from './adoption/transaction.mjs'
import { readLockfile } from './lockfile.mjs'
import { recordDigest } from './core/record-digest.mjs'
import { scaffoldHarnessIntelligence } from './config/harness-intelligence.mjs'

// W6b/D1 — `init` detects instead of interrogating. A fresh install used to copy the execution
// adapter (agent-workflow.config.json) verbatim from defaults/agent-workflow.config.json, so it
// always carried this repository's own NEUTRAL placeholder values (branch "main", no test command,
// candidate inputs ["src"]) into every adopter's repository. `init` reads what the target repository
// already says instead. When it cannot detect a fact, it never invents one — it leaves the NEUTRAL
// default unset (or empty) and reports the assumption in plain language.

// W6c/D1 — candidate inputs must never include AgentFlow's own vendored files. `init` runs adoption
// before detection, so by the time facts are detected, agent-framework-lock.json already lists every
// path AgentFlow owns in this target (managed copies and seed-once files alike). Detection excludes
// those paths file-by-file rather than dropping a whole directory, so a directory that mixes adopter
// files with framework files still contributes its adopter-owned files.

// W6c/D2 — a first governed run needs a frozen contract and a configured check, not just an adapter
// file. `init` seeds both, but only from what it actually detected: a check that runs the ADOPTER's
// own detected test command (never an invented one), and a one-criterion starter acceptance contract
// whose criterion is wired to that same check. When no test command or no candidate file was
// detected, neither is seeded — inventing a check against a command or a file that does not exist in
// the adopter's repository is exactly the defect this release removes.

export const ADAPTER_RELATIVE_PATH = 'agent-workflow.config.json'
export const ACCEPTANCE_RELATIVE_PATH = 'agentflow-acceptance.json'
const NPM_INIT_PLACEHOLDER_TEST_SCRIPT = 'echo "Error: no test specified" && exit 1'
const CONVENTIONAL_SOURCE_DIRS = ['src', 'lib', 'app', 'source']
const STARTER_CRITERION_ID = 'starter'
const STARTER_ASSERTION = 'starter-criterion — replace with a real assertion from your test output'
const STARTER_TIMEOUT_MS = 300000

function defaultGitRunner(targetDir, args) {
  return execFileSync('git', ['-C', targetDir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

const CONVENTIONAL_TRUNK_BRANCHES = ['main', 'master', 'development', 'trunk']

// Detects the repository's default trunk branch. It checks origin/HEAD first, then current HEAD
// only if it is a conventional trunk branch (main, master, development). It never assumes an
// arbitrary feature branch is trunk.
export function detectDefaultBranch(targetDir, { runner = defaultGitRunner } = {}) {
  try {
    const remoteHead = runner(targetDir, [
      'symbolic-ref',
      '--short',
      'refs/remotes/origin/HEAD',
    ]).trim()
    if (remoteHead) {
      const stripped = remoteHead.replace(/^origin\//, '')
      if (stripped) {
        return {
          detected: true,
          value: stripped,
          source: 'git symbolic-ref --short refs/remotes/origin/HEAD',
        }
      }
    }
  } catch {
    /* origin/HEAD not available */
  }

  try {
    const branch = runner(targetDir, ['symbolic-ref', '--short', 'HEAD']).trim()
    if (CONVENTIONAL_TRUNK_BRANCHES.includes(branch)) {
      return { detected: true, value: branch, source: 'git symbolic-ref --short HEAD' }
    }
  } catch {
    /* Not a git repository, detached HEAD, or git unavailable in this context. */
  }

  for (const candidate of CONVENTIONAL_TRUNK_BRANCHES) {
    try {
      runner(targetDir, ['rev-parse', '--verify', `refs/heads/${candidate}`])
      return { detected: true, value: candidate, source: `git rev-parse refs/heads/${candidate}` }
    } catch {
      /* Candidate does not exist locally */
    }
  }

  return { detected: false, value: null, source: null }
}

// Detects the adopter's own test command from their package.json. It writes exactly what the
// adopter's own manifest says — never a package manager or script name assumed from this
// repository. The npm-init placeholder script is not a real command, so it is treated as absent.
export function detectTestCommand(targetDir) {
  const packageJsonPath = join(targetDir, 'package.json')
  if (!existsSync(packageJsonPath))
    return {
      detected: false,
      value: null,
      reason: 'no package.json found in the target repository',
    }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    return { detected: false, value: null, reason: 'package.json could not be parsed as JSON' }
  }
  const script = manifest?.scripts?.test
  if (
    typeof script !== 'string' ||
    script.trim().length === 0 ||
    script.trim() === NPM_INIT_PLACEHOLDER_TEST_SCRIPT
  ) {
    return {
      detected: false,
      value: null,
      reason: 'no scripts.test found in the target package.json',
    }
  }
  return { detected: true, value: script.trim(), source: 'package.json scripts.test' }
}

function listFilesRecursive(dir, root) {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let info
    try {
      info = lstatSync(full)
    } catch {
      continue
    }
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) files.push(...listFilesRecursive(full, root))
    else if (info.isFile()) files.push(relative(root, full).replaceAll('\\', '/'))
  }
  return files
}

// Detects candidate source files that actually exist in the target, excluding every path AgentFlow
// itself owns there. It never invents a conventional directory name (e.g. "src") that is not present
// on disk, and it never treats AgentFlow's own vendored files as the adopter's candidate: D1 requires
// the lockfile — the source of truth for what AgentFlow owns — not a hardcoded list of directory
// names, so a directory that mixes adopter and managed files contributes only the adopter's files.
export function detectCandidateInputs(targetDir, { managedPaths = new Set() } = {}) {
  const root = resolve(targetDir)
  const files = []
  for (const dir of CONVENTIONAL_SOURCE_DIRS) {
    const dirPath = join(root, dir)
    if (!existsSync(dirPath)) continue
    let st
    try {
      st = lstatSync(dirPath)
    } catch {
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue
    for (const file of listFilesRecursive(dirPath, root)) {
      if (!managedPaths.has(file)) files.push(file)
    }
  }
  files.sort()
  if (files.length === 0)
    return {
      detected: false,
      value: [],
      reason:
        'no adopter-owned file found in a conventional source directory (src, lib, app, source) once files AgentFlow itself owns are excluded',
    }
  return {
    detected: true,
    value: files,
    source:
      'files under existing top-level directories, excluding paths owned by agent-framework-lock.json',
  }
}

export function detectRepositoryFacts(targetDir, { runner } = {}) {
  const lock = readLockfile(targetDir)
  const managedPaths = new Set(Object.keys(lock.files))
  return {
    branch: detectDefaultBranch(targetDir, runner ? { runner } : {}),
    testCommand: detectTestCommand(targetDir),
    candidateInputs: detectCandidateInputs(targetDir, { managedPaths }),
  }
}

export function assumptionNotes(facts) {
  const notes = []
  if (!facts.branch.detected)
    notes.push(
      'branch: could not detect the repository\'s current branch; kept the NEUTRAL default "main" — set branching.trunk yourself if that is wrong',
    )
  if (!facts.testCommand.detected)
    notes.push(
      `test command: ${facts.testCommand.reason}; wrote no CI-equivalent command — add one to ciCommands yourself`,
    )
  if (!facts.candidateInputs.detected)
    notes.push(
      `candidate inputs: ${facts.candidateInputs.reason}; wrote an empty list — set delivery.candidate.inputs yourself`,
    )
  if (!facts.testCommand.detected || !facts.candidateInputs.detected)
    notes.push(
      `governed run: seeded no starter check or acceptance contract because ${
        !facts.testCommand.detected
          ? 'no test command was detected'
          : 'no candidate file was detected'
      } — add delivery.checks and delivery.contracts yourself before \`run freeze\``,
    )
  return notes
}

// W6c/D2 — the starter check runs the adopter's own detected test command through `npm test` (the
// standard, always-resolvable way to run whatever `package.json` already declares); it never invents
// a substitute command. The one starter criterion is wired to that exact check: its definitionDigest
// is recordDigest({...check, ...candidate}), the same rule every other check in this project follows
// (see docs/run-operations.md). Both are seeded together, or neither is: a criterion with no matching
// check is a contract this repository cannot honestly verify.
function buildStarterGovernance(facts) {
  if (!facts.testCommand.detected || !facts.candidateInputs.detected) return null
  const candidate = { inputs: facts.candidateInputs.value }
  const check = {
    id: STARTER_CRITERION_ID,
    criterionId: STARTER_CRITERION_ID,
    executable: 'npm',
    args: ['test'],
    assertions: [STARTER_ASSERTION],
    timeoutMs: STARTER_TIMEOUT_MS,
    // W8e / D1 — most real test scripts print nothing that looks like JUnit XML; seeding
    // 'junit-stdout' here is what made a passing test produce a failing first `run verify`
    // (finding 1). 'exit-code' is a format whose one assertion passes exactly when the process
    // exits 0, so a plain, ordinary `npm test` is observed honestly. JUnit stays available (see
    // lib/verification/process-collector.mjs) for projects that configure a check to emit it.
    format: 'exit-code',
  }
  const inheritEnv = toolchainEnvironmentNames()
  if (inheritEnv.length) check.inheritEnv = inheritEnv
  const acceptance = {
    version: 2,
    goalRevision: 'starter — replace once a real goal exists',
    criteria: [
      {
        id: STARTER_CRITERION_ID,
        definitionDigest: recordDigest({ ...check, ...candidate }),
        assertions: [STARTER_ASSERTION],
      },
    ],
  }
  return { check, acceptance }
}

function applyDetectedValues(baseConfig, facts) {
  const config = JSON.parse(JSON.stringify(baseConfig))
  if (facts.branch.detected) {
    const branch = facts.branch.value
    config.branching.trunk = branch
    config.branching.integration = branch
    config.branching.defaultPrTarget = branch
    config.branching.directEditDeniedBranches = [branch]
    config.branching.promotionOrder = [branch]
    if (config.integrationLifecycle) {
      config.integrationLifecycle.integrationBranch = branch
      config.integrationLifecycle.trunkBranch = branch
    }
  }
  config.ciCommands = facts.testCommand.detected ? [facts.testCommand.value] : []
  config.delivery = config.delivery ?? {}
  config.delivery.candidate = config.delivery.candidate ?? {}
  config.delivery.candidate.inputs = facts.candidateInputs.value
  const governance = buildStarterGovernance(facts)
  if (governance) {
    config.delivery.checks = { [STARTER_CRITERION_ID]: governance.check }
    config.delivery.contracts = { 'product-manager': ACCEPTANCE_RELATIVE_PATH }
  } else {
    delete config.delivery.checks
    delete config.delivery.contracts
  }
  return { config, governance }
}

function writeAdapter(adapterPath, config) {
  writeFileSync(adapterPath, `${JSON.stringify(config, null, 2)}\n`)
}

// Runs the detecting install. It reuses the existing transactional adoption pipeline (the same one
// `adopt plan`/`adopt apply` use) so file staging, conflict detection and lockfile bookkeeping stay
// in one place; init only adds detection on top of the execution adapter it writes. Existing
// configuration is preserved even when --force is supplied; only an explicit posture modifies it.
export function runInit({
  packageRoot,
  targetDir,
  force = false,
  profile = COMPOSITION_PROFILES.defaultProfile,
  posture,
  scaffoldHarness = true,
  syncAdapters = false,
  runner,
} = {}) {
  const root = resolve(targetDir)
  const adapterPath = join(root, ADAPTER_RELATIVE_PATH)
  const existedBefore = existsSync(adapterPath)

  if (existedBefore) {
    if (lstatSync(adapterPath).isSymbolicLink())
      throw new Error('Existing configuration is a link; preserve it and use runtime recovery')
    const current = JSON.parse(readFileSync(adapterPath, 'utf8'))
    if (!current || typeof current !== 'object' || Array.isArray(current))
      throw new Error('Existing configuration must be a JSON object')
  }

  const plan = planAdoption(packageRoot, root, {
    profile,
    storage: 'project',
    seedValues: existedBefore && posture ? { 'agent-workflow.config.json': { posture } } : {},
  })
  if (plan.blocked) {
    return { status: 'blocked', conflicts: plan.conflicts, adapterPath }
  }
  const receipt = applyAdoption(packageRoot, root, plan, { confirm: plan.token })

  const facts = detectRepositoryFacts(root, runner ? { runner } : {})
  const acceptancePath = join(root, ACCEPTANCE_RELATIVE_PATH)

  let detectedConfig
  let governance = null

  if (existedBefore) {
    detectedConfig = JSON.parse(readFileSync(adapterPath, 'utf8'))
  } else {
    const baseConfig = JSON.parse(
      readFileSync(join(packageRoot, 'defaults/agent-workflow.config.json'), 'utf8'),
    )
    const applied = applyDetectedValues(baseConfig, facts)
    detectedConfig = applied.config
    governance = applied.governance
    if (posture) {
      detectedConfig.posture = posture
    }
    writeAdapter(adapterPath, detectedConfig)
    if (governance) {
      writeFileSync(acceptancePath, `${JSON.stringify(governance.acceptance, null, 2)}\n`)
    }
  }

  let harnessResult = null
  if (scaffoldHarness) {
    harnessResult = scaffoldHarnessIntelligence(root, { force: false })
  }

  return {
    status: 'initialized',
    adapterPath,
    profile: plan.profile,
    posture: detectedConfig.posture,
    facts,
    assumptions: assumptionNotes(facts),
    receiptPath: receipt.receiptPath,
    changed: receipt.changed,
    governed: Boolean(governance) && !existedBefore,
    acceptancePath: governance && !existedBefore ? acceptancePath : null,
    harnessIntelligence: harnessResult,
    syncedAdapters: null,
    skillInstruction:
      'Skills and runtime tools are managed by the runtime using its own discovery mechanisms.',
  }
}

// The collector runs a check in a closed environment so an observation is reproducible (see
// executionEnvironment in lib/verification/process-collector.mjs). Version managers such as mise,
// asdf, volta or nvm resolve the right `npm` through their own variables and the user's profile
// directories; stripped of those, the adopter's test command fails before it runs. Only the NAMES of
// variables present right now are recorded, never their values, and only from these families.
const TOOLCHAIN_ENV_PATTERN =
  /^(MISE_|ASDF_|VOLTA_|NVM_|FNM_|PYENV|RTX_|PNPM_HOME$|NODE_OPTIONS$|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$)/

export function toolchainEnvironmentNames(env = process.env) {
  return Object.keys(env)
    .filter((name) => env[name] !== undefined && TOOLCHAIN_ENV_PATTERN.test(name))
    .sort()
}
