#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadSdlcConfig,
  validateSdlcConfigShape,
  validateNoForbiddenEvidenceText,
  finding,
  report,
} from '../lib/sdlc-state.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : process.cwd()
const findings = []

const config = loadSdlcConfig(target)
findings.push(...validateSdlcConfigShape(config).findings)

for (const dir of ['.pi', '.claude', '.agy', '.codex']) {
  if (existsSync(join(target, dir))) {
    findings.push(
      finding(
        'info',
        'harness.generated-surface',
        `${dir} present; ensure no canonical product source is stored there`,
        { source: dir },
      ),
    )
  }
}

for (const skill of ['sdlc-definition', 'sdlc-migration', 'sdlc-audit']) {
  const skillPath = join(target, 'skills', skill, 'SKILL.md')
  if (!existsSync(skillPath))
    findings.push(finding('high', 'skill.missing', `missing ${skill} skill`, { source: skillPath }))
}

for (const path of [
  'docs/sdlc-definition.md',
  'schemas/sdlc-config.schema.json',
  'docs/evidence-contracts.md',
  'docs/lifecycle-boundaries.md',
  'schemas/artifact-ref.schema.json',
  'schemas/transition-envelope.schema.json',
]) {
  if (!existsSync(join(target, path)))
    findings.push(finding('blocker', 'sdlc.required-file', `missing ${path}`, { source: path }))
}
if (
  !existsSync(join(target, 'sdlc.config.json')) &&
  !existsSync(join(target, 'defaults/sdlc.config.json'))
) {
  findings.push(
    finding(
      'blocker',
      'sdlc.required-file',
      'missing sdlc.config.json or defaults/sdlc.config.json',
      {
        source: 'sdlc.config.json',
      },
    ),
  )
}

for (const path of ['docs/sdlc-definition.md', 'docs/cockpit-concepts-and-rules.md']) {
  const full = join(target, path)
  if (existsSync(full))
    findings.push(
      ...validateNoForbiddenEvidenceText(readFileSync(full, 'utf8')).findings.map((item) => ({
        ...item,
        source: path,
      })),
    )
}

const result = report(findings, 'full')
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write('[sdlc-audit]\n')
  for (const item of result.findings)
    process.stdout.write(
      `  ${item.severity.toUpperCase()} ${item.code}: ${item.message}${item.source ? ` (${item.source})` : ''}\n`,
    )
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
