#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { finding, report } from '../lib/sdlc-state.mjs'
const args = process.argv.slice(2)
const json = args.includes('--json')
const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : ''
const findings = []
if (!path || !existsSync(path)) findings.push(finding('blocker', 'agent.path', 'missing --path'))
else {
  const text = readFileSync(path, 'utf8')
  if (!/sdlc|AgentFlow|AGENTS\.md|agent-workflow/i.test(text))
    findings.push(
      finding('medium', 'agent.sdlc-awareness', 'agent does not reference AgentFlow SDLC rules'),
    )
  if (/\.pi\/|\.claude\/|\.agy\/|\.codex\//.test(text) && !/generated|adapter/i.test(text))
    findings.push(
      finding('medium', 'agent.harness-source', 'agent appears to treat harness dir as source'),
    )
}
const result = report(findings, 'agent')
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
else {
  process.stdout.write(`[validate-sdlc-agent] ${path}\n`)
  for (const item of result.findings)
    process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
  process.stdout.write(`Result: ${result.ok ? 'READY' : 'FAILED'}\n`)
}
process.exit(result.ok ? 0 : 1)
