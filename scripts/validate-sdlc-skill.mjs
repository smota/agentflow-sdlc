#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { finding, report } from '../lib/sdlc-state.mjs'
const args = process.argv.slice(2)
const json = args.includes('--json')
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
const findings = []
if (!path || !existsSync(path)) findings.push(finding('blocker', 'skill.path', 'missing --path'))
else {
  const text = readFileSync(path, 'utf8')
  if (!/^---\n[\s\S]*?\n---/m.test(text))
    findings.push(finding('high', 'skill.frontmatter', 'missing frontmatter'))
  if (!/name:/m.test(text)) findings.push(finding('high', 'skill.name', 'missing name'))
  if (!/description:/m.test(text))
    findings.push(finding('medium', 'skill.description', 'missing description'))
  if (/\.pi\/|\.claude\/|\.agy\/|\.codex\//.test(text) && !/generated|adapter/i.test(text))
    findings.push(
      finding('medium', 'skill.harness-source', 'skill appears to treat harness dir as source'),
    )
  if (!/sdlc|AgentFlow/i.test(text))
    findings.push(finding('low', 'skill.sdlc', 'skill does not mention AgentFlow SDLC'))
}
const result = report(findings, 'skill')
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-skill] ${path}\n`)
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
