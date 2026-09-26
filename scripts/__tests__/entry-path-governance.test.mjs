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
import { dirname, join, resolve } from 'node:path'
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
const npmCli = [
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].find(existsSync)

function installPackage() {
  if (!npmCli) throw new Error('Unable to locate npm bundled with Node')
  const prefix = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-installed-entry-'))
  roots.push(prefix)
  const packed = JSON.parse(
    execFileSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', prefix], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  )
  const packEntry = Array.isArray(packed) ? packed[0] : Object.values(packed)[0]
  execFileSync(
    process.execPath,
    [
      npmCli,
      'install',
      '--prefix',
      prefix,
      join(prefix, packEntry.filename),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { encoding: 'utf8' },
  )
  const installedRoot = join(prefix, 'node_modules/agentflow-sdlc')
  const catalog = JSON.parse(
    readFileSync(join(installedRoot, 'manifests/skill-catalog.json'), 'utf8'),
  )
  expect(catalog.skills.map((skill) => skill.role).sort()).toEqual([
    'auditor',
    'collaborator',
    'designer',
    'migrator',
    'orchestrator',
    'scanner',
  ])
  for (const skill of catalog.skills) {
    const source = readFileSync(join(installedRoot, skill.source, 'SKILL.md'), 'utf8')
    expect(source).toMatch(new RegExp(`^name: ${skill.qualifiedName}$`, 'm'))
    expect(source).toContain(skill.qualifiedName)
  }
  return prefix
}
const placeholder = '/path/to/your-project'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Execute the documented installed command via npm exec, outside the source checkout.
function tokenize(command) {
  const tokens = []
  const re = /"([^"]*)"|(\S+)/g
  let match
  while ((match = re.exec(command))) tokens.push(match[1] ?? match[2])
  return tokens
}

function runDocumentedCommand(line, { cwd, target, prefix }) {
  for (const part of line.split(/\s&&\s/)) {
    const [bin, ...tokens] = tokenize(part)
    let args = tokens.map((token) => token.replaceAll(placeholder, target))
    const executable = bin === 'agentflow-sdlc' ? process.execPath : bin
    if (bin === 'agentflow-sdlc')
      args = [npmCli, 'exec', '--offline', '--prefix', prefix, '--', bin, ...args]
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 60000 })
    // W8e / D1 — the fixture's test script genuinely passes and prints no JUnit output (`node
    // --test`'s default reporter is TAP, not JUnit). `init` now seeds the starter check with the
    // exit-code format (D1), so an honest `run verify` against a passing test command exits 0, not
    // 3. Tolerating exit 3 here used to paper over the real defect this release fixes: a passing
    // test producing a failing first run. Every documented step must exit clean.
    const acceptable = result.status === 0
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
    const prefix = installPackage()
    const cli = join(prefix, 'node_modules/agentflow-sdlc/bin/cli.mjs')
    const target = tempAdopterRepo()
    const entryText = readFileSync(resolve(repoRoot, ENTRY_DOCUMENT), 'utf8')
    const commands = extractMarkedCommandBlock(entryText, ENTRY_PATH_MARKER)
    expect(commands, 'the entry document must mark a runnable command block').not.toBeNull()

    for (const line of commands) runDocumentedCommand(line, { cwd: target, target, prefix })

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

    // A verification observation was recorded against it — collected, not asserted. W8e / D1: the
    // fixture's test script genuinely passes and the starter check now uses the exit-code format
    // (a single assertion that passes exactly when the process exits 0), so an honest run records a
    // PASSING observation, not merely a non-missing one.
    expect(result.evidence[0].observationDigest).not.toBeNull()
    expect(result.evidence[0].observedOutcome).toBe('pass')

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
    writeFileSync(join(target, 'src/greeter.test.js'), 'process.exit(1)\n')
    for (const action of ['start', 'freeze']) {
      const failedRun = spawnSync(
        process.execPath,
        [
          cli,
          'run',
          action,
          'failing',
          '--goal',
          'Failing starter fixture',
          '--execute',
          '--target',
          target,
        ],
        { cwd: target, encoding: 'utf8' },
      )
      expect(failedRun.status, failedRun.stdout + failedRun.stderr).toBe(0)
    }
    const failedCheck = spawnSync(
      process.execPath,
      [
        cli,
        'run',
        'verify',
        'failing',
        '--check',
        'starter',
        '--execute',
        '--target',
        target,
        '--json',
      ],
      { cwd: target, encoding: 'utf8' },
    )
    expect(failedCheck.status).not.toBe(0)
    const failedStatus = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, 'run', 'status', 'failing', '--target', target, '--json'],
        { cwd: target, encoding: 'utf8' },
      ),
    ).result
    expect(failedStatus.evidence[0].observedOutcome).toBe('fail')
    expect(failedStatus.evidence[0].observationDigest).not.toBeNull()
  }, 120000)
})
