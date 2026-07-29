import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PLUGIN_HARNESSES = ['claude-code', 'agy', 'codex', 'pi']

export function loadPluginManifest(packageRoot, harness) {
  const path = join(packageRoot, 'adapters', harness, 'manifest.json')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function validatePluginManifests({ packageRoot, harness = 'all' } = {}) {
  const harnesses = resolveHarnesses(harness)
  const findings = []
  const manifests = []
  for (const item of harnesses) {
    const manifest = loadPluginManifest(packageRoot, item)
    manifests.push(manifest)
    for (const field of [
      'id',
      'name',
      'version',
      'harness',
      'entry',
      'skills',
      'commands',
      'settings',
    ]) {
      if (manifest[field] === undefined)
        findings.push({
          severity: 'blocker',
          code: 'plugin.field',
          message: `${item} missing ${field}`,
        })
    }
    if (manifest.harness !== item)
      findings.push({
        severity: 'blocker',
        code: 'plugin.harness',
        message: `${item} manifest harness mismatch`,
      })
    for (const skill of manifest.skills || []) {
      if (!existsSync(join(packageRoot, 'skills', skill, 'SKILL.md')))
        findings.push({
          severity: 'blocker',
          code: 'plugin.skill',
          message: `${item} references missing skill ${skill}`,
        })
    }
  }
  return {
    ok: findings.every((item) => !['blocker', 'high'].includes(item.severity)),
    findings,
    manifests,
  }
}

export function buildPluginManifests({
  packageRoot,
  targetDir,
  harness = 'all',
  write = false,
} = {}) {
  const validation = validatePluginManifests({ packageRoot, harness })
  const entries = []
  for (const manifest of validation.manifests) {
    const target = join(targetDir, generatedManifestPath(manifest.harness))
    const body = `${JSON.stringify({ ...manifest, generatedBy: 'agentflow-sdlc', canonicalSource: `adapters/${manifest.harness}/manifest.json` }, null, 2)}\n`
    const status =
      existsSync(target) && readFileSync(target, 'utf8') === body ? 'unchanged' : 'planned'
    entries.push({
      harness: manifest.harness,
      source: `adapters/${manifest.harness}/manifest.json`,
      target,
      status,
    })
    if (write && status !== 'unchanged') {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, body)
    }
  }
  return {
    ok: validation.ok,
    mode: write ? 'apply' : 'dry-run',
    entries,
    findings: validation.findings,
  }
}

export function pluginStatus({ packageRoot, targetDir, harness = 'all' } = {}) {
  const result = buildPluginManifests({ packageRoot, targetDir, harness, write: false })
  return { ...result, stale: result.entries.filter((entry) => entry.status !== 'unchanged') }
}

function generatedManifestPath(harness) {
  if (harness === 'claude-code') return '.claude/agentflow-sdlc.plugin.json'
  if (harness === 'agy') return '.agy/agentflow-sdlc.plugin.json'
  if (harness === 'codex') return '.codex/agentflow-sdlc.plugin.json'
  return '.pi/agentflow-sdlc.plugin.json'
}

function resolveHarnesses(harness) {
  if (harness === 'all') return PLUGIN_HARNESSES
  return String(harness)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
