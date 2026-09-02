#!/usr/bin/env node
import { resolve } from 'node:path'
import { applyAuthorityMigration, planAuthorityMigration } from '../lib/config/authority.mjs'

const args = process.argv.slice(2)
const command = args.find((item) => !item.startsWith('--')) ?? 'plan'
const flag = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}
const target = resolve(flag('--target') ?? process.cwd())
const plan = planAuthorityMigration(target)

if (command === 'plan') {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  process.exit(0)
}
if (command === 'apply') {
  const result = applyAuthorityMigration(target, plan, { confirm: flag('--confirm') })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(0)
}
process.stderr.write(
  'Usage: agentflow-sdlc sdlc migrate-authority <plan|apply --confirm <plan-token>> [--target <dir>]\n',
)
process.exit(2)
