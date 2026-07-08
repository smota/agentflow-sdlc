#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_RELEASE_VERSIONING,
  formatTag,
  loadReleaseVersioningConfig,
  validateReleaseBump,
} from '../lib/release-versioning.mjs'

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

function has(name) {
  return process.argv.includes(name)
}

function readPackageVersion(repoRoot) {
  const path = resolve(repoRoot, 'package.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')).version ?? null
}

const repoRoot = resolve(arg('--target', process.cwd()))
const config = loadReleaseVersioningConfig(repoRoot)
const current = arg('--current', null)
const next = arg('--next', readPackageVersion(repoRoot))
const bump = arg('--bump', null)
const notes = arg('--notes', null)
const errors = []

if (config.strategy !== DEFAULT_RELEASE_VERSIONING.strategy && !Array.isArray(config.segments)) {
  errors.push('Custom releaseVersioning.strategy must define releaseVersioning.segments')
}
if (!config.tagFormat?.includes('${version}'))
  errors.push('releaseVersioning.tagFormat must include ${version}')
if (bump && current && next)
  errors.push(
    ...validateReleaseBump({ currentVersion: current, nextVersion: next, bump, config }).errors,
  )
if (notes && !existsSync(resolve(repoRoot, notes)))
  errors.push(`Release notes file not found: ${notes}`)

const report = {
  ok: errors.length === 0,
  mutated: false,
  strategy: config.strategy,
  segments: config.segments,
  tagFormat: config.tagFormat,
  nextVersion: next,
  nextTag: next ? formatTag(next, config) : null,
  errors,
}

if (has('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`Release versioning validation\n`)
  process.stdout.write(`Strategy: ${report.strategy}\n`)
  process.stdout.write(`Segments: ${report.segments.join(', ')}\n`)
  if (report.nextVersion)
    process.stdout.write(`Version/tag: ${report.nextVersion} / ${report.nextTag}\n`)
  if (errors.length) {
    process.stdout.write(`Errors:\n`)
    for (const error of errors) process.stdout.write(`  - ${error}\n`)
  } else process.stdout.write(`OK\n`)
}

process.exit(report.ok ? 0 : 1)
