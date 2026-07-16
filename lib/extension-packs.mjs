import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const DEFAULT_CONFIG = 'agent-workflow.config.json'
export const DEFAULT_PACK_ROOTS = ['extensions', 'contrib']
export const REQUIRED_PACK_FILES = ['extension-pack.yaml', 'README.md']
export const VALID_PACK_KINDS = new Set([
  'engineering-approach',
  'stack',
  'compliance',
  'runtime',
  'quality-gate',
  'workflow-overlay',
])

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function toSlash(value) {
  return String(value).replace(/\\/g, '/')
}

function normalizeRelative(value) {
  return toSlash(path.normalize(String(value))).replace(/^\.\//, '')
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

export function parseScalar(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((part) => parseScalar(part))
  }
  return trimmed
}

export function parseSimpleYaml(source, sourcePath = '<inline>') {
  const root = {}
  const stack = [{ indent: -1, value: root }]
  const lines = source.replace(/\r\n/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const withoutComment = raw.replace(/\s+#.*$/, '')
    if (!withoutComment.trim()) continue
    const indent = withoutComment.match(/^ */)[0].length
    const line = withoutComment.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].value

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        throw new Error(`${sourcePath}:${index + 1}: list item has no list parent`)
      }
      const itemText = line.slice(2).trim()
      if (itemText.includes(':') && !itemText.startsWith('"')) {
        const [key, ...rest] = itemText.split(':')
        const obj = {}
        const value = rest.join(':').trim()
        obj[key.trim()] = value ? parseScalar(value) : {}
        parent.push(obj)
        if (!value) stack.push({ indent, value: obj[key.trim()] })
        else stack.push({ indent, value: obj })
      } else {
        parent.push(parseScalar(itemText))
      }
      continue
    }

    const match = line.match(/^([^:]+):(.*)$/)
    if (!match || Array.isArray(parent)) {
      throw new Error(`${sourcePath}:${index + 1}: unsupported YAML shape`)
    }
    const key = match[1].trim()
    const valueText = match[2].trim()
    if (valueText) {
      parent[key] = parseScalar(valueText)
      continue
    }

    const next = lines
      .slice(index + 1)
      .find((candidate) => candidate.trim() && !candidate.trim().startsWith('#'))
    const child =
      next && next.match(/^ */)[0].length > indent && next.trim().startsWith('- ') ? [] : {}
    parent[key] = child
    stack.push({ indent, value: child })
  }

  return root
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return JSON.parse(readText(filePath))
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function configuredExtensionPacks(repoRoot = process.cwd(), configPath = DEFAULT_CONFIG) {
  const config = readJsonIfExists(path.resolve(repoRoot, configPath))
  const extensionConfig = config.extensions ?? {}
  const enabled = Array.isArray(extensionConfig)
    ? extensionConfig
    : (extensionConfig.enabledPacks ?? [])
  return enabled.map((entry) => normalizeRelative(entry))
}

export function discoverExtensionPacks(repoRoot = process.cwd(), roots = DEFAULT_PACK_ROOTS) {
  const packs = []
  const absoluteRepoRoot = path.resolve(repoRoot)
  for (const root of roots) {
    const absoluteRoot = path.resolve(absoluteRepoRoot, root)
    if (!isInside(absoluteRepoRoot, absoluteRoot) || !fs.existsSync(absoluteRoot)) continue
    const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const packDir = path.join(absoluteRoot, entry.name)
      const manifestPath = path.join(packDir, 'extension-pack.yaml')
      if (fs.existsSync(manifestPath)) packs.push(loadExtensionPack(packDir, absoluteRepoRoot))
    }
  }
  return packs.sort((a, b) => a.relativeDir.localeCompare(b.relativeDir))
}

export function loadExtensionPack(packDir, repoRoot = process.cwd()) {
  const absoluteRepoRoot = path.resolve(repoRoot)
  const absoluteDir = path.resolve(absoluteRepoRoot, packDir)
  if (!isInside(absoluteRepoRoot, absoluteDir)) {
    throw new Error(`extension pack path escapes repository: ${packDir}`)
  }
  const manifestPath = path.join(absoluteDir, 'extension-pack.yaml')
  const manifest = parseSimpleYaml(readText(manifestPath), manifestPath)
  return {
    dir: absoluteDir,
    relativeDir: normalizeRelative(path.relative(absoluteRepoRoot, absoluteDir)),
    manifestPath,
    manifest,
  }
}

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function checkPath(errors, pack, relativePath, label) {
  if (!relativePath || typeof relativePath !== 'string') return
  const target = path.resolve(pack.dir, relativePath)
  if (!isInside(pack.dir, target))
    errors.push(
      `${pack.relativeDir}: ${label} escapes the extension-pack directory: ${relativePath}`,
    )
  else if (!fs.existsSync(target))
    errors.push(`${pack.relativeDir}: missing ${label}: ${relativePath}`)
}

export function validateExtensionPack(pack, options = {}) {
  const errors = []
  const warnings = []
  const manifest = pack.manifest

  for (const required of REQUIRED_PACK_FILES) checkPath(errors, pack, required, 'required file')
  for (const field of ['id', 'kind', 'version', 'description']) {
    if (!manifest[field])
      errors.push(`${pack.relativeDir}: extension-pack.yaml missing required field '${field}'`)
  }
  if (manifest.kind && !VALID_PACK_KINDS.has(manifest.kind)) {
    errors.push(`${pack.relativeDir}: unsupported kind '${manifest.kind}'`)
  }

  for (const file of asArray(manifest.principles)) checkPath(errors, pack, file, 'principles file')
  for (const file of asArray(manifest.documentation))
    checkPath(errors, pack, file, 'documentation file')
  for (const template of asArray(manifest.templates)) checkPath(errors, pack, template, 'template')
  for (const tool of asArray(manifest.tools)) {
    if (typeof tool === 'string') checkPath(errors, pack, tool, 'tool')
    else checkPath(errors, pack, tool.path, 'tool')
  }
  for (const validator of asArray(manifest.validators)) {
    if (typeof validator === 'string') continue
    checkPath(errors, pack, validator.path, 'validator')
  }

  for (const skill of asArray(manifest.requiredSkills)) {
    if (typeof skill !== 'string')
      errors.push(`${pack.relativeDir}: requiredSkills entries must be strings`)
  }
  for (const capability of asArray(manifest.requiredCapabilities)) {
    if (typeof capability !== 'string')
      errors.push(`${pack.relativeDir}: requiredCapabilities entries must be strings`)
  }

  if (options.runValidators) {
    for (const validator of asArray(manifest.validators)) {
      const command = typeof validator === 'string' ? validator : validator.command
      if (!command) continue
      const result = spawnSync(command, { cwd: pack.dir, shell: true, encoding: 'utf8' })
      if (result.status !== 0) {
        errors.push(
          `${pack.relativeDir}: validator failed (${command})\n${result.stdout}${result.stderr}`.trim(),
        )
      }
    }
  }

  return { errors, warnings }
}

export function buildExtensionRegistry(repoRoot = process.cwd(), options = {}) {
  const configured = configuredExtensionPacks(repoRoot, options.configPath)
  const discovered = discoverExtensionPacks(repoRoot, options.roots ?? DEFAULT_PACK_ROOTS)
  const byPath = new Map(discovered.map((pack) => [pack.relativeDir, pack]))
  const idGroups = new Map()

  for (const pack of discovered) {
    const id = pack.manifest.id
    if (!id) continue
    idGroups.set(id, [...(idGroups.get(id) ?? []), pack])
  }

  const duplicateIds = [...idGroups.entries()]
    .filter(([, packs]) => packs.length > 1)
    .map(([id, packs]) => `${id}: ${packs.map((pack) => pack.relativeDir).join(', ')}`)

  const enabledValid = []
  const enabledMissing = []
  const enabledInvalid = []
  const validationResults = []

  for (const packPath of configured) {
    const pack = byPath.get(packPath)
    if (!pack) {
      enabledMissing.push(packPath)
      continue
    }
    const validation = validateExtensionPack(pack, options)
    validationResults.push({ pack, ...validation })
    if (validation.errors.length) {
      enabledInvalid.push(`${pack.relativeDir}: ${validation.errors.join('; ')}`)
    } else {
      enabledValid.push(pack.relativeDir)
    }
  }

  const configuredSet = new Set(configured)
  const discoveredDisabled = discovered
    .map((pack) => pack.relativeDir)
    .filter((packPath) => !configuredSet.has(packPath))

  return {
    configured,
    discovered,
    duplicateIds,
    enabledValid,
    enabledMissing,
    enabledInvalid,
    discoveredDisabled,
    validationResults,
  }
}

export function resolveExtensionPack(repoRoot, selector, options = {}) {
  const normalized = normalizeRelative(selector)
  const registry = buildExtensionRegistry(repoRoot, options)
  const byPath = new Map(registry.discovered.map((pack) => [pack.relativeDir, pack]))
  if (byPath.has(normalized)) return byPath.get(normalized)

  const matches = registry.discovered.filter((pack) => pack.manifest.id === selector)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new Error(
      `ambiguous extension pack '${selector}'; use one of: ${matches
        .map((pack) => pack.relativeDir)
        .join(', ')}`,
    )
  }
  throw new Error(`extension pack not found: ${selector}`)
}

export function setExtensionPackEnabled(repoRoot, selector, enabled, options = {}) {
  const configPath = path.resolve(repoRoot, options.configPath ?? DEFAULT_CONFIG)
  const config = readJsonIfExists(configPath)
  const pack = resolveExtensionPack(repoRoot, selector, options)
  const current = configuredExtensionPacks(repoRoot, options.configPath)
  const nextSet = new Set(current)
  if (enabled) nextSet.add(pack.relativeDir)
  else nextSet.delete(pack.relativeDir)
  const nextEnabled = [...nextSet].sort()

  config.extensions =
    config.extensions && !Array.isArray(config.extensions) ? config.extensions : {}
  config.extensions.enabledPacks = nextEnabled
  const previous = JSON.stringify(config, null, 2)
  const existing = fs.existsSync(configPath) ? readText(configPath).trimEnd() : ''
  const changed = existing !== previous
  if (changed) writeJson(configPath, config)

  return {
    pack: pack.relativeDir,
    enabled,
    changed,
    enabledPacks: nextEnabled,
  }
}

export function validateConfiguredExtensionPacks(repoRoot = process.cwd(), options = {}) {
  const registry = buildExtensionRegistry(repoRoot, options)
  const results = [...registry.validationResults]
  for (const missing of registry.enabledMissing) {
    results.push({
      pack: { relativeDir: missing },
      errors: [`${missing}: enabled extension pack is missing`],
      warnings: [],
    })
  }
  return { configured: registry.configured, results, registry }
}
