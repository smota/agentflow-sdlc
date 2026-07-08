import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULT_RELEASE_VERSIONING = {
  strategy: 'main.minor.fix',
  segments: ['main', 'minor', 'fix'],
  tagFormat: 'v${version}',
  packageVersionSource: 'package.json',
  requireExplicitApproval: true,
  allowPrerelease: true,
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function loadReleaseVersioningConfig(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'agent-workflow.config.json')
  if (!existsSync(path)) return DEFAULT_RELEASE_VERSIONING
  const config = JSON.parse(readFileSync(path, 'utf8'))
  const release = isPlainObject(config.releaseVersioning) ? config.releaseVersioning : {}
  return {
    ...DEFAULT_RELEASE_VERSIONING,
    ...release,
    segments: Array.isArray(release.segments)
      ? release.segments
      : DEFAULT_RELEASE_VERSIONING.segments,
  }
}

export function parseVersion(version) {
  const match = String(version ?? '')
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) throw new Error(`Invalid version "${version}"; expected <main>.<minor>.<fix>`)
  return {
    main: Number(match[1]),
    minor: Number(match[2]),
    fix: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

export function formatVersion(parts) {
  const base = `${parts.main}.${parts.minor}.${parts.fix}`
  return parts.prerelease ? `${base}-${parts.prerelease}` : base
}

export function incrementVersion(currentVersion, bump, config = DEFAULT_RELEASE_VERSIONING) {
  const current = parseVersion(currentVersion)
  const segments = config.segments ?? DEFAULT_RELEASE_VERSIONING.segments
  const index = segments.indexOf(bump)
  if (index === 0) return formatVersion({ main: current.main + 1, minor: 0, fix: 0 })
  if (index === 1) return formatVersion({ main: current.main, minor: current.minor + 1, fix: 0 })
  if (index === 2)
    return formatVersion({ main: current.main, minor: current.minor, fix: current.fix + 1 })
  throw new Error(`Invalid bump "${bump}"; expected one of ${segments.join(', ')}`)
}

export function formatTag(version, config = DEFAULT_RELEASE_VERSIONING) {
  return (config.tagFormat ?? DEFAULT_RELEASE_VERSIONING.tagFormat).replace('${version}', version)
}

export function validateReleaseBump({
  currentVersion,
  nextVersion,
  bump,
  config = DEFAULT_RELEASE_VERSIONING,
}) {
  const expected = incrementVersion(currentVersion, bump, config)
  const errors = []
  if (!config.segments.includes(bump))
    errors.push(`Bump "${bump}" is not allowed by configured segments`)
  if (nextVersion !== expected)
    errors.push(`Expected ${expected} for ${bump} bump from ${currentVersion}, got ${nextVersion}`)
  return { ok: errors.length === 0, expectedVersion: expected, errors }
}

function readPackageVersion(repoRoot) {
  const path = resolve(repoRoot, 'package.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')).version ?? null
}

function latestTag(repoRoot, tagPrefix = 'v') {
  try {
    const out = execFileSync('git', ['tag', '--sort=-version:refname'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return (
      out
        .split('\n')
        .map((line) => line.trim())
        .find((tag) => tag.startsWith(tagPrefix)) ?? null
    )
  } catch {
    return null
  }
}

export function buildReleasePlan({
  repoRoot = process.cwd(),
  bump = 'fix',
  currentVersion,
  notesPath,
} = {}) {
  const config = loadReleaseVersioningConfig(repoRoot)
  const packageVersion = readPackageVersion(repoRoot)
  const tagPrefix = (config.tagFormat ?? 'v${version}').split('${version}')[0]
  const previousTag = latestTag(repoRoot, tagPrefix)
  const detectedVersion =
    currentVersion ?? packageVersion ?? previousTag?.replace(tagPrefix, '') ?? '0.0.0'
  const nextVersion = incrementVersion(detectedVersion, bump, config)
  const tag = formatTag(nextVersion, config)
  return {
    ok: true,
    mutated: false,
    strategy: config.strategy,
    bump,
    currentVersion: detectedVersion,
    nextVersion,
    tag,
    previousTag,
    packageVersion,
    notesPath: notesPath ?? `.agent-runs/scratch/release-${nextVersion}.md`,
    approvalRequired: config.requireExplicitApproval !== false,
    message: 'Preview only. No files, tags, pushes, or GitHub releases were changed.',
  }
}
