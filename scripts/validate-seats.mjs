#!/usr/bin/env node
// Checks every seat list in the repository against the canonical table (manifests/seats.json).
// Exit 0 READY, exit 1 BLOCKED with `file: seat ...` errors.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import YAML from 'yaml'
import {
  checkPathOwnershipAgainstTable,
  checkPolicyTextSeats,
  checkRigSpecSeats,
  checkSeatKeys,
  validateSeatTable,
} from '../lib/core/seat-table.mjs'
import { loadSeatTable } from '../lib/seat-table-io.mjs'

const POLICY_DOCS = [
  'AGENTS.md',
  'defaults/AGENTS.md',
  'docs/agent-workflow.md',
  'OPENRIG.md',
  'adapters/openrig/agentflow/CULTURE.md',
  'adapters/openrig/agentflow/README.md',
]

function readText(root, file, errors) {
  const path = join(root, file)
  if (!existsSync(path)) {
    errors.push(`${file}: file is missing`)
    return null
  }
  return readFileSync(path, 'utf8')
}

function readYaml(root, file, errors) {
  const text = readText(root, file, errors)
  if (text === null) return null
  try {
    return YAML.parse(text)
  } catch (error) {
    errors.push(`${file}: invalid YAML (${error.message})`)
    return null
  }
}

function listFiles(root, dir, suffix) {
  const path = join(root, dir)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => `${dir}/${name}`)
}

function rigBundles(root) {
  const base = join(root, 'adapters/openrig')
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'rig.yaml')))
    .map((entry) => `adapters/openrig/${entry.name}`)
    .sort()
}

export function collectSeatErrors(root) {
  const errors = []
  const table = loadSeatTable(root)
  const tableCheck = validateSeatTable(table)
  if (!tableCheck.ok) return tableCheck.errors.map((error) => `manifests/seats.json: ${error}`)

  for (const bundle of rigBundles(root)) {
    const rig = readYaml(root, `${bundle}/rig.yaml`, errors)
    if (rig) errors.push(...checkRigSpecSeats(table, rig, `${bundle}/rig.yaml`))
    const configFile = `${bundle}/configurations.yaml`
    if (!existsSync(join(root, configFile))) continue
    const config = readYaml(root, configFile, errors)
    if (!config) continue
    errors.push(...checkSeatKeys(table, Object.keys(config.seats ?? {}), configFile))
    for (const [preset, seats] of Object.entries(config.presets ?? {})) {
      errors.push(
        ...checkSeatKeys(table, Object.keys(seats ?? {}), `${configFile} (preset ${preset})`),
      )
    }
  }

  for (const file of POLICY_DOCS) {
    const text = readText(root, file, errors)
    if (text !== null) errors.push(...checkPolicyTextSeats(table, text, file))
  }

  for (const file of listFiles(root, 'manifests/execution-distributions', '.json')) {
    const text = readText(root, file, errors)
    if (text === null) continue
    const distribution = JSON.parse(text)
    // Distribution role keys mix seats (`pod.member`) with plain role names; only seats are checked.
    const keys = [
      ...Object.keys(distribution.roles ?? {}),
      ...Object.values(distribution.roleAliases ?? {}),
    ].filter((key) => key.includes('.'))
    errors.push(...checkSeatKeys(table, keys, file, { allowAliases: true }))
  }

  const pathOwnership = readText(root, 'manifests/path-ownership.json', errors)
  if (pathOwnership !== null) {
    for (const error of checkPathOwnershipAgainstTable(table, JSON.parse(pathOwnership)).errors)
      errors.push(`manifests/path-ownership.json: ${error}`)
  }
  return errors
}

function flag(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : (args[index + 1] ?? '')
}

function main(argv) {
  const root = resolve(flag(argv, '--root') ?? process.cwd())
  let errors
  try {
    errors = collectSeatErrors(root)
  } catch (error) {
    errors = [`manifests/seats.json: ${error.message}`]
  }
  const result = { ok: errors.length === 0, errors }
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else
    process.stdout.write(
      `${result.ok ? 'READY' : 'BLOCKED'}\n${errors.join('\n')}${errors.length ? '\n' : ''}`,
    )
  return result.ok ? 0 : 1
}

if (process.argv[1]?.endsWith('validate-seats.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}
