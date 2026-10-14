#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REQUIRED_RULES = ['pm-write-guard', 'builder-oracle-guard', 'test-eng-source-guard']

export function matchOwnedPath(pattern, filePath) {
  const path = String(filePath).replace(/^\.\//, '')
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return path === prefix || path.startsWith(`${prefix}/`)
  }
  return path === pattern
}

export function loadPathOwnership(packageRoot = process.cwd()) {
  const manifestPath = resolve(packageRoot, 'manifests/path-ownership.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

export function validatePathOwnershipManifest(manifest) {
  const errors = []
  if (manifest?.version !== 1) errors.push('path-ownership version must be 1')
  if (!Array.isArray(manifest?.rules)) errors.push('path-ownership rules must be an array')
  const ids = new Set((manifest?.rules ?? []).map((rule) => rule.id))
  for (const id of REQUIRED_RULES) {
    if (!ids.has(id)) errors.push(`path-ownership rule is missing: ${id}`)
  }
  return { ok: errors.length === 0, errors }
}

function rulesForSeat(manifest, seat) {
  return (manifest.rules ?? []).filter(
    (rule) =>
      rule.seats?.includes(seat) || rule.seatPrefixes?.some((prefix) => seat.startsWith(prefix)),
  )
}

export function seatFromSession(sessionName) {
  if (typeof sessionName !== 'string') return null
  const match = sessionName.trim().match(/^([^@\s]+)@([^@\s]+)$/)
  if (!match) return null
  return match[1].replace('-', '.')
}

export function changedPaths(packageRoot = process.cwd()) {
  const git = (args) =>
    execFileSync('git', args, { cwd: packageRoot, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  const names = new Set()
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/development'], {
      cwd: packageRoot,
      encoding: 'utf8',
    }).trim()
    for (const path of git(['diff', '--name-only', `${base}...HEAD`])) names.add(path)
  } catch {
    // A missing base still checks the working tree below.
  }
  for (const args of [
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
  ]) {
    try {
      for (const path of git(args)) names.add(path)
    } catch {
      // Not a git checkout.
    }
  }
  return [...names]
}

export function resolveOwnershipCheck({ seat, paths = [], manifest, env = process.env } = {}) {
  const resolvedSeat = seat || env.AGENTFLOW_SEAT || seatFromSession(env.OPENRIG_SESSION_NAME)
  if (!paths.length) return { ok: true, errors: [], seat: resolvedSeat, paths }
  if (!resolvedSeat) {
    return {
      ok: false,
      errors: ['seat is required to check changed paths'],
      seat: null,
      paths,
    }
  }
  const checked = checkPathOwnership({ seat: resolvedSeat, paths, manifest })
  return { ...checked, seat: resolvedSeat, paths }
}

export function checkPathOwnership({ seat, paths = [], manifest } = {}) {
  const errors = []
  if (!seat) errors.push('seat is required')
  for (const filePath of paths) {
    for (const rule of rulesForSeat(manifest, seat)) {
      const denied = (rule.deny ?? []).some((pattern) => matchOwnedPath(pattern, filePath))
      const allowed = (rule.allow ?? []).some((pattern) => matchOwnedPath(pattern, filePath))
      if (denied || (rule.defaultDeny && !allowed)) {
        errors.push(`${seat} cannot write ${filePath} (${rule.id})`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function flag(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : (args[index + 1] ?? '')
}

function main(argv) {
  const packageRoot = resolve(flag(argv, '--root') ?? process.cwd())
  const manifest = loadPathOwnership(packageRoot)
  const manifestCheck = validatePathOwnershipManifest(manifest)
  const seatFlag = flag(argv, '--seat')
  const pathsFlag = flag(argv, '--paths')
  const paths =
    pathsFlag === null
      ? changedPaths(packageRoot)
      : pathsFlag
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
  const pathCheck = resolveOwnershipCheck({
    seat: seatFlag,
    paths,
    manifest,
    env: process.env,
  })
  const errors = [...manifestCheck.errors, ...pathCheck.errors]
  const result = { ok: errors.length === 0, errors }
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else process.stdout.write(`${result.ok ? 'READY' : 'BLOCKED'}\n${errors.join('\n')}\n`)
  return result.ok ? 0 : 1
}

if (process.argv[1]?.endsWith('validate-path-ownership.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}
