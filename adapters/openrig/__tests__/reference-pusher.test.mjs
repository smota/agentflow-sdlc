import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { BRIDGE_USAGE, parseBridgeArgs } from '../../../scripts/bridge.mjs'

const path = resolve(import.meta.dirname, '../examples/github-rig-push.yml')
const text = readFileSync(path, 'utf8')
const workflow = parse(text)
const job = workflow.jobs.push

// Everything the job may read from GitHub: identifiers and the event kind, never content.
const ALLOWED = new Set([
  'github.repository',
  'github.event.issue.number',
  'github.event.pull_request.number',
  'github.event_name',
  'github.event.action',
  'github.event.pull_request.merged',
  'vars.AGENTFLOW_TARGET',
])

function expressions(source) {
  return [...source.matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map((match) => match[1])
}

describe('reference pusher (#587)', () => {
  it('reads only reference and event fields from the event', () => {
    const used = new Set()
    for (const expression of expressions(text.replace(/^\s*#.*$/gm, ''))) {
      for (const part of expression.split('||')) used.add(part.trim())
    }
    expect([...used].filter((name) => !ALLOWED.has(name))).toEqual([])
    expect(used.size).toBeGreaterThan(0)
  })

  it('never reads issue or pull request content', () => {
    const code = text.replace(/^\s*#.*$/gm, '')
    for (const field of ['body', 'title', 'comment', 'labels', 'head_commit', 'message']) {
      expect(code).not.toMatch(new RegExp(`github\\.event\\.[\\w.]*${field}`))
    }
    expect(code).not.toContain('--payload-file')
  })

  it('uses no secrets and no token permission', () => {
    expect(text).not.toMatch(/secrets\./)
    expect(workflow.permissions).toEqual({})
    expect(JSON.stringify(job)).not.toMatch(/GITHUB_TOKEN/)
  })

  it('cannot run a workflow definition taken from a pull request', () => {
    const triggers = Object.keys(workflow.on)
    expect(triggers).not.toContain('pull_request')
    expect(triggers).not.toContain('pull_request_review')
    expect(triggers).toContain('pull_request_target')
    expect(JSON.stringify(workflow)).not.toMatch(/actions\/checkout/)
    expect(job.steps.every((step) => !step.uses)).toBe(true)
    expect(workflow.permissions).toEqual({})
  })

  it('runs on a self-hosted runner, since a hosted one cannot reach a private rig', () => {
    expect(job['runs-on']).toContain('self-hosted')
  })

  it('calls a bridge command that exists, with an event the bridge accepts', () => {
    const run = job.steps.map((step) => step.run).join('\n')
    const line = run.split('\n').find((entry) => entry.includes('agentflow-sdlc bridge'))
    expect(line).toBeDefined()
    const argv = line.trim().split(/\s+/).slice(2)
    const parsed = parseBridgeArgs(argv.map((arg) => arg.replace(/^"|"$/g, '')))
    expect(parsed.subcommand).toBe('intake')
    expect(BRIDGE_USAGE).toContain('bridge intake <ref>')
    expect(parsed.args[0]).toBe('github:${REPO}#${NUMBER}')
    expect(parsed.flags.event).toBe('$kind')
    // Gate-resolving events need a named caller outside the delivery rigs (decision 9).
    expect(parsed.flags.session).toBe('ci@external')
    const kinds = [...run.matchAll(/kind=([a-z-]+)/g)].map((match) => match[1])
    expect(new Set(kinds)).toEqual(new Set(['ready', 'closed', 'merged']))
    for (const kind of kinds) expect(BRIDGE_USAGE).toContain(kind)
  })
})
