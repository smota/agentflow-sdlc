#!/usr/bin/env node
// Checks the committed OpenRig workflow spec against the phase graph and the canonical seat table.
//   node scripts/validate-openrig-workflow.mjs [--write] [--rig] [--json] [--root <dir>]
// --write regenerates the spec. --rig also runs `rig workflow validate` (needs a daemon, OpenRig >= 0.7.6).
// Exit 0 READY, exit 1 BLOCKED. The --rig sub-check is skipped, not failed, when rig is unavailable.
import { execFile as nodeExecFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import YAML from 'yaml'
import {
  buildDeliveryWorkflowSpec,
  renderWorkflowSpecYaml,
  workflowSpecProblems,
  workflowStructureProblems,
} from '../adapters/openrig/workflow-spec.mjs'
import { loadSeatTable } from '../lib/seat-table-io.mjs'

export const SPEC_PATH = 'adapters/openrig/agentflow/workflows/agentflow-delivery.workflow.yaml'
const DAEMON_DOWN = /ECONNREFUSED|daemon|not running|unreachable/i

function flag(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : (args[index + 1] ?? '')
}

export function collectWorkflowErrors(root) {
  const seatTable = loadSeatTable(root)
  const expected = renderWorkflowSpecYaml(buildDeliveryWorkflowSpec({ seatTable }))
  const path = join(root, SPEC_PATH)
  if (!existsSync(path)) return [`${SPEC_PATH}: file is missing (run with --write)`]
  const text = readFileSync(path, 'utf8')
  let doc
  try {
    doc = YAML.parse(text)
  } catch (error) {
    return [`${SPEC_PATH}: invalid YAML (${error.message})`]
  }
  const errors = [
    ...workflowStructureProblems(doc),
    ...workflowSpecProblems(doc, { seatTable }),
  ].map((problem) => `${SPEC_PATH}: ${problem}`)
  if (text !== expected) {
    errors.push(`${SPEC_PATH}: differs from the generator output (run with --write)`)
  }
  return errors
}

/** `rig workflow validate`; `execFile` is injected so tests never run a real rig. */
export async function rigValidate(root, execFile) {
  const args = ['workflow', 'validate', join(root, SPEC_PATH), '--json']
  try {
    const { stdout } = await execFile('rig', args)
    return { status: 'ok', detail: String(stdout ?? '').trim() }
  } catch (error) {
    const detail = `${error?.stderr ?? ''}${error?.stdout ?? ''}${error?.message ?? ''}`.trim()
    if (error?.code === 'ENOENT') return { status: 'skipped', detail: 'rig not available' }
    if (DAEMON_DOWN.test(detail)) return { status: 'skipped', detail: 'rig daemon not reachable' }
    return { status: 'failed', detail }
  }
}

export async function main(
  argv,
  { execFile = promisify(nodeExecFile), write = (text) => process.stdout.write(text) } = {},
) {
  const root = resolve(flag(argv, '--root') ?? process.cwd())
  let errors
  try {
    if (argv.includes('--write')) {
      const spec = buildDeliveryWorkflowSpec({ seatTable: loadSeatTable(root) })
      mkdirSync(dirname(join(root, SPEC_PATH)), { recursive: true })
      writeFileSync(join(root, SPEC_PATH), renderWorkflowSpecYaml(spec))
    }
    errors = collectWorkflowErrors(root)
  } catch (error) {
    errors = [`${SPEC_PATH}: ${error.message}`]
  }
  const result = { ok: errors.length === 0, errors }
  if (argv.includes('--rig')) {
    result.rig = await rigValidate(root, execFile)
    if (result.rig.status === 'failed') {
      result.ok = false
      errors.push(`rig workflow validate: ${result.rig.detail}`)
    }
  }
  if (argv.includes('--json')) write(`${JSON.stringify(result, null, 2)}\n`)
  else {
    const rig = result.rig
      ? `rig workflow validate ${SPEC_PATH} ${result.rig.status === 'ok' ? 'ok' : `${result.rig.status}: ${result.rig.detail}`}\n`
      : ''
    write(
      `${result.ok ? 'READY' : 'BLOCKED'}\n${errors.join('\n')}${errors.length ? '\n' : ''}${rig}`,
    )
  }
  return result.ok ? 0 : 1
}

if (process.argv[1]?.endsWith('validate-openrig-workflow.mjs')) {
  process.exitCode = await main(process.argv.slice(2))
}
