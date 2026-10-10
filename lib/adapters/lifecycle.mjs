// Execution adapter lifecycle dispatch. Core knows only the manifest contract: an adapter that
// declares `lifecycle.module` gets install, update, and squad operations through the product CLI.
// Everything harness-specific lives in that adapter's module.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LIFECYCLE_OPERATIONS = {
  install: { exported: 'install', flags: ['preset', 'home'], maxPositionals: 1 },
  update: { exported: 'update', flags: ['home', 'exact'], maxPositionals: 0 },
  'squads provision': {
    exported: 'squadProvision',
    flags: ['kind', 'sibling', 'preset', 'home'],
    minPositionals: 1,
    maxPositionals: 2,
  },
  'squads update': {
    exported: 'squadUpdate',
    flags: ['kind', 'sibling', 'preset', 'home'],
    minPositionals: 1,
    maxPositionals: 2,
  },
  'squads list': { exported: 'squadList', flags: ['home', 'json'], maxPositionals: 0 },
  'squads remove': {
    exported: 'squadRemove',
    flags: ['home'],
    minPositionals: 1,
    maxPositionals: 1,
  },
}

const BOOLEAN_FLAGS = new Set(['json', 'exact'])

export const ADAPTERS_USAGE = `Usage:
  agentflow-sdlc adapters install <id> [--preset <name>] [--home <dir>] [repo]
  agentflow-sdlc adapters update <id> [--home <dir>] [--exact]
  agentflow-sdlc adapters squads provision <id> [--kind delivery|product] [--sibling <rig>] [--preset <name>] [--home <dir>] <project> [cwd]
  agentflow-sdlc adapters squads update <id> [--kind delivery|product] [--sibling <rig>] [--preset <name>] [--home <dir>] <project> [cwd]
  agentflow-sdlc adapters squads list <id> [--json] [--home <dir>]
  agentflow-sdlc adapters squads remove <id> [--home <dir>] <project>

Installs, updates, and operates an execution adapter. Install again to recover.
Update refreshes the adapter from this product; it does not upgrade the harness itself.
Discovery stays in \`agentflow-sdlc providers\`.
`

export class LifecycleError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

// Adapter roots: the product's own adapters/, then any directories in AGENTFLOW_ADAPTER_PATH.
export function adapterRoots(packageRoot, env = process.env) {
  const extra = (env.AGENTFLOW_ADAPTER_PATH || '').split(delimiter).filter(Boolean)
  return [join(packageRoot, 'adapters'), ...extra.map((dir) => resolve(dir))]
}

export function loadAdapterManifests(roots) {
  const adapters = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      const manifestPath = join(dir, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      adapters.push({ id: manifest.harness || entry.name, dir, manifest })
    }
  }
  return adapters
}

export function resolveLifecycleAdapter(adapters, id) {
  const withLifecycle = adapters.filter((adapter) => adapter.manifest.lifecycle?.module)
  const known = withLifecycle.map((adapter) => adapter.id).join(', ') || 'none'
  const adapter = adapters.find((item) => item.id === id)
  if (!adapter) {
    throw new LifecycleError(
      `Unknown adapter "${id}". Adapters with lifecycle operations: ${known}.`,
    )
  }
  if (!adapter.manifest.lifecycle?.module) {
    throw new LifecycleError(
      `Adapter "${id}" has no lifecycle operations. Adapters with lifecycle operations: ${known}.`,
    )
  }
  return adapter
}

export function parseLifecycleArgs(args) {
  let operation = args[0]
  let rest = args.slice(1)
  if (operation === 'squads') {
    operation = `squads ${args[1] ?? ''}`.trim()
    rest = args.slice(2)
  }
  const spec = LIFECYCLE_OPERATIONS[operation]
  if (!spec) throw new LifecycleError(`Unknown adapters operation "${operation ?? ''}".`, 2)

  const options = {}
  const positionals = []
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const [rawName, inline] = arg.slice(2).split(/=(.*)/s, 2)
    if (!spec.flags.includes(rawName)) {
      throw new LifecycleError(`Unknown option "--${rawName}" for adapters ${operation}.`, 2)
    }
    if (BOOLEAN_FLAGS.has(rawName)) {
      options[rawName] = true
      continue
    }
    const value = inline ?? rest[(index += 1)]
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) {
      throw new LifecycleError(`--${rawName} requires a value.`, 2)
    }
    options[rawName] = value
  }

  const [id, ...operands] = positionals
  if (!id) throw new LifecycleError(`adapters ${operation} requires an adapter id.`, 2)
  if (operands.length < (spec.minPositionals ?? 0)) {
    throw new LifecycleError(`adapters ${operation} is missing a required argument.`, 2)
  }
  if (operands.length > spec.maxPositionals) {
    throw new LifecycleError(
      `Unexpected argument "${operands[spec.maxPositionals]}" for adapters ${operation}.`,
      2,
    )
  }
  return { operation, spec, id, options, operands }
}

export async function runAdapterLifecycle({
  args,
  packageRoot,
  env = process.env,
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  try {
    const { operation, spec, id, options, operands } = parseLifecycleArgs(args)
    const adapter = resolveLifecycleAdapter(
      loadAdapterManifests(adapterRoots(packageRoot, env)),
      id,
    )
    const module = await import(pathToFileURL(join(adapter.dir, adapter.manifest.lifecycle.module)))
    const handler = module[spec.exported]
    if (typeof handler !== 'function') {
      throw new LifecycleError(`Adapter "${id}" does not support adapters ${operation}.`)
    }
    const home = resolve(options.home ?? homedir())
    const code = await handler({
      adapterDir: adapter.dir,
      manifest: adapter.manifest,
      home,
      options,
      operands,
      cwd,
      env,
      out: (line = '') => stdout.write(`${line}\n`),
      err: (line = '') => stderr.write(`${line}\n`),
    })
    return code ?? 0
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`)
    // Adapter modules signal a refusal with any Error that carries an integer exitCode.
    return Number.isInteger(error.exitCode) ? error.exitCode : 1
  }
}
