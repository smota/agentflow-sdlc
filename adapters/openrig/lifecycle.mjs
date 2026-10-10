// OpenRig execution adapter lifecycle: install or recover the two generic bases, refresh them from
// this product, and provision, update, list, or remove per-project squads. Called through
// `agentflow-sdlc adapters ...`; core dispatches here by adapter id and knows nothing below.
// It calls `rig` only for status, stop, and spec sync, as an argument array without a shell.
import { spawnSync } from 'node:child_process'
import {
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
import { delimiter, dirname, join, resolve } from 'node:path'

const ADAPTER_ID = 'openrig'
const BASES = { delivery: 'agentflow', product: 'agentflow-product' }
const BASE_NAMES = Object.values(BASES)
const DELIVERY_PI_SEATS = [
  'orch-arch',
  'rev-review',
  'dev-build-jr',
  'dev-build',
  'dev-build-sr',
  'dev-qa',
]
const SHARED_DIRS = ['agents', 'startup']
const SHARED_FILES = ['CULTURE.md', 'README.md', 'configurations.yaml']
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
  }
}

// configurations.yaml is flat two-level YAML, so a line scan is enough; no YAML dependency.
export function parsePresets(text) {
  const presets = {}
  let recommended = ''
  let section = ''
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^(\S[^:]*):\s*(.*)$/)
    if (top) {
      section = top[1]
      if (section === 'recommended') recommended = top[2].trim()
      continue
    }
    if (section !== 'presets') continue
    const name = line.match(/^ {2}(\S[^:]*):\s*$/)
    if (name) {
      current = presets[name[1]] = {}
      continue
    }
    const seat = line.match(/^ {4}(\S+):\s*(\S+)\s*$/)
    if (seat && current) current[seat[1]] = seat[2]
  }
  return { recommended, presets }
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
    .filter(([, runtime]) => runtime === 'pi')
    .map(([seat]) => `${seat.replaceAll('.', '-')}@${rigName}`)
}

// Validates everything install needs before anything is written.
function planInstall(adapterDir, requested) {
  const sources = {
    delivery: join(adapterDir, BASES.delivery),
    product: join(adapterDir, BASES.product),
  }
  const delivery = resolvePreset(join(sources.delivery, 'configurations.yaml'), requested)
  const product = resolvePreset(join(sources.product, 'configurations.yaml'), requested)
  if (delivery.name !== product.name) {
    fail(`Delivery preset "${delivery.name}" and product preset "${product.name}" differ.`)
  }
  return {
    sources,
    preset: delivery.name,
    piSeats: [...piSeatsOf(delivery, BASES.delivery), ...piSeatsOf(product, BASES.product)],
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

function writeBases(home, plan, out) {
  const { specs } = locations(home)
  out('==> 1. Syncing AgentFlow delivery and product bases to the OpenRig user library...')
  for (const [kind, name] of Object.entries(BASES)) mirror(plan.sources[kind], join(specs, name))
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
  out(
    `    Per-project squad: agentflow-sdlc adapters squads provision ${ADAPTER_ID} --kind delivery|product <project> <path>`,
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
  out('==> 1. Refreshing AgentFlow delivery and product bases from this product...')
  for (const [kind, name] of Object.entries(BASES))
    mirror(join(adapterDir, BASES[kind]), join(specs, name))
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
  const siblingPath = join(targetDir, 'sibling.md')
  if (
    isFile(siblingPath) &&
    readFileSync(siblingPath, 'utf8').includes('This copy is the product squad')
  ) {
    return 'product'
  }
  const rigPath = join(targetDir, 'rig.yaml')
  const rigText = isFile(rigPath) ? readFileSync(rigPath, 'utf8') : ''
  if (/agentflow-product|pm-analyst|id: pm\b/.test(rigText) || rigName.endsWith('-pm'))
    return 'product'
  return 'delivery'
}

function detectSibling(targetDir) {
  const siblingPath = join(targetDir, 'sibling.md')
  if (!isFile(siblingPath)) return ''
  const match = readFileSync(siblingPath, 'utf8').match(
    /The (?:delivery|product) squad for this project is `([^`]*)`/,
  )
  return match ? match[1] : ''
}

function renameRig(rigText, rigName) {
  const lines = rigText.split('\n')
  const index = lines.findIndex((line) => line.startsWith('name: '))
  if (index !== -1) lines[index] = `name: ${rigName}`
  return lines.join('\n')
}

// Set each product seat's runtime from the preset. A Pi seat gets the Grok model line.
function applyProductPreset(rigText, preset) {
  const lines = rigText.split('\n')
  const out = []
  let member = null
  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index].match(/^ +- id: (\S+)\s*$/)
    if (id) member = id[1]
    if (member && /^ +runtime: \S+\s*$/.test(lines[index])) {
      const runtime = preset.seats[`pm.${member}`]
      if (!runtime) fail(`Preset "${preset.name}" has no runtime for pm.${member}.`)
      const indent = lines[index].match(/^ +/)[0]
      out.push(`${indent}runtime: ${runtime}`)
      const next = lines[index + 1] || ''
      if (runtime === 'pi' && !/^ +model: /.test(next))
        out.push(`${indent}model: grok-cli/grok-4.7`)
      if (runtime !== 'pi' && /^ +model: /.test(next)) index += 1
      continue
    }
    out.push(lines[index])
  }
  return out.join('\n')
}

// Add sibling.md to the startup files, after the startup/context.md entry.
function addSiblingStartup(rigText) {
  if (rigText.includes('path: sibling.md')) return rigText
  const lines = rigText.split('\n')
  const index = lines.findIndex((line) => line.includes('path: startup/context.md'))
  if (index === -1) return rigText
  lines.splice(
    index + 3,
    0,
    '    - path: sibling.md',
    '      delivery_hint: send_text',
    '      required: true',
  )
  return lines.join('\n')
}

export function siblingRecord(kind, rigName, sibling) {
  const lines = ['# Sibling squad', '']
  if (!sibling) {
    lines.push('No sibling squad was named for this copy. Do not invent session names.')
  } else if (kind === 'product') {
    lines.push(
      `This copy is the product squad \`${rigName}\`.`,
      `The delivery squad for this project is \`${sibling}\`.`,
      '',
      ...['orch-arch', 'dev-build-jr', 'dev-build', 'dev-build-sr', 'dev-qa', 'rev-review'].map(
        (seat) => `- ${seat}@${sibling}`,
      ),
      '',
      'A message to delivery is a question or the phase 1 handoff. It is not an implementation order.',
      'Send it with `agentflow-sdlc handoff deliver --to <session> --body-file <file> --goal <uri>`. It is held while the delivery squad is busy.',
      '',
      'Reverse seam defect handling:',
      'If delivery returns a defect to phase 1 (`--status skipped --reason "... return to phase 1"`), `pm-analyst` resolves the defect, updates analysis and artifacts, and reappends phase 1 (`--status pass`).',
    )
  } else {
    lines.push(
      `This copy is the delivery squad \`${rigName}\`.`,
      `The product squad for this project is \`${sibling}\`.`,
      '',
      `- pm-manager@${sibling}`,
      `- pm-analyst@${sibling}`,
      '',
      'Phases 0 and 1 belong to that product squad. This squad starts at phase 2.',
      'A question to the analyst is allowed. Changing the outcome, a constraint, or an anti-goal waits for the person.',
      '',
      'Reverse seam defect return:',
      'If phase 2, 3, or 4 identifies an unresolvable intake ambiguity, invalid assumption, or scope defect, record a defect transition:',
      '`agentflow-sdlc phase append --phase <current> --status skipped --reason "Defect: <summary> (return to phase 1)" --seat <seat>`',
      'Then wake the product squad analyst:',
      `\`rig queue handoff --to pm-analyst@${sibling} --goal <goal-uri> --from-phase <current> --reason "Defect return to phase 1"\``,
    )
  }
  return `${lines.join('\n')}\n`
}

function squadPiSeats(kind, rigName, rigText) {
  if (kind === 'delivery') return DELIVERY_PI_SEATS.map((seat) => `${seat}@${rigName}`)
  const seats = []
  let id = ''
  for (const line of rigText.split('\n')) {
    const member = line.match(/^ +- id: (\S+)\s*$/)
    if (member) id = member[1]
    if (/^ +runtime: pi\s*$/.test(line) && id) seats.push(`pm-${id}@${rigName}`)
  }
  return seats
}

function writeSquad(ctx, isUpdate) {
  const { home, options, operands, cwd, env, out } = ctx
  const { specs, piState } = locations(home)
  let kind = options.kind
  if (kind !== undefined && kind !== 'delivery' && kind !== 'product') {
    fail(`--kind must be delivery or product, not '${kind}'.`)
  }
  const project = operands[0]
  const rigName = squadRigName(project)
  if (BASE_NAMES.includes(rigName)) {
    fail(`'${rigName}' is a generic base name. Pass a project copy name, such as dev or pm.`)
  }
  const targetDir = join(specs, rigName)
  let sibling = options.sibling ?? ''
  if (isUpdate) {
    if (!isDirectory(targetDir)) {
      fail(`Squad '${rigName}' does not exist in ${specs}. Provision it first.`)
    }
    kind ??= detectKind(rigName, targetDir)
    if (options.sibling === undefined) sibling = detectSibling(targetDir)
  }
  kind ??= 'delivery'

  let projectCwd = cwd
  if (operands[1] !== undefined) {
    projectCwd = resolve(cwd, operands[1])
    if (!isDirectory(projectCwd)) fail(`Project directory '${operands[1]}' does not exist.`)
  }

  const baseDir = join(specs, BASES[kind])
  if (!isFile(join(baseDir, 'rig.yaml'))) {
    out(`==> Base spec not found in ${baseDir}. Installing the ${ADAPTER_ID} adapter first...`)
    installBases(ctx, options.preset, null)
  }

  // Build the copy in memory so a bad preset writes nothing.
  let rigText = renameRig(readFileSync(join(baseDir, 'rig.yaml'), 'utf8'), rigName)
  if (kind === 'product') {
    rigText = applyProductPreset(
      rigText,
      resolvePreset(join(baseDir, 'configurations.yaml'), options.preset),
    )
  }
  rigText = addSiblingStartup(rigText)

  out(`==> 1. ${isUpdate ? 'Updating' : 'Provisioning'} spec for squad '${rigName}'...`)
  mkdirSync(targetDir, { recursive: true })
  for (const name of SHARED_DIRS) bridge(join(baseDir, name), join(targetDir, name), true)
  for (const name of SHARED_FILES) {
    if (isFile(join(baseDir, name))) bridge(join(baseDir, name), join(targetDir, name), false)
  }
  writeFileSync(join(targetDir, 'rig.yaml'), rigText)
  writeFileSync(join(targetDir, 'sibling.md'), siblingRecord(kind, rigName, sibling))

  out(`==> 2. ${isUpdate ? 'Keeping' : 'Provisioning'} Pi state bridges for squad '${rigName}'...`)
  for (const seat of squadPiSeats(kind, rigName, rigText)) {
    // Update leaves existing seat runtime state alone and only adds a missing seat. The send guard
    // is configuration, not runtime state, so a product seat always gets the current one.
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
  const { home, operands, out } = ctx
  const { specs, piState } = locations(home)
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
  if (daemonRunning(ctx)) rig(['specs', 'sync'], ctx)
  out(`==> Squad '${rigName}' removed.`)
  return 0
}
