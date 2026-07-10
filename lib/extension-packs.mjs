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

export function configuredExtensionPacks(repoRoot = process.cwd(), configPath = DEFAULT_CONFIG) {
  const config = readJsonIfExists(path.resolve(repoRoot, configPath))
  const extensionConfig = config.extensions ?? {}
  if (Array.isArray(extensionConfig)) return extensionConfig
  return extensionConfig.enabledPacks ?? []
}

export function discoverExtensionPacks(repoRoot = process.cwd(), roots = DEFAULT_PACK_ROOTS) {
  const packs = []
  for (const root of roots) {
    const absoluteRoot = path.resolve(repoRoot, root)
    if (!fs.existsSync(absoluteRoot)) continue
    const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const packDir = path.join(absoluteRoot, entry.name)
      const manifestPath = path.join(packDir, 'extension-pack.yaml')
      if (fs.existsSync(manifestPath)) packs.push(loadExtensionPack(packDir, repoRoot))
    }
  }
  return packs
}

export function loadExtensionPack(packDir, repoRoot = process.cwd()) {
  const absoluteDir = path.resolve(repoRoot, packDir)
  const manifestPath = path.join(absoluteDir, 'extension-pack.yaml')
  const manifest = parseSimpleYaml(readText(manifestPath), manifestPath)
  return {
    dir: absoluteDir,
    relativeDir: path.relative(path.resolve(repoRoot), absoluteDir).split(path.sep).join('/'),
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
  if (!target.startsWith(pack.dir))
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

export function validateConfiguredExtensionPacks(repoRoot = process.cwd(), options = {}) {
  const configured = configuredExtensionPacks(repoRoot, options.configPath)
  const packs = configured.map((packPath) => loadExtensionPack(packPath, repoRoot))
  const results = packs.map((pack) => ({ pack, ...validateExtensionPack(pack, options) }))
  return { configured, results }
}
