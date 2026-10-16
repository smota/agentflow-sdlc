// OpenRig execution adapter lifecycle: install or recover the two generic bases, refresh them from
// this product, and provision, update, list, or remove per-project squads. Called through
// `agentflow-sdlc adapters ...`; core dispatches here by adapter id and knows nothing below.
// It calls `rig` only for status, stop, and spec sync, as an argument array without a shell.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { loadAuthoritativeConfigs, validateConfigAuthority } from '../../lib/config/authority.mjs'
import { executionDocument, parseExecutionYaml, planRigExecution } from './execution-plan.mjs'
import { normalizeContractModel } from '../../lib/config/execution-contract.mjs'
import { planRigMutation } from './mutation.mjs'

import {
  COMPACT_NODE_FIELDS,
  evaluateOperationalPreflight,
  parseCompactObservation,
} from './operational-preflight.mjs'

const ADAPTER_ID = 'openrig'
const BASES = { delivery: 'agentflow', product: 'agentflow-product', steer: 'agentflow-steer' }
const BASE_NAMES = Object.values(BASES)
const DELIVERY_PI_SEATS = [
  'orch-arch',
  'rev-review',
  'dev-build-jr',
  'dev-build',
  'dev-build-sr',
  'dev-qa',
  'dev-test-eng',
]
const SHARED_DIRS = ['agents', 'startup', 'policies']
const SHARED_FILES = ['CULTURE.md', 'README.md', 'configurations.yaml', 'steer-guard.mjs']
const PI_SHARED_FILES = ['settings.json', 'models-store.json', 'auth.json']
const PI_SHARED_DIRS = ['npm']
const GROK_MARKER = {
  type: 'oauth',
  access: 'pi-grok-cli-account-vault-v1',
  refresh: 'pi-grok-cli-account-vault-v1',
  expires: 9007199254740991,
}
export const GIT_EXCLUDES = [
  'CLAUDE.local.md',
  'AGENTS.md',
  '/.openrig/',
  '.openrig/',
  '/.worktrees/',
  '.worktrees/',
  '.claude/settings.local.json',
  'gate-lane-verdict.json',
]

function fail(message) {
  const error = new Error(message)
  error.exitCode = 1
  throw error
}

function locations(home) {
  return {
    specs: join(home, '.openrig', 'specs'),
    piState: join(home, '.openrig', 'state', 'pi'),
    piAgent: join(home, '.pi', 'agent'),
    steerState: join(home, '.openrig', 'steer'),
  }
}

export function parsePresets(text) {
  const value = parseExecutionYaml(text, 'bundle configurations')
  return { recommended: value.recommended ?? '', presets: value.presets ?? {} }
}

function resolvePreset(configFile, requested) {
  const { recommended, presets } = parsePresets(readFileSync(configFile, 'utf8'))
  const name = requested || recommended
  if (!presets[name]) {
    fail(
      `Unknown preset "${name}" in ${configFile}. Known presets: ${Object.keys(presets).join(', ')}.`,
    )
  }
  return { name, seats: presets[name] }
}

function piSeatsOf(preset, rigName) {
  return Object.entries(preset.seats)
    .filter(([, value]) => (typeof value === 'string' ? value : value.runtime) === 'pi')
    .map(([seat]) => `${seat.replaceAll('.', '-')}@${rigName}`)
}

// Validates everything install needs before anything is written.
function planInstall(adapterDir, requested) {
  const sources = {
    delivery: join(adapterDir, BASES.delivery),
    product: join(adapterDir, BASES.product),
    steer: join(adapterDir, BASES.steer),
  }
  const delivery = resolvePreset(join(sources.delivery, 'configurations.yaml'), requested)
  const product = resolvePreset(join(sources.product, 'configurations.yaml'), requested)
  if (delivery.name !== product.name) {
    fail(`Delivery preset "${delivery.name}" and product preset "${product.name}" differ.`)
  }
  const steerPresetName = resolvePreset(join(sources.steer, 'configurations.yaml'), requested).name
  const executionPlans = {}
  for (const [kind, dir] of Object.entries(sources)) {
    const plan = planRigExecution({
      rigText: readFileSync(join(dir, 'rig.yaml'), 'utf8'),
      configText: readFileSync(join(dir, 'configurations.yaml'), 'utf8'),
      preset: kind === 'steer' ? steerPresetName : delivery.name,
    })
    if (!plan.ok)
      fail(
        plan.diagnostics
          .filter((item) => item.severity === 'error')
          .map((item) => `${item.seat}: ${item.message}`)
          .join('; '),
      )
    executionPlans[kind] = plan
  }
  return {
    sources,
    executionPlans,
    preset: delivery.name,
    piSeats: Object.entries(executionPlans).flatMap(([kind, plan]) =>
      plan.contracts
        .filter((item) => item.runtime === 'pi')
        .map((item) => `${item.seat.replaceAll('.', '-')}@${BASES[kind]}`),
    ),
  }
}

function lexists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

// Remove a link without following it, then anything else at that path.
function clearPath(path) {
  if (!lexists(path)) return
  if (lstatSync(path).isSymbolicLink()) {
    try {
      unlinkSync(path)
    } catch {
      rmdirSync(path) // A Windows directory junction is removed as a directory entry.
    }
    return
  }
  rmSync(path, { recursive: true, force: true })
}

// Remove a tree whose direct entries may be links into shared state, unlinking those first.
function removeTree(dir) {
  if (!lexists(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) clearPath(path)
    else if (entry.isDirectory()) removeTree(path)
  }
  rmSync(dir, { recursive: true, force: true })
}

// A directory bridge is a junction (no administrator rights on Windows; a symlink elsewhere).
// A file bridge is a symlink. Either falls back to a copy when the link cannot be created.
function bridge(target, path, isDirectory) {
  clearPath(path)
  try {
    symlinkSync(target, path, isDirectory ? 'junction' : 'file')
  } catch {
    if (isDirectory) cpSync(target, path, { recursive: true })
    else copyFileSync(target, path)
  }
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory()
}

function bridgePiSeat(home, seat) {
  const { piState, piAgent } = locations(home)
  const agentDir = join(piState, seat, 'agent')
  mkdirSync(agentDir, { recursive: true })
  for (const name of PI_SHARED_FILES) {
    if (isFile(join(piAgent, name))) bridge(join(piAgent, name), join(agentDir, name), false)
  }
  for (const name of PI_SHARED_DIRS) {
    if (isDirectory(join(piAgent, name))) bridge(join(piAgent, name), join(agentDir, name), true)
  }
}

// Issue 363: a product Pi seat loads this extension from its own agent directory. It blocks the
// seat's direct sends (rig send, rig queue create/handoff, tmux send-keys) with the guard installed
// in the product base. If the guard cannot load, Pi blocks the tool call: the seat fails closed.
export const PI_GUARD_EXTENSION = 'agentflow-handoff-guard.js'
const PI_GUARD_SOURCE = `// Generated by agentflow-sdlc (issue 363). Do not edit; adapters squads update rewrites it.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export default function agentflowHandoffGuard(pi) {
  pi.on('tool_call', async (event) => {
    const command = event.input?.command
    if (command === undefined || command === null) return undefined
    const guardPath = join(homedir(), '.openrig', 'specs', 'agentflow-product', 'handoff-guard.mjs')
    const guard = await import(pathToFileURL(guardPath).href)
    const decision = guard.guardDecision({
      session: process.env.OPENRIG_SESSION_NAME,
      command: Array.isArray(command) ? command.join(' ') : String(command),
    })
    return decision.block ? { block: true, reason: decision.reason } : undefined
  })
}
`

function isProductSeatName(seat) {
  return /^pm-[^@]+@/.test(seat)
}

function installPiGuard(home, seat) {
  const dir = join(locations(home).piState, seat, 'agent', 'extensions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PI_GUARD_EXTENSION), PI_GUARD_SOURCE)
}

function ensureGrokMarker(home, out) {
  const authPath = join(locations(home).piAgent, 'auth.json')
  if (!isFile(authPath)) {
    out('   (No ~/.pi/agent/auth.json; skipping.)')
    return
  }
  const auth = JSON.parse(readFileSync(authPath, 'utf8'))
  if (auth['grok-cli']) {
    out('   grok-cli marker already present in ~/.pi/agent/auth.json')
    return
  }
  auth['grok-cli'] = GROK_MARKER
  writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
  out('   Added grok-cli marker to ~/.pi/agent/auth.json')
}

function git(args, env) {
  return spawnSync('git', args, { encoding: 'utf8', env, shell: false })
}

// The exclude file Git reads for this checkout. A linked worktree has a .git file, not a
// directory, so ask Git; it resolves info/exclude to the common git dir every worktree reads.
function gitExcludeFile(dir, env) {
  if (!isDirectory(dir)) return null
  const inside = git(['-C', dir, 'rev-parse', '--is-inside-work-tree'], env)
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') return null
  const path = git(
    ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    env,
  )
  if (path.error || path.status !== 0) return null
  return resolve(path.stdout.trim())
}

function applyExcludes(excludeFile) {
  mkdirSync(dirname(excludeFile), { recursive: true })
  const existing = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : ''
  const present = new Set(existing.split(/\r?\n/))
  const missing = GIT_EXCLUDES.filter((line) => !present.has(line))
  if (missing.length === 0) return
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  writeFileSync(excludeFile, `${existing}${separator}${missing.join('\n')}\n`)
}

// The live daemon serves this user's own library, whatever --home says, so `rig` is called only
// when --home is this user's home. Anywhere else (a test or staging home) OpenRig is not contacted.
function contactsOpenRig(ctx) {
  return resolve(ctx.home) === resolve(homedir())
}

// On Windows an npm-installed `rig` is a rig.cmd shim, which Node cannot spawn without a shell.
function rigShimOnPath(env) {
  if (process.platform !== 'win32') return false
  const pathValue = env.PATH ?? env.Path ?? ''
  return pathValue
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => ['rig.cmd', 'rig.bat'].some((name) => isFile(join(dir, name))))
}

// `rig` is optional. Returns null when OpenRig is not contacted or `rig` is not installed. Any
// other spawn failure (including a Windows shim that cannot run without a shell) is returned as
// a result with `error`, so callers that must fail closed can tell it from absence.
function rig(args, ctx) {
  if (!contactsOpenRig(ctx)) return null
  const result = spawnSync('rig', args, { encoding: 'utf8', env: ctx.env, shell: false })
  if (result.error?.code === 'ENOENT' && !rigShimOnPath(ctx.env)) return null
  return result
}

function daemonRunning(ctx) {
  const result = rig(['daemon', 'status'], ctx)
  if (!result || result.error || result.status !== 0) return false
  return /\brunning\b/i.test(result.stdout) && !/not running/i.test(result.stdout)
}

// Rig statuses by name. `error` is set when `rig` is reachable but its status could not be read;
// it stays null when OpenRig is not contacted or not installed, since then no rig can be running.
function rigStatuses(ctx) {
  const statuses = new Map()
  const result = rig(['ps', '--json'], ctx)
  if (!result) return { statuses, error: null }
  if (result.error) return { statuses, error: result.error.message }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    return { statuses, error: `rig ps exited ${result.status}${detail ? `: ${detail}` : ''}` }
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { statuses, error: 'rig ps --json output is not JSON' }
  }
  // A bare array lists every rig; an envelope must say it is not truncated, or a rig may be missing.
  const rows = Array.isArray(parsed) ? parsed : parsed?.entries
  if (!Array.isArray(rows)) return { statuses, error: 'rig ps --json output has no rig rows' }
  if (!Array.isArray(parsed) && parsed.truncated !== false) {
    return { statuses, error: 'rig ps --json output may be truncated' }
  }
  // Every row needs a rig name and a status; one unreadable row makes the whole answer unknown.
  for (const row of rows) {
    const valid =
      row !== null &&
      typeof row === 'object' &&
      typeof row.rigName === 'string' &&
      row.rigName !== '' &&
      typeof row.status === 'string' &&
      row.status !== ''
    if (!valid)
      return {
        statuses,
        error: `rig ps --json row is missing rigName or status: ${JSON.stringify(row)}`,
      }
    statuses.set(row.rigName, row.status)
  }
  return { statuses, error: null }
}

function syncSpecLibrary(ctx) {
  const { out } = ctx
  if (!contactsOpenRig(ctx)) {
    out(
      "   (--home is not this user's home, so OpenRig was not contacted. Sync later with 'rig specs sync'.)",
    )
    return false
  }
  if (daemonRunning(ctx)) {
    const result = rig(['specs', 'sync'], ctx)
    out(
      result?.status === 0
        ? '   Spec library synced.'
        : '   rig specs sync failed; run it again later.',
    )
    return true
  }
  out(
    "   (OpenRig is not running or not on PATH; the spec library syncs on the next daemon start or 'rig specs sync'.)",
  )
  return false
}

function mirror(source, target) {
  removeTree(target)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
}

function filesUnder(dir, base = dir) {
  if (!existsSync(dir)) return []
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(path, base))
    else if (entry.isFile()) found.push(relative(base, path).split('\\').join('/'))
  }
  return found
}

// Copy the product tree onto the installed tree. Extras stay unless exact is set.
function refreshTree(source, target, { exact }) {
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
  const shipped = new Set(filesUnder(source))
  const extras = filesUnder(target).filter((file) => !shipped.has(file))
  if (exact) {
    for (const file of extras) rmSync(join(target, file))
    return []
  }
  return extras
}

function writeBases(home, plan, out) {
  const { specs } = locations(home)
  out('==> 1. Syncing AgentFlow delivery, product, and steer bases to the OpenRig user library...')
  for (const [kind, name] of Object.entries(BASES)) {
    mirror(plan.sources[kind], join(specs, name))
    writeFileSync(join(specs, name, 'rig.yaml'), plan.executionPlans[kind].rigText)
    const bundle = parseExecutionYaml(
      readFileSync(join(plan.sources[kind], 'configurations.yaml'), 'utf8'),
      'bundle',
    )
    if (plan.preset === bundle.distribution?.profile)
      writeFileSync(
        join(specs, name, 'execution-distribution.json'),
        JSON.stringify(bundle.distribution, null, 2) + '\n',
      )
  }
}

function setupPiSeats(home, plan, out) {
  out('==> 2. Ensuring the grok-cli marker and Pi state bridges for Pi seats...')
  if (plan.piSeats.length === 0) {
    out(`   (Preset '${plan.preset}' has no Pi seats; skipping.)`)
    return
  }
  // The marker comes first so a copied (not linked) auth.json still carries it.
  ensureGrokMarker(home, out)
  for (const seat of plan.piSeats) {
    bridgePiSeat(home, seat)
    if (isProductSeatName(seat)) installPiGuard(home, seat)
  }
}

function installBases(ctx, requested, repoExcludeFile) {
  const { adapterDir, home, out } = ctx
  const plan = planInstall(adapterDir, requested)
  out(`==> Preset: ${plan.preset} (Pi seats: ${plan.piSeats.join(' ') || 'none'})`)
  writeBases(home, plan, out)
  setupPiSeats(home, plan, out)
  out('==> 3. Ensuring Git hygiene in the target repository...')
  if (repoExcludeFile) {
    applyExcludes(repoExcludeFile)
    out(`   Git hygiene exclusions configured in ${repoExcludeFile}`)
  } else {
    out('   (No target repository given; skipping. Pass a repository path to apply the excludes.)')
  }
  out('==> 4. Syncing OpenRig spec library...')
  syncSpecLibrary(ctx)
  return plan
}

export function install(ctx) {
  const { options, operands, cwd, env, out } = ctx
  // Validate the preset and the repository before writing anything.
  planInstall(ctx.adapterDir, options.preset)
  let excludeFile = null
  if (operands[0] !== undefined) {
    excludeFile = gitExcludeFile(resolve(cwd, operands[0]), env)
    if (!excludeFile) fail(`'${operands[0]}' is not a Git repository.`)
  }
  installBases(ctx, options.preset, excludeFile)
  out('==> AgentFlow SDLC bases installed.')
  out('    Delivery base: rig up agentflow --cwd /path/to/project')
  out('    Product base:  rig up agentflow-product --cwd /path/to/project')
  out('    Steer base:    rig up agentflow-steer --cwd /path/to/project')
  out(
    `    Per-project squad: agentflow-sdlc adapters squads provision ${ADAPTER_ID} --kind delivery|product|steer|all <project> <path>`,
  )
  return 0
}

export function update(ctx) {
  const { adapterDir, home, out } = ctx
  const { specs } = locations(home)
  const missing = BASE_NAMES.filter((name) => !isFile(join(specs, name, 'rig.yaml')))
  if (missing.length > 0) {
    fail(
      `The ${ADAPTER_ID} adapter is not installed in ${specs} (missing ${missing.join(', ')}). ` +
        `Install first: agentflow-sdlc adapters install ${ADAPTER_ID}`,
    )
  }
  const exact = Boolean(ctx.options?.exact)
  const plan = planInstall(adapterDir, null)
  // An upgrade refreshes software, not a selected model policy. Validate every
  // pinned base before the first write; legacy bases retain their exact rig bytes.
  const preserved = {}
  for (const [kind, name] of Object.entries(BASES)) {
    const target = join(specs, name)
    const selectionFile = join(target, 'execution-distribution.json')
    if (isFile(selectionFile)) {
      const selection = JSON.parse(readFileSync(selectionFile, 'utf8'))
      const projected = planRigExecution({
        rigText: readFileSync(join(adapterDir, name, 'rig.yaml'), 'utf8'),
        configText: readFileSync(join(adapterDir, name, 'configurations.yaml'), 'utf8'),
        preset: selection.profile,
        config: { executionDistribution: selection },
      })
      if (!projected.ok)
        fail(
          projected.diagnostics
            .filter((d) => d.severity === 'error')
            .map((d) => d.message)
            .join('; '),
        )
      preserved[kind] = { rigText: projected.rigText, selection }
    } else
      preserved[kind] = { rigText: readFileSync(join(target, 'rig.yaml'), 'utf8'), selection: null }
  }
  out('==> 1. Refreshing AgentFlow delivery, product, and steer bases from this product...')
  const extras = []
  for (const [kind, name] of Object.entries(BASES)) {
    const kept = refreshTree(join(adapterDir, BASES[kind]), join(specs, name), { exact })
    writeFileSync(join(specs, name, 'rig.yaml'), preserved[kind].rigText)
    if (preserved[kind].selection)
      writeFileSync(
        join(specs, name, 'execution-distribution.json'),
        JSON.stringify(preserved[kind].selection, null, 2) + '\n',
      )
    extras.push(...kept.map((file) => `${name}/${file}`))
  }
  if (extras.length > 0) {
    out('   Left installed files that this product does not ship:')
    for (const file of extras.sort()) out(`   - ${file}`)
  }
  out(
    '   Per-project squads were left in place. Refresh one with: agentflow-sdlc adapters squads update openrig <project>',
  )
  out('==> 2. Syncing OpenRig spec library...')
  syncSpecLibrary(ctx)
  out('==> AgentFlow SDLC bases updated. OpenRig itself was not changed.')
  return 0
}

// A project name becomes a directory and a rig name, so it is one plain path segment.
export function squadRigName(project) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project)) {
    fail(`'${project}' is not a valid project name. Use letters, digits, '.', '_', or '-'.`)
  }
  if (project === 'agentflow' || project.startsWith('agentflow-')) return project
  return `agentflow-${project}`
}

function detectKind(rigName, targetDir) {
  const steeringPath = join(targetDir, 'steering.md')
  if (isFile(steeringPath)) return 'steer'
  const siblingPath = join(targetDir, 'sibling.md')
  if (isFile(siblingPath)) {
    const text = readFileSync(siblingPath, 'utf8')
    if (text.includes('steering squad') || text.includes('Supervisory Steering')) return 'steer'
    if (text.includes('This copy is the product squad')) return 'product'
  }
  const rigPath = join(targetDir, 'rig.yaml')
  const rigText = isFile(rigPath) ? readFileSync(rigPath, 'utf8') : ''
  if (/agentflow-steer|id: steer\b/.test(rigText) || rigName.endsWith('-steer')) return 'steer'
  if (/agentflow-product|pm-analyst|id: pm\b/.test(rigText) || rigName.endsWith('-pm'))
    return 'product'
  return 'delivery'
}

function detectSiblings(targetDir) {
  const result = { sibling: '', product: '', delivery: '', steer: '' }
  for (const filename of ['steering.md', 'sibling.md']) {
    const filePath = join(targetDir, filename)
    if (!isFile(filePath)) continue
    const text = readFileSync(filePath, 'utf8')
    const productMatch = text.match(/The product squad for this project is `([^`]*)`/)
    if (productMatch && !result.product) result.product = productMatch[1]
    const deliveryMatch = text.match(/The delivery squad for this project is `([^`]*)`/)
    if (deliveryMatch && !result.delivery) result.delivery = deliveryMatch[1]
    const steerMatch = text.match(/steer-lead@([A-Za-z0-9._-]+)/)
    if (steerMatch && !result.steer) result.steer = steerMatch[1]
    const siblingMatch = text.match(/The (?:delivery|product) squad for this project is `([^`]*)`/)
    if (siblingMatch && !result.sibling) result.sibling = siblingMatch[1]
  }
  return result
}

function renameRig(rigText, rigName) {
  const lines = rigText.split('\n')
  const index = lines.findIndex((line) => line.startsWith('name: '))
  if (index !== -1) lines[index] = `name: ${rigName}`
  return lines.join('\n')
}

// Add sibling or steering file to the startup files, after the startup/context.md entry.
function addSiblingStartup(rigText, filename = 'sibling.md') {
  if (rigText.includes(`path: ${filename}`)) return rigText
  const lines = rigText.split('\n')
  const index = lines.findIndex((line) => line.includes('path: startup/context.md'))
  if (index === -1) return rigText
  lines.splice(
    index + 3,
    0,
    `    - path: ${filename}`,
    '      delivery_hint: send_text',
    '      required: true',
  )
  return lines.join('\n')
}

export function siblingRecord(kind, rigName, sibling, extra = {}) {
  const options = typeof sibling === 'object' && sibling !== null ? sibling : extra
  const siblingStr = typeof sibling === 'string' ? sibling : ''
  const steer = options.steer || ''

  if (kind === 'steer') {
    const product = options.product || (siblingStr && !options.delivery ? siblingStr : '')
    const delivery = options.delivery || ''
    const lines = ['# Supervisory Steering Topology', '']
    if (!product && !delivery) {
      lines.push('No sibling squads were named for this copy. Do not invent session names.')
    } else {
      lines.push(
        `This copy is the steering squad \`${rigName}\`.`,
        `The product squad for this project is \`${product}\`.`,
        `The delivery squad for this project is \`${delivery}\`.`,
        '',
        'Target Routing Allowlist:',
        `- pm-manager@${product} (goal intake, macro priority)`,
        `- orch-arch@${delivery} (unfreeze resolutions, delivery sync, defect triage)`,
        '- human (gates, waivers, person escalations)',
        '',
        'Prohibited Targets:',
        '- Never route directly to in-rig execution seats (dev-build*, dev-qa, dev-test-eng, rev-review, pm-analyst).',
        '',
        'Supervisory steering operates out-of-rig without git worktrees or code-authoring permissions.',
      )
    }
    return `${lines.join('\n')}\n`
  }

  const deliveryOrProductSibling =
    siblingStr || (kind === 'product' ? options.delivery : options.product) || ''
  const lines = ['# Sibling squad', '']
  if (!deliveryOrProductSibling) {
    lines.push('No sibling squad was named for this copy. Do not invent session names.')
  } else if (kind === 'product') {
    lines.push(
      `This copy is the product squad \`${rigName}\`.`,
      `The delivery squad for this project is \`${deliveryOrProductSibling}\`.`,
      '',
      ...['orch-arch', 'dev-build-jr', 'dev-build', 'dev-build-sr', 'dev-qa', 'rev-review'].map(
        (seat) => `- ${seat}@${deliveryOrProductSibling}`,
      ),
      '',
      'A message to delivery is a question or the phase 1 handoff. It is not an implementation order.',
      'Send it with `agentflow-sdlc handoff deliver --to <session> --body-file <file> --goal <uri>`. It is held while the delivery squad is busy.',
    )
    if (steer) {
      lines.push(
        '',
        'Supervisory steering plane:',
        `- steer-lead@${steer} (supervisory steering plane; escalation only)`,
      )
    }
    lines.push(
      '',
      'Reverse seam defect handling:',
      'If delivery returns a defect to phase 1 (`--status skipped --reason "... return to phase 1"`), `pm-analyst` resolves the defect, updates analysis and artifacts, and reappends phase 1 (`--status pass`).',
    )
  } else {
    lines.push(
      `This copy is the delivery squad \`${rigName}\`.`,
      `The product squad for this project is \`${deliveryOrProductSibling}\`.`,
      '',
      `- pm-manager@${deliveryOrProductSibling}`,
      `- pm-analyst@${deliveryOrProductSibling}`,
      '',
      'Phases 0 and 1 belong to that product squad. This squad starts at phase 2.',
      'A question to the analyst is allowed. Changing the outcome, a constraint, or an anti-goal waits for the person.',
    )
    if (steer) {
      lines.push(
        '',
        'Supervisory steering plane:',
        `- steer-lead@${steer} (supervisory steering plane; escalation only for unfreeze / deadlock resolution)`,
      )
    }
    lines.push(
      '',
      'Reverse seam defect return:',
      'If phase 2, 3, or 4 identifies an unresolvable intake ambiguity, invalid assumption, or scope defect, record a defect transition:',
      '- When the current phase has NOT yet recorded pass, append:',
      '  `agentflow-sdlc phase append --phase <current> --status skipped --reason "Defect: <summary> (return to phase <3|1>)" --seat <seat>`',
      '- When Phase 4 (pass) is already recorded on the ledger, Phase 4 cannot be re-appended; transition directly to the target return phase (Phase 3 for orch.arch planning/oracle addendum or Phase 1 for pm.analyst intake defect) per RETURNS[4] = [3, 1], preserving sticky builder seat affinity (dev.build-jr stays owner of P0 slices across 4 -> 3 -> 4).',
      'Then wake the product squad analyst or planner:',
      `\`rig queue handoff --to pm-analyst@${deliveryOrProductSibling} --goal <goal-uri> --from-phase <current> --reason "Defect return to phase 1"\``,
    )
  }
  return `${lines.join('\n')}\n`
}

function ensureSteerDir(home, rigName) {
  const { steerState } = locations(home)
  const dir = join(steerState, rigName)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Non-POSIX or restricted file systems may ignore chmod
  }
  return dir
}

function squadPiSeats(kind, rigName, rigText) {
  const rig = parseExecutionYaml(rigText, 'planned rig')
  return rig.pods.flatMap((pod) =>
    pod.members
      .filter((member) => member.runtime === 'pi')
      .map((member) => `${pod.id}-${member.id}@${rigName}`),
  )
}

function prepareSquadExecution(ctx, kind, projectCwd) {
  const installed = join(locations(ctx.home).specs, BASES[kind])
  const baseDir = isFile(join(installed, 'rig.yaml'))
    ? installed
    : join(ctx.adapterDir, BASES[kind])
  const loaded = loadAuthoritativeConfigs(projectCwd)
  const validation = validateConfigAuthority(loaded)
  if (!validation.ok) fail(validation.errors.join('; '))
  const config = loaded.isUnified
    ? loaded.unified
    : {
        models: loaded.models,
        adapters: loaded.adapters,
        executionDistribution: loaded.workflow.executionDistribution,
      }
  const desired = {
    rigText: readFileSync(join(baseDir, 'rig.yaml'), 'utf8'),
    configText: readFileSync(join(baseDir, 'configurations.yaml'), 'utf8'),
    preset:
      ctx.options.preset ??
      config.executionDistribution?.profile ??
      config.adapters?.openrig?.executionPolicy?.preset,
    config,
  }
  const plan = planRigExecution(desired)
  if (!plan.ok)
    fail(
      plan.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => `${item.seat}: ${item.message}`)
        .join('; '),
    )
  return Object.freeze({
    ...plan,
    baseDir,
    desired,
    configuredSeats: Object.keys(config.adapters?.openrig?.executionPolicy?.seats ?? {}),
  })
}

function validateTopologySeats(plans) {
  const seats = new Set(plans.flatMap((plan) => plan.contracts.map((item) => item.seat)))
  for (const seat of new Set(plans.flatMap((plan) => plan.configuredSeats))) {
    if (!seats.has(seat))
      fail(`Explicit execution override names a seat absent from the planned topology: ${seat}`)
  }
}

function requireFreshSquadTargets(ctx, names) {
  const { specs, piState, steerState } = locations(ctx.home)
  for (const name of names) {
    if (lexists(join(specs, name)))
      fail(`Squad '${name}' already exists; use source-bound mutation preview and admission`)
    if (lexists(join(steerState, name)))
      fail(`Existing steering state for '${name}' requires source-bound recovery before provision`)
  }
  if (isDirectory(piState)) {
    for (const seat of readdirSync(piState)) {
      if (names.some((name) => seat.endsWith(`@${name}`)))
        fail(`Existing Pi state for '${seat}' requires source-bound recovery before provision`)
    }
  }
}

function requireActiveExecution(plan) {
  if (plan.activation !== 'active')
    fail('Execution policy activation is held; desired preview only, no installed writes permitted')
}

function writeSquadSpec({
  ctx,
  kind,
  rigName,
  projectCwd,
  sibling,
  steer,
  product,
  delivery,
  isUpdate,
  executionPlan,
}) {
  const { home, options, env, out } = ctx
  const { specs, piState } = locations(home)
  // The complete desired contract is resolved before installation or any bridge/write.
  const plan = executionPlan ?? prepareSquadExecution(ctx, kind, projectCwd)
  requireActiveExecution(plan)
  requireFreshSquadTargets(ctx, [rigName])
  const baseDir = join(specs, BASES[kind])
  if (!isFile(join(baseDir, 'rig.yaml'))) {
    out(`==> Base spec not found in ${baseDir}. Installing the ${ADAPTER_ID} adapter first...`)
    installBases(ctx, options.preset, null)
  }

  const targetDir = join(specs, rigName)
  let rigText = renameRig(plan.rigText, rigName)

  const startupFile = kind === 'steer' ? 'steering.md' : 'sibling.md'
  rigText = addSiblingStartup(rigText, startupFile)

  out(`==> 1. ${isUpdate ? 'Updating' : 'Provisioning'} spec for squad '${rigName}'...`)
  mkdirSync(targetDir, { recursive: true })
  for (const name of SHARED_DIRS) {
    if (isDirectory(join(baseDir, name))) bridge(join(baseDir, name), join(targetDir, name), true)
  }
  for (const name of SHARED_FILES) {
    if (isFile(join(baseDir, name))) bridge(join(baseDir, name), join(targetDir, name), false)
  }
  writeFileSync(join(targetDir, 'rig.yaml'), rigText)
  writeFileSync(
    join(targetDir, 'execution-contracts.json'),
    `${JSON.stringify({ preset: plan.preset, contracts: plan.contracts, diagnostics: plan.diagnostics }, null, 2)}\n`,
  )

  const siblingContent = siblingRecord(kind, rigName, sibling, { steer, product, delivery })
  if (kind === 'steer') {
    writeFileSync(join(targetDir, 'steering.md'), siblingContent)
    writeFileSync(join(targetDir, 'sibling.md'), siblingContent)
    ensureSteerDir(home, rigName)
  } else {
    writeFileSync(join(targetDir, 'sibling.md'), siblingContent)
  }

  out(`==> 2. ${isUpdate ? 'Keeping' : 'Provisioning'} Pi state bridges for squad '${rigName}'...`)
  for (const seat of squadPiSeats(kind, rigName, rigText)) {
    if (!isUpdate || !lexists(join(piState, seat))) bridgePiSeat(home, seat)
    if (kind === 'product') installPiGuard(home, seat)
  }

  out(`==> 3. Ensuring Git hygiene in target project '${projectCwd}'...`)
  const excludeFile = gitExcludeFile(projectCwd, env)
  if (excludeFile) {
    applyExcludes(excludeFile)
    out(`   Git hygiene exclusions configured in ${excludeFile}`)
  } else {
    out('   (Not a Git repository; skipping.)')
  }

  out('==> 4. Syncing and validating spec with OpenRig...')
  if (syncSpecLibrary(ctx)) {
    const result = rig(['spec', 'validate', join(targetDir, 'rig.yaml')], ctx)
    if (result?.stdout) ctx.out(result.stdout.trimEnd())
    if (result && result.status !== 0)
      fail(`rig spec validate failed for ${join(targetDir, 'rig.yaml')}.`)
  }

  return { rigName, targetDir }
}

function provisionAll(ctx) {
  const { home, options, operands, cwd, out } = ctx
  const { specs, piState, steerState } = locations(home)
  const project = operands[0]
  squadRigName(project)

  const pmProject = `${project}-pm`
  const devProject = `${project}-dev`
  const steerProject = `${project}-steer`

  const pmRig = squadRigName(pmProject)
  const devRig = squadRigName(devProject)
  const steerRig = squadRigName(steerProject)

  for (const name of [pmRig, devRig, steerRig]) {
    if (BASE_NAMES.includes(name)) {
      fail(`'${name}' is a generic base name. Pass a project copy name.`)
    }
  }

  let projectCwd = cwd
  if (operands[1] !== undefined) {
    projectCwd = resolve(cwd, operands[1])
    if (!isDirectory(projectCwd)) fail(`Project directory '${operands[1]}' does not exist.`)
  }

  requireFreshSquadTargets(ctx, [pmRig, devRig, steerRig])

  // Preflight all three desired rigs before installing even the first missing base.
  const executionPlans = Object.fromEntries(
    Object.keys(BASES).map((kind) => [kind, prepareSquadExecution(ctx, kind, projectCwd)]),
  )
  validateTopologySeats(Object.values(executionPlans))
  for (const plan of Object.values(executionPlans)) requireActiveExecution(plan)
  for (const base of Object.values(BASES)) {
    if (!isFile(join(specs, base, 'rig.yaml'))) {
      out(
        `==> Base spec not found in ${join(specs, base)}. Installing the ${ADAPTER_ID} adapter first...`,
      )
      installBases(ctx, options.preset, null)
      break
    }
  }

  resolvePreset(join(specs, BASES.delivery, 'configurations.yaml'), options.preset)
  resolvePreset(join(specs, BASES.product, 'configurations.yaml'), options.preset)
  if (options.preset) {
    const steerConfig = join(specs, BASES.steer, 'configurations.yaml')
    if (isFile(steerConfig)) {
      resolvePreset(steerConfig, options.preset)
    }
  }

  const createdTargetDirs = []
  const createdSteerDirs = []

  try {
    out(`==> Provisioning 3-rig topology for project '${project}' (product, delivery, steer)...`)

    writeSquadSpec({
      ctx,
      kind: 'product',
      rigName: pmRig,
      projectCwd,
      sibling: devRig,
      steer: steerRig,
      isUpdate: false,
      executionPlan: executionPlans.product,
    })
    createdTargetDirs.push(join(specs, pmRig))

    writeSquadSpec({
      ctx,
      kind: 'delivery',
      rigName: devRig,
      projectCwd,
      sibling: pmRig,
      steer: steerRig,
      isUpdate: false,
      executionPlan: executionPlans.delivery,
    })
    createdTargetDirs.push(join(specs, devRig))

    writeSquadSpec({
      ctx,
      kind: 'steer',
      rigName: steerRig,
      projectCwd,
      product: pmRig,
      delivery: devRig,
      isUpdate: false,
      executionPlan: executionPlans.steer,
    })
    createdTargetDirs.push(join(specs, steerRig))
    createdSteerDirs.push(join(steerState, steerRig))

    out('')
    out(`Three squads provisioned for '${project}'. Working directory: ${projectCwd}`)
    out(`  Product:  rig up ${pmRig} --cwd ${projectCwd}`)
    out(`  Delivery: rig up ${devRig} --cwd ${projectCwd}`)
    out(`  Steer:    rig up ${steerRig} --cwd ${projectCwd}`)
    out(`  Monitor:  rig ps`)
    out(`  Remove:   agentflow-sdlc adapters squads remove ${ADAPTER_ID} ${pmProject}`)
    out(`            agentflow-sdlc adapters squads remove ${ADAPTER_ID} ${devProject}`)
    out(`            agentflow-sdlc adapters squads remove ${ADAPTER_ID} ${steerProject}`)
    return 0
  } catch (error) {
    for (const dir of createdTargetDirs) {
      if (lexists(dir)) removeTree(dir)
    }
    for (const dir of createdSteerDirs) {
      if (lexists(dir)) removeTree(dir)
    }
    if (isDirectory(piState)) {
      for (const rigName of [pmRig, devRig, steerRig]) {
        for (const seat of readdirSync(piState).filter((name) => name.endsWith(`@${rigName}`))) {
          removeTree(join(piState, seat))
        }
      }
    }
    throw error
  }
}

function writeSquad(ctx, isUpdate) {
  const { home, options, operands, cwd, out } = ctx
  const { specs } = locations(home)
  let kind = options.kind
  if (
    kind !== undefined &&
    kind !== 'delivery' &&
    kind !== 'product' &&
    kind !== 'steer' &&
    kind !== 'all'
  ) {
    fail(`--kind must be delivery, product, steer, or all, not '${kind}'.`)
  }

  if (kind === 'all') {
    if (isUpdate) {
      fail('--kind all is supported for provision only.')
    }
    return provisionAll(ctx)
  }

  const project = operands[0]
  const rigName = squadRigName(project)
  if (BASE_NAMES.includes(rigName)) {
    fail(`'${rigName}' is a generic base name. Pass a project copy name, such as dev or pm.`)
  }
  const targetDir = join(specs, rigName)

  let sibling = options.sibling ?? ''
  let steer = options.steer ?? ''
  let product = options.product ?? ''
  let delivery = options.delivery ?? ''

  if (isUpdate) {
    if (!isDirectory(targetDir)) {
      fail(`Squad '${rigName}' does not exist in ${specs}. Provision it first.`)
    }
    fail(
      'Existing squad update requires a source-bound mutation host with CAS admission; use adapters squads mutation-plan for read-only preview',
    )
  }
  kind ??= 'delivery'

  if (kind === 'steer') {
    if (!product || !delivery) {
      fail('--kind steer requires --product <rig> and --delivery <rig>.')
    }
  }

  let projectCwd = cwd
  if (operands[1] !== undefined) {
    projectCwd = resolve(cwd, operands[1])
    if (!isDirectory(projectCwd)) fail(`Project directory '${operands[1]}' does not exist.`)
  }

  writeSquadSpec({
    ctx,
    kind,
    rigName,
    projectCwd,
    sibling,
    steer,
    product,
    delivery,
    isUpdate,
  })

  out('')
  out(
    `Squad '${rigName}' ${isUpdate ? 'updated' : 'provisioned'} (${kind}). Working directory: ${projectCwd}`,
  )
  out(`  Launch:  rig up ${rigName} --cwd ${projectCwd}`)
  out(`  Monitor: rig ps --nodes --rig ${rigName}`)
  out(`  Freeze:  rig down ${rigName} --snapshot`)
  out(`  Resume:  rig up ${rigName} --existing`)
  out(`  Remove:  agentflow-sdlc adapters squads remove ${ADAPTER_ID} ${project}`)
  return 0
}

export function squadProvision(ctx) {
  return writeSquad(ctx, false)
}

export function squadUpdate(ctx) {
  return writeSquad(ctx, true)
}

// Planning reads source and installed specifications only. It does not bridge auth, install
// bases, contact the daemon, or equate inventory support with usable live execution.
export function squadPlan(ctx) {
  const kind = ctx.options.kind ?? 'all'
  if (kind !== 'all' && !BASES[kind]) fail(`Unknown squad kind ${kind}`)
  squadRigName(ctx.operands[0])
  const projectCwd = resolve(ctx.cwd, ctx.operands[1] ?? '.')
  if (!isDirectory(projectCwd)) fail('Project directory does not exist')
  const kinds = kind === 'all' ? Object.keys(BASES) : [kind]
  const plans = kinds.map((item) => ({
    kind: item,
    ...prepareSquadExecution(ctx, item, projectCwd),
  }))
  if (kind === 'all') validateTopologySeats(plans)
  const result = {
    ok: true,
    operation: 'plan',
    activation: plans.some((item) => item.activation === 'held') ? 'held' : 'active',
    effects: [],
    observation: 'not-performed',
    plans: plans.map(({ kind: item, preset, activation, contracts, diagnostics }) => ({
      kind: item,
      preset,
      activation,
      contracts,
      diagnostics,
    })),
  }
  if (ctx.options.json) ctx.out(JSON.stringify(result, null, 2))
  else
    for (const plan of result.plans) {
      ctx.out(
        `${plan.kind}: preset ${plan.preset}; ${plan.contracts.length} configured seats; live readiness not verified`,
      )
      for (const item of plan.contracts)
        ctx.out(
          `  ${item.seat}: ${item.runtime} / ${item.providerRoute} / ${item.model} / ${item.effort}; support ${item.support}`,
        )
      for (const item of plan.diagnostics)
        ctx.out(`  ${item.severity}: ${item.message} (${item.seat ?? 'topology'})`)
    }
  return 0
}

// Installed YAML is observation of configuration only, not runtime or inventory support.
// Missing fields stay unknown; no project policy or desired tuple supplies observed values.
function observedMutationContracts(rigText) {
  const rig = parseExecutionYaml(rigText, 'installed rig')
  if (!Array.isArray(rig.pods)) fail('Installed rig pods are missing or malformed')
  return rig.pods.flatMap((pod) => {
    if (typeof pod.id !== 'string' || !Array.isArray(pod.members))
      fail('Installed rig pod/member IDs are missing or malformed')
    return pod.members.map((member) => {
      if (typeof member.id !== 'string') fail('Installed rig member ID is missing')
      const locatorRoutes = {
        munito: 'munito',
        antigravity: 'antigravity',
        'grok-cli': 'grok',
        'openai-codex': 'openai-codex',
        anthropic: 'anthropic',
      }
      const locator = typeof member.model === 'string' ? member.model.split('/')[0] : null
      const providerRoute =
        member.providerRoute ??
        (member.runtime === 'pi'
          ? Object.hasOwn(locatorRoutes, locator)
            ? locatorRoutes[locator]
            : null
          : null)
      return {
        seat: `${pod.id}.${member.id}`,
        runtime: member.runtime ?? null,
        executionTarget: member.executionTarget ?? null,
        providerRoute,
        providerFamily: member.providerFamily ?? null,
        model: normalizeContractModel({
          runtime: member.runtime,
          providerRoute,
          model: member.model ?? null,
        }),
        runnerModel: member.model ?? null,
        effort: member.effort ?? null,
        profile: member.profile ?? null,
        capabilityTier: member.capabilityTier ?? null,
      }
    })
  })
}

// Public summaries are derived evidence, not the sealed apply plan. Installed YAML can
// contain arbitrary environment/startup payloads; never print those through a preview.
function publicMutationPreview(plan) {
  const tupleFields = [
    'runtime',
    'executionTarget',
    'providerRoute',
    'providerFamily',
    'model',
    'runnerModel',
    'effort',
    'profile',
    'capabilityTier',
  ]
  const tuple = (value) =>
    value ? Object.fromEntries(tupleFields.map((field) => [field, value[field] ?? null])) : null
  return {
    version: 1,
    type: 'rig-mutation-preview',
    planDigest: plan.digest,
    rigName: plan.rigName,
    desiredSpecName: plan.rigName,
    sourceRevision: plan.sourceRevision,
    beforeDigest: plan.beforeDigest,
    afterDigest: plan.afterDigest,
    workflowAnchor: null,
    executorIdentity: null,
    effects: [],
    admissionHolds: plan.admissionHolds,
    beforeContracts: plan.beforeContracts.map((value) => ({ seat: value.seat, ...tuple(value) })),
    afterContracts: plan.afterContracts.map((value) => ({ seat: value.seat, ...tuple(value) })),
    changes: plan.changes.map((change) => ({
      seat: change.seat,
      structuralConfigurationChanged: change.structuralConfigurationChanged ?? null,
      fields: Object.fromEntries(
        Object.entries(change.fields).filter(([field]) => tupleFields.includes(field)),
      ),
      before: tuple(change.before),
      after: tuple(change.after),
    })),
    structuralConfigurationChanged: plan.structuralConfigurationChanged ?? null,
    structuralBeforeDigest: plan.structuralBeforeDigest ?? null,
    structuralAfterDigest: plan.structuralAfterDigest ?? null,
    affectedSeats: plan.affectedSeats,
    restarts: plan.restarts,
    requiredActions: plan.requiredActions,
    requiredPermissions: plan.requiredPermissions,
    requiredRuntimeGuards: plan.requiredRuntimeGuards,
    operationalStatus: plan.operationalStatus,
  }
}

export function squadMutationPlan(ctx) {
  const kind = ctx.options.kind ?? 'all'
  if (kind !== 'all' && !BASES[kind]) fail(`Unknown squad kind ${kind}`)
  if (kind === 'all' && ctx.options.rig) fail('--rig requires one explicit squad kind')
  const project = ctx.operands[0]
  squadRigName(project)
  const projectCwd = resolve(ctx.cwd, ctx.operands[1] ?? '.')
  if (!isDirectory(projectCwd)) fail('Project directory does not exist')
  const kinds = kind === 'all' ? Object.keys(BASES) : [kind]
  const prepared = kinds.map((item) => ({
    kind: item,
    ...prepareSquadExecution(ctx, item, projectCwd),
  }))
  if (kind === 'all') validateTopologySeats(prepared)
  const plans = prepared.map((item) => {
    const suffix = { delivery: 'dev', product: 'pm', steer: 'steer' }[item.kind]
    const rigName =
      ctx.options.rig ?? squadRigName(kind === 'all' ? `${project}-${suffix}` : project)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(rigName)) fail('Stable installed rig ID required')
    const installedPath = join(locations(ctx.home).specs, rigName, 'rig.yaml')
    if (!isFile(installedPath)) fail(`Installed rig specification not found: ${rigName}`)
    const rigText = readFileSync(installedPath, 'utf8')
    const document = executionDocument(item.desired.rigText, 'desired rig')
    document.set('name', rigName)
    const plan = planRigMutation({
      rigName,
      desired: { ...item.desired, rigText: document.toString() },
      installed: {
        rigText,
        contracts: observedMutationContracts(rigText),
        sourceRevision: createHash('sha256').update(rigText).digest('hex'),
      },
      workflow: null,
      executorIdentity: null,
    })
    return {
      kind: item.kind,
      rigName,
      activation: item.activation,
      status: 'held',
      plan: publicMutationPreview(plan),
    }
  })
  const result = {
    ok: true,
    operation: 'mutation-plan',
    status: 'held',
    effects: [],
    observation: 'installed-configuration-only',
    plans,
  }
  if (ctx.options.json) ctx.out(JSON.stringify(result, null, 2))
  else
    for (const item of plans)
      ctx.out(
        `${item.rigName}: held preview; ${item.plan.affectedSeats.length} affected seats; authoritative run and mutation executor remain unverified`,
      )
  return 0
}

// Strict read-only operational admission. Compact ps cannot attest actual model or custody;
// all those dimensions remain unknown, even when a process happens to report READY.
export function squadPreflight(ctx) {
  const kind = ctx.options.kind ?? 'all'
  if (kind !== 'all' && !BASES[kind]) fail(`Unknown squad kind ${kind}`)
  const project = ctx.operands[0]
  squadRigName(project)
  const projectCwd = resolve(ctx.cwd, ctx.operands[1] ?? '.')
  if (!isDirectory(projectCwd)) fail('Project directory does not exist')
  const kinds = kind === 'all' ? Object.keys(BASES) : [kind]
  const plans = kinds.map((item) => ({
    kind: item,
    ...prepareSquadExecution(ctx, item, projectCwd),
  }))
  if (kind === 'all') validateTopologySeats(plans)
  const reports = plans.map((plan) => {
    const suffix = { delivery: 'dev', product: 'pm', steer: 'steer' }[plan.kind]
    const rigName = squadRigName(kind === 'all' ? `${project}-${suffix}` : project)
    const installedPath = join(locations(ctx.home).specs, rigName, 'rig.yaml')
    let installedContracts = []
    if (isFile(installedPath)) {
      try {
        const installed = parseExecutionYaml(readFileSync(installedPath, 'utf8'), 'installed rig')
        installedContracts = (installed.pods ?? []).flatMap((pod) =>
          (pod.members ?? []).map((member) => {
            const seat = `${pod.id}.${member.id}`
            const desired = plan.contracts.find((item) => item.seat === seat)
            return {
              seat,
              runtime: member.runtime,
              providerRoute:
                desired?.runnerModel === member.model ? desired.providerRoute : undefined,
              model: desired?.runnerModel === member.model ? desired.model : member.model,
              effort: member.effort,
              profile: member.profile,
            }
          }),
        )
      } catch {
        /* Malformed installed configuration is unverified, never repaired here. */
      }
    }
    let observations = { rigName, complete: false, entries: [] }
    let collection = 'not-contacted'
    if (contactsOpenRig(ctx)) {
      const result = spawnSync(
        'rig',
        [
          'ps',
          '--nodes',
          '--rig',
          rigName,
          '--json',
          '--no-cleanup',
          '--limit',
          '200',
          '--fields',
          COMPACT_NODE_FIELDS,
        ],
        { encoding: 'utf8', env: ctx.env, shell: false, timeout: 10000, maxBuffer: 1024 * 1024 },
      )
      if (!result.error && result.status === 0) {
        observations = parseCompactObservation(result.stdout, rigName)
        collection = observations.complete ? 'inventory-only' : 'incomplete'
      } else collection = 'unavailable'
    }
    const report = evaluateOperationalPreflight({
      contracts: plan.contracts,
      installedContracts,
      daemon: { state: 'unknown' },
      observations,
      task: {
        rigName,
        owner: 'operator',
        requiredSeats: plan.contracts.map((item) => item.seat),
        bindings: {},
      },
      now: new Date().toISOString(),
    })
    return { rigName, kind: plan.kind, collection, ...report }
  })
  const result = {
    operation: 'preflight',
    admitted: reports.length > 0 && reports.every((report) => report.admitted),
    effects: [],
    reports,
  }
  if (ctx.options.json) ctx.out(JSON.stringify(result, null, 2))
  else
    for (const report of reports) {
      ctx.out(
        `${report.rigName}: held; ${report.collection}; actual execution and task authority require a verified reader`,
      )
      for (const seat of report.seats)
        ctx.out(`  ${seat.seat}: ${seat.status}; ${seat.reasons.join(', ')}`)
    }
  return result.admitted ? 0 : 3
}

export function listSquads(ctx) {
  const { specs } = locations(ctx.home)
  if (!isDirectory(specs)) return []
  // Listing is read-only: an unreadable status shows as stopped, as when rig is absent.
  const { statuses } = rigStatuses(ctx)
  return readdirSync(specs)
    .filter((name) => name.startsWith('agentflow') && isFile(join(specs, name, 'rig.yaml')))
    .sort()
    .map((name) => ({
      rig: name,
      status: statuses.get(name) === 'running' ? 'running' : 'stopped',
      specDir: join(specs, name),
    }))
}

export function squadList(ctx) {
  const rows = listSquads(ctx)
  if (ctx.options.json) {
    ctx.out(JSON.stringify(rows, null, 2))
    return 0
  }
  ctx.out('==> Configured AgentFlow squads in OpenRig:')
  ctx.out('')
  ctx.out(`${'RIG NAME'.padEnd(25)} ${'STATUS'.padEnd(12)} SPEC DIRECTORY`)
  for (const row of rows) ctx.out(`${row.rig.padEnd(25)} ${row.status.padEnd(12)} ${row.specDir}`)
  return 0
}

export function squadRemove(ctx) {
  const { home, operands, options, out } = ctx
  const { specs, piState, steerState } = locations(home)
  const rigName = squadRigName(operands[0])
  if (BASE_NAMES.includes(rigName)) {
    fail(
      `Refusing to remove the base rig '${rigName}'. Refresh it with: agentflow-sdlc adapters update ${ADAPTER_ID}`,
    )
  }
  out(`==> Removing squad '${rigName}'...`)
  // Fail closed: deleting state under a rig whose status is unknown can lose its work.
  const { statuses, error } = rigStatuses(ctx)
  if (error) fail(`Could not read rig status (${error}). Nothing was removed.`)
  const status = statuses.get(rigName)
  if (status && status !== 'stopped') {
    out(`    Stopping running rig '${rigName}'...`)
    const stopped = rig(['down', rigName], ctx)
    // A rig that did not stop keeps its spec and seat state; removing them under it loses work.
    if (!stopped || stopped.error || stopped.status !== 0) {
      const detail = (stopped?.error?.message || stopped?.stderr || stopped?.stdout || '').trim()
      const code = stopped && !stopped.error ? ` (exit ${stopped.status})` : ''
      fail(`rig down ${rigName} failed${code}${detail ? `: ${detail}` : ''}. Nothing was removed.`)
    }
    // Trust the stop only when a fresh status read shows the rig absent or exactly stopped.
    const after = rigStatuses(ctx)
    if (after.error) {
      fail(`Could not confirm that ${rigName} stopped (${after.error}). Nothing was removed.`)
    }
    const afterStatus = after.statuses.get(rigName)
    if (afterStatus !== undefined && afterStatus !== 'stopped') {
      fail(`rig down ${rigName} exited 0 but the rig is still ${afterStatus}. Nothing was removed.`)
    }
  }
  const targetDir = join(specs, rigName)
  if (lexists(targetDir)) {
    removeTree(targetDir)
    out(`    Removed spec directory: ${targetDir}`)
  }
  if (isDirectory(piState)) {
    for (const seat of readdirSync(piState).filter((name) => name.endsWith(`@${rigName}`))) {
      removeTree(join(piState, seat))
      out(`    Removed Pi bridge: ${join(piState, seat)}`)
    }
  }

  const steerDirCandidates = [join(steerState, rigName)]
  const candidateSuffix = join(steerState, `${rigName}-steer`)
  if (candidateSuffix !== join(steerState, rigName) && lexists(candidateSuffix)) {
    steerDirCandidates.push(candidateSuffix)
  }
  for (const rigSteerDir of steerDirCandidates) {
    if (lexists(rigSteerDir)) {
      if (options?.purge) {
        removeTree(rigSteerDir)
        out(`    Purged steering audit directory: ${rigSteerDir}`)
      } else {
        out(`    Preserved steering audit directory: ${rigSteerDir} (pass --purge to remove)`)
      }
    }
  }

  if (daemonRunning(ctx)) rig(['specs', 'sync'], ctx)
  out(`==> Squad '${rigName}' removed.`)
  return 0
}

export {
  BUILDER_RUNGS,
  LEAN_BUILDER_RUNGS,
  CONSEQUENCE_FLOOR_RE,
  resolveBuilderRung,
  resolveBuilderSeat,
  resolvePhaseCompression,
  resolveStickyBuilderOnReturn,
  countUnmergedAccepted,
  canAdmitNextSlice,
} from './tier-routing.mjs'
