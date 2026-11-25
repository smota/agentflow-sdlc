#!/usr/bin/env node
// `agentflow-sdlc box gate` (design item W0-15): the week-0 gate. It runs on the author's machine
// against the real `sbx`, so it is not part of `validate:release`. No agent runs unattended until it
// passes. The drills run in a throwaway target directory, so the repository's own coordinator state
// is never touched. The result is written to `.agentflow/gates/week0.json`.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCoordinatorState } from '../lib/runtime/coordinator-state.mjs'
import { boxCheck } from './box-check.mjs'
import { coordinator } from './coordinator.mjs'
import { activeRunPath, guardedRun, sandboxConfigPath } from './guarded-run.mjs'

export const KILL_LIMIT_MS = 10_000
// A host the factory never allows; `sbx`'s balanced policy and the factory's own allowlist block it.
export const OFF_ALLOWLIST_URL = 'https://example.com/'

// The sandbox mapping from ADR 020, with the `shell` agent: the drills need no model login.
export const SHELL_SANDBOX = Object.freeze({
  startCommand: ['sbx', 'run', '--detach', '--name', '{name}', 'shell', '{workspace}'],
  command: ['sbx', 'exec', '{name}'],
  stopCommand: ['sbx', 'rm', '--force', '{name}'],
  envAllowlist: ['LOCALAPPDATA', 'APPDATA', 'ProgramData'],
})

// Runs inside the sandbox and prints one `key=value` per probe.
export const PROBE = [
  '[ -e "$HOME/.ssh" ] && echo ssh=present || echo ssh=absent',
  '[ -e "$HOME/.config/gh" ] && echo ghconfig=present || echo ghconfig=absent',
  `echo github=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user)`,
  `echo offlist=$(curl -s -o /dev/null -m 15 -w '%{http_code}' ${OFF_ALLOWLIST_URL})`,
].join('; ')

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 300_000,
    ...options,
  })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const reachable = (code) => /^[23]\d\d$/.test(code)

export function judgeProbe(stdout) {
  const value = (key) => new RegExp(`^${key}=(\\S*)`, 'm').exec(stdout)?.[1] ?? 'missing'
  const ssh = value('ssh')
  const gh = value('ghconfig')
  const github = value('github')
  const offlist = value('offlist')
  return [
    { id: 'no-ssh-keys', passed: ssh === 'absent', detail: `~/.ssh ${ssh}` },
    { id: 'no-gh-config', passed: gh === 'absent', detail: `~/.config/gh ${gh}` },
    {
      id: 'no-github-credential',
      passed: github !== 'missing' && github !== '200',
      detail: `GitHub API answered ${github} to the sandbox's token`,
    },
    {
      id: 'off-allowlist-blocked',
      passed: offlist !== 'missing' && !reachable(offlist),
      detail: `${OFF_ALLOWLIST_URL} answered ${offlist}`,
    },
  ]
}

function probeContainment(workspace, run) {
  const name = `af-gate-${randomUUID().slice(0, 8)}`
  const started = run('sbx', ['run', '--detach', '--name', name, 'shell', workspace])
  try {
    if (started.status !== 0) {
      return [
        { id: 'sandbox-start', passed: false, detail: started.stderr.trim() || 'sbx run failed' },
      ]
    }
    return judgeProbe(run('sbx', ['exec', name, 'sh', '-c', PROBE]).stdout)
  } finally {
    run('sbx', ['rm', '--force', name])
  }
}

function prepareTarget(sandbox) {
  const target = mkdtempSync(join(tmpdir(), 'week0-gate-'))
  mkdirSync(join(target, '.agentflow'), { recursive: true })
  writeFileSync(join(target, 'README.txt'), 'week-0 gate drill workspace\n')
  writeFileSync(sandboxConfigPath(target), JSON.stringify(sandbox))
  writeCoordinatorState(target, { state: 'running', reason: 'week-0 gate drill' })
  return target
}

async function killDrill(sandbox, { pollMs = 250, startWaitMs = 300_000 } = {}) {
  const target = prepareTarget(sandbox)
  try {
    const running = guardedRun({
      root: target,
      command: ['sh', '-c', 'sleep 600'],
      timeoutSeconds: 900,
      pollMs,
      stdio: 'ignore',
    })
    const until = Date.now() + startWaitMs
    while (Date.now() < until) {
      const active = existsSync(activeRunPath(target))
        ? JSON.parse(readFileSync(activeRunPath(target), 'utf8'))
        : null
      if (active?.pid) break
      await new Promise((done) => setTimeout(done, 200))
    }
    await new Promise((done) => setTimeout(done, 2000))
    const killedAt = Date.now()
    const kill = await coordinator('kill', { root: target, reason: 'week-0 gate drill' })
    const result = await running
    const elapsed = Date.now() - killedAt
    return {
      id: 'kill-under-10s',
      passed: result.status === 'killed' && kill.stopVerified && elapsed < KILL_LIMIT_MS,
      detail: `run ${result.status}, sandbox teardown ${result.teardown}, ${elapsed} ms from kill to stop`,
    }
  } finally {
    rmSync(target, { recursive: true, force: true })
  }
}

async function capDrill(sandbox) {
  const target = prepareTarget(sandbox)
  try {
    writeFileSync(
      join(target, '.agentflow', 'run-cap.json'),
      JSON.stringify({ limit: 0, windowHours: 24, runs: [] }),
    )
    const result = await guardedRun({ root: target, command: ['true'], stdio: 'ignore' })
    return {
      id: 'cap-refuses',
      passed: result.status === 'refused' && /run cap/.test(result.reason),
      detail: `run with a cap of 0: ${result.status} (${result.reason})`,
    }
  } finally {
    rmSync(target, { recursive: true, force: true })
  }
}

export async function week0Gate({
  root,
  controlRepo,
  run = defaultRun,
  sandbox = SHELL_SANDBOX,
  drillOptions = {},
  now = () => new Date(),
}) {
  const box = boxCheck({ controlRepo, run })
  const checks = [
    {
      id: 'box-check',
      passed: box.ok,
      detail: box.ok
        ? 'every week-0 setup act is done'
        : box.results
            .filter((r) => r.status === 'missing')
            .map((r) => r.act)
            .join('; '),
    },
  ]
  if (box.ok) {
    const workspace = mkdtempSync(join(tmpdir(), 'week0-probe-'))
    try {
      checks.push(...probeContainment(workspace, run))
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
    checks.push(await killDrill(sandbox, drillOptions))
    checks.push(await capDrill(sandbox))
  }
  const report = {
    gate: 'week0',
    at: now().toISOString(),
    sbx: box.results.find((r) => r.id === 'sbx-installed')?.detail ?? null,
    passed: checks.every((c) => c.passed),
    checks,
  }
  const out = join(root, '.agentflow', 'gates', 'week0.json')
  mkdirSync(join(root, '.agentflow', 'gates'), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export async function main(argv) {
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const root = resolve(flag('--target') ?? process.cwd())
  const controlRepo = flag('--control-repo') ?? process.env.AGENTFLOW_CONTROL_REPO ?? null
  const report = await week0Gate({ root, controlRepo })
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else {
    for (const c of report.checks) {
      process.stdout.write(`${c.passed ? 'pass' : 'FAIL'}  ${c.id.padEnd(22)} ${c.detail}\n`)
    }
    process.stdout.write(`week-0 gate: ${report.passed ? 'PASSED' : 'FAILED'}\n`)
  }
  return report.passed ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}
