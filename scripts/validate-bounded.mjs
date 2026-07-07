import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Project-owned config: a project supplies its own bounded-path allowlist/denylist and sensitive
// pattern here so this generic engine never hardcodes a stack's routes, auth surface, or package
// layout. See docs/stack-conventions.md (template in agents/templates/stack-conventions.md) for
// the contract. With no config present this fails closed: nothing is bounded until a project
// opts specific paths in.
const CONFIG_PATH = 'agent-workflow.config.json'

function loadBoundedConfig() {
  const defaults = {
    maxFiles: 50,
    maxChangedLines: 10000,
    defaultBase: 'origin/main',
    deniedPathFragments: [],
    allowedExactPaths: [],
    allowedPathPrefixes: [],
    allowedPathFragments: ['/test/fixtures/', '/__fixtures__/'],
    sensitiveAdditionPattern: null,
  }
  if (!existsSync(CONFIG_PATH)) {
    return defaults
  }
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    const bounded = config.bounded ?? {}
    return {
      maxFiles: bounded.maxFiles ?? defaults.maxFiles,
      maxChangedLines: bounded.maxChangedLines ?? defaults.maxChangedLines,
      defaultBase: bounded.defaultBase ?? defaults.defaultBase,
      deniedPathFragments: bounded.deniedPathFragments ?? defaults.deniedPathFragments,
      allowedExactPaths: bounded.allowedExactPaths ?? defaults.allowedExactPaths,
      allowedPathPrefixes: bounded.allowedPathPrefixes ?? defaults.allowedPathPrefixes,
      allowedPathFragments: bounded.allowedPathFragments ?? defaults.allowedPathFragments,
      sensitiveAdditionPattern:
        bounded.sensitiveAdditionPattern ?? defaults.sensitiveAdditionPattern,
    }
  } catch {
    return defaults
  }
}

const config = loadBoundedConfig()

export const BOUNDED_MAX_FILES = config.maxFiles
export const BOUNDED_MAX_CHANGED_LINES = config.maxChangedLines

const ALLOWED_EXACT_PATHS = new Set(config.allowedExactPaths)
const SENSITIVE_ADDITION_RE = config.sensitiveAdditionPattern
  ? new RegExp(config.sensitiveAdditionPattern, 'i')
  : null

/**
 * Conservative allow-list for Lane B (bounded autonomous execution). Fails closed: a path is
 * bounded only if a project's config explicitly allows it, and never if the denylist matches.
 */
export function isBoundedPath(rawPath) {
  const normalized = rawPath.replace(/\\/g, '/')
  if (config.deniedPathFragments.some((fragment) => normalized.includes(fragment))) {
    return false
  }
  return (
    ALLOWED_EXACT_PATHS.has(normalized) ||
    config.allowedPathPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    config.allowedPathFragments.some((fragment) => normalized.includes(fragment))
  )
}

/**
 * True if any added (`+`) diff line introduces a sensitive application or permission surface, per
 * the project's configured pattern. With no pattern configured, this check is skipped (the path
 * allowlist above is the only gate).
 */
export function containsSensitiveBoundedAddition(diff) {
  if (!SENSITIVE_ADDITION_RE) return false
  return diff
    .split('\n')
    .some(
      (line) => line.startsWith('+') && !line.startsWith('+++') && SENSITIVE_ADDITION_RE.test(line),
    )
}

/**
 * Splits file content the same way Rust's `str::lines()` does: no trailing empty entry for a
 * final newline, and zero entries for an empty string.
 */
function splitLines(content) {
  if (content === '') return []
  const withoutTrailingNewline = content.endsWith('\n') ? content.slice(0, -1) : content
  return withoutTrailingNewline.split('\n')
}

/**
 * Reads an untracked file and reports its line count plus whether treating every line as an
 * addition would trip the sensitive-surface check.
 */
export function inspectUntrackedFile(repoRoot, relPath) {
  const fullPath = join(repoRoot, relPath)
  let content
  try {
    content = readFileSync(fullPath, 'utf8')
  } catch (error) {
    throw new Error(`Bounded validation cannot inspect ${relPath}: ${error.message}`)
  }
  const lines = splitLines(content)
  const additions = lines.map((line) => `+${line}`).join('\n')
  return { lines: lines.length, sensitive: containsSensitiveBoundedAddition(additions) }
}

export function getRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    throw new Error('Not inside a git repository')
  }
}

function runGit(repoRoot, args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : error.message
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
  }
}

/**
 * Evaluates whether the current diff against `base` qualifies for bounded Lane B (autonomous
 * execution without independent review).
 */
export function validateBounded(base, repoRoot = getRepoRoot()) {
  const names = runGit(repoRoot, ['diff', '--name-only', base, '--'])
  const numstat = runGit(repoRoot, ['diff', '--numstat', base, '--'])
  const diff = runGit(repoRoot, ['diff', '--unified=0', base, '--'])
  const status = runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'])

  const paths = names
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\\/g, '/'))

  const untrackedPaths = status
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim().replace(/\\/g, '/'))

  for (const path of untrackedPaths) {
    paths.push(path)
  }
  paths.sort()
  const dedupedPaths = [...new Set(paths)]

  const reasons = []
  if (dedupedPaths.length === 0) {
    reasons.push('no changed files found')
  }
  if (dedupedPaths.length > config.maxFiles) {
    reasons.push(`${dedupedPaths.length} changed files exceeds bounded limit ${config.maxFiles}`)
  }
  for (const path of dedupedPaths) {
    if (!isBoundedPath(path)) {
      reasons.push(`sensitive or unsupported path: ${path}`)
    }
  }

  let changedLines = numstat
    .split('\n')
    .filter((line) => line.length > 0)
    .reduce((total, line) => {
      const [added, deleted] = line.split('\t')
      return total + (Number.parseInt(added, 10) || 0) + (Number.parseInt(deleted, 10) || 0)
    }, 0)

  let untrackedSensitive = false
  for (const path of untrackedPaths) {
    const inspected = inspectUntrackedFile(repoRoot, path)
    changedLines += inspected.lines
    untrackedSensitive = untrackedSensitive || inspected.sensitive
  }

  if (changedLines > config.maxChangedLines) {
    reasons.push(`${changedLines} changed lines exceeds bounded limit ${config.maxChangedLines}`)
  }
  if (containsSensitiveBoundedAddition(diff) || untrackedSensitive) {
    reasons.push('diff adds a sensitive application or permission surface')
  }

  return { ok: reasons.length === 0, paths: dedupedPaths, changedLines, reasons }
}

function main() {
  const args = process.argv.slice(2)
  const jsonOutput = args.includes('--json')
  const baseFlagIndex = args.indexOf('--base')
  const base = baseFlagIndex !== -1 ? args[baseFlagIndex + 1] : config.defaultBase

  let result
  try {
    result = validateBounded(base)
  } catch (error) {
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`)
    } else {
      process.stderr.write(`[validate-bounded] ${error.message}\n`)
    }
    process.exit(2)
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(
      `Bounded validation passed: ${result.paths.length} files, ${result.changedLines} changed lines.\n`,
    )
  } else {
    process.stdout.write(`Bounded validation failed:\n- ${result.reasons.join('\n- ')}\n`)
  }

  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
