import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import {
  defaultDistributionSelection,
  resolveDistribution,
} from '../lib/config/execution-distribution.mjs'
import { planRigExecution } from '../adapters/openrig/execution-plan.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)),
  selection = defaultDistributionSelection(),
  profile = resolveDistribution(selection)
const write = process.argv.includes('--write')
let drift = false
function output(path, text) {
  const file = resolve(root, path)
  const existing = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const normalized = text.replace(/\r\n/g, '\n')
  if (existing === normalized) return
  if (write) writeFileSync(file, normalized)
  else {
    drift = true
    process.stderr.write(`Distribution projection differs: ${path}\n`)
  }
}
for (const bundle of ['agentflow', 'agentflow-product', 'agentflow-steer']) {
  const path = `adapters/openrig/${bundle}/configurations.yaml`,
    text = readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n'),
    doc = parseDocument(text, { uniqueKeys: true })
  if (doc.errors.length) throw doc.errors[0]
  const seats = Object.keys(doc.toJS().seats),
    presets = {}
  for (const seat of seats) {
    if (!profile.roles[seat]) continue
    const { client, subscription, ...tuple } = profile.roles[seat].options[0]
    presets[seat] = tuple
  }
  doc.set('recommended', profile.id)
  doc.set('distribution', selection)
  doc.setIn(['presets', profile.id], presets)
  output(path, doc.toString())
  const rigPath = `adapters/openrig/${bundle}/rig.yaml`,
    rigText = readFileSync(resolve(root, rigPath), 'utf8').replace(/\r\n/g, '\n')
  const planned = planRigExecution({
    rigText,
    configText: doc.toString(),
    preset: profile.id,
    config: { executionDistribution: selection },
  })
  if (!planned.ok)
    throw new Error(
      planned.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.message)
        .join('; '),
    )
  const rigDoc = parseDocument(planned.rigText, { uniqueKeys: true })
  rigDoc.set(
    'summary',
    'Subscription-balanced AgentFlow squad. Resolve the pinned distribution for model, client, effort and two ordered fallbacks; preserve workflow and publication authority.',
  )
  output(rigPath, rigDoc.toString())
  const culture = `adapters/openrig/${bundle}/CULTURE.md`,
    current = readFileSync(resolve(root, culture), 'utf8').replace(/\r\n/g, '\n'),
    start = '<!-- BEGIN AgentFlow EXECUTION DISTRIBUTION -->',
    end = '<!-- END AgentFlow EXECUTION DISTRIBUTION -->'
  const block = `${start}\n\n## Execution distribution\n\nResolve this project's pinned \`executionDistribution\` with \`agentflow-sdlc distribution inspect\` before routing, provisioning, expansion, recovery or upgrades. The shared template profile is \`${profile.id}\`; an existing project selection and reasoned overrides take precedence. Run \`distribution check --rig <path>\` for installed drift. Software upgrades and calibration preserve the selected distribution. Optional quota checkpoints (\`quotaControl.enabled: false\` by default; inspected with \`distribution quota\`) evaluate \`weekly\` and \`five-hour\` windows when enabled, classify observations (\`supported\`, \`approximate\`, \`stale\`, \`unavailable\`), and select an eligible approved fallback at a safe checkpoint or park work cleanly without rewriting saved defaults or granting publication authority. Model, effort, client and both fallback options come from the resolved policy. Record actual execution separately. A policy change uses \`distribution plan\` and exact-confirmed \`distribution apply\`; the person authorizes that migration separately from a software upgrade. Unsupported enforcement or unavailable observation remains explicit.\n\n${end}`
  const a = current.indexOf(start),
    b = current.indexOf(end)
  if (a < 0 !== b < 0) throw new Error('Malformed culture projection markers')
  output(
    culture,
    a < 0
      ? current.trimEnd() + '\n\n' + block + '\n'
      : current.slice(0, a) + block + current.slice(b + end.length),
  )
}
if (drift) process.exitCode = 1
