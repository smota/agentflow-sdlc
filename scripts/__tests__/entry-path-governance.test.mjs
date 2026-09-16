import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENTRY_DOCUMENT, ENTRY_PATH_MARKER, extractMarkedCommandBlock } from '../validate-docs.mjs'

// W6c / test 1 — the test that matters. The orchestrator ran the previously documented three
// commands on a fresh repository and found they left no run, no frozen contract and no recorded
// evidence: an installed-and-committed repository, which is almost exactly where the OLD
// get-started.md ended. That passed the old doc-lint test (it only checked a command block existed)
// while failing the actual promise of the page. This test extracts the commands from the LIVE
// document and executes them for real, so it fails the moment the document and reality drift apart
// again — whether because the document changes or because the commands it names stop working.

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const cli = join(repoRoot, 'bin/cli.mjs')
const placeholder = '/path/to/your-project'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// The document's commands are written the way a human runs them: `node ...`, `git ...`, joined with
// `&&` on the commit line. Running them "for real" means parsing exactly that, not a paraphrase of
// it — `node` is resolved to this process's own executable (what "install Node.js" means on the
// machine actually running this test) and everything else is taken literally from the document.
function tokenize(command) {
  const tokens = []
  const re = /"([^"]*)"|(\S+)/g
  let match
  while ((match = re.exec(command))) tokens.push(match[1] ?? match[2])
  return tokens
}

function runDocumentedCommand(line, { cwd, target }) {
  const substituted = line.replaceAll(placeholder, target)
  for (const part of substituted.split(/\s&&\s/)) {
    const [bin, ...args] = tokenize(part)
    const executable = bin === 'node' ? process.execPath : bin
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 60000 })
    // `run verify`'s starter check ships a placeholder assertion (D2: never invent a real one), so
    // a genuinely honest run of it can legitimately observe a failing check — exit 3, "evidence
    // missing/blocked" in this CLI's own convention, not a crash. What test 1 requires is that an
    // observation was recorded, which the status assertions below check directly; every other step
    // must still exit clean.
    const acceptable = result.status === 0 || (args.includes('verify') && result.status === 3)
    if (!acceptable) {
      throw new Error(
        `entry-path command failed (exit ${result.status}): ${part}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      )
    }
  }
}

function tempAdopterRepo() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-entry-path-'))
  roots.push(root)
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'adopter@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'AgentFlow Adopter'], { cwd: root })
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/greeter.js'), 'module.exports = (name) => `Hello, ${name}!`\n')
  writeFileSync(
    join(root, 'src/greeter.test.js'),
    "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst greet = require('./greeter.js')\ntest('greets by name', () => assert.equal(greet('AgentFlow'), 'Hello, AgentFlow!'))\n",
  )
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'adopter-demo', version: '1.0.0', scripts: { test: 'node --test' } }),
  )
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: root })
  return root
}

describe('the entry document reaches real governance end to end (W6c, test 1)', () => {
  it('executing the documented commands on a fresh repository produces a run, a frozen contract, and a recorded observation', () => {
    const target = tempAdopterRepo()
    const entryText = readFileSync(resolve(repoRoot, ENTRY_DOCUMENT), 'utf8')
    const commands = extractMarkedCommandBlock(entryText, ENTRY_PATH_MARKER)
    expect(commands, 'the entry document must mark a runnable command block').not.toBeNull()

    for (const line of commands) runDocumentedCommand(line, { cwd: repoRoot, target })

    // A run exists, durably, on disk.
    expect(existsSync(join(target, '.agent-runs/runs/demo/events.json'))).toBe(true)

    const status = spawnSync(
      process.execPath,
      [cli, 'run', 'status', 'demo', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(status.status).toBe(0)
    const result = JSON.parse(status.stdout).result
    expect(result.status).not.toBe('absent')

    // Its contract is frozen: the run's evidence reflects the one seeded criterion, not an empty
    // contract.
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].criterionId).toBe('starter')

    // A verification observation was recorded against it — collected, not asserted. Whether the
    // starter check's placeholder assertion happened to hold is irrelevant here; what test 1
    // requires is that real evidence exists, which "missing" would mean it does not.
    expect(result.evidence[0].observationDigest).not.toBeNull()
    expect(result.evidence[0].observedOutcome).not.toBe('missing')

    // The adoption was committed, so that decision lives in the repository rather than a chat
    // transcript. The run record was NOT: the AGENTS.md this path installs says .agent-runs/ is local
    // scratch that must not be committed, and the entry path must not contradict the policy it ships.
    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: target, encoding: 'utf8' })
    expect(log).toContain('Adopt AgentFlow SDLC')
    const tracked = execFileSync('git', ['show', '--stat', '--oneline', 'HEAD'], {
      cwd: target,
      encoding: 'utf8',
    })
    expect(tracked).toContain('agent-framework-lock.json')
    expect(tracked).toContain('AGENTS.md')
    expect(tracked).not.toContain('.agent-runs')
  })
})
