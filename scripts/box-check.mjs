#!/usr/bin/env node
// `agentflow-sdlc box check` (design item W0-12): a read-only check of the setup acts the factory
// needs. Each check names the act that is missing. Acts that a later milestone first needs are
// reported as `later` and do not fail the week-0 check. It needs local credentials (`gh`, `sbx`),
// so it is not part of `validate:release`.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `sbx` 0.51.0 fixed a high-severity file-copy escape (design, Known risks: Suppliers).
export const MINIMUM_SBX_VERSION = '0.51.0'

// Acts that later milestones need first. Listed so the checker names them without failing on them.
export const LATER_ACTS = Object.freeze([
  { id: 'npm-trusted-publishing', act: 'Configure npm trusted publishing', milestone: 'M0' },
  {
    id: 'github-apps',
    act: 'Create the builder, reviewer and steward GitHub Apps',
    milestone: 'M1',
  },
  {
    id: 'signing-key',
    act: 'Set up a commit-signing key and add its fingerprint to trust-policy.json',
    milestone: 'M1',
  },
  { id: 'holdouts-repo', act: 'Create the private holdouts repository', milestone: 'M2' },
  {
    id: 'code-owner-ruleset',
    act: 'Require a code-owner review on factory-core paths',
    milestone: 'M2',
  },
  {
    id: 'merge-queue',
    act: 'Enable the merge queue and sign the first delegation',
    milestone: 'M2b',
  },
  { id: 'tag-ruleset', act: 'Limit the steward App to v*-next.* tags', milestone: 'L3' },
])

function defaultRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  }
}

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]
  return true
}

const ok = (id, detail) => ({ id, status: 'ok', detail })
const missing = (id, act, detail = null) => ({ id, status: 'missing', act, detail })

export function boxCheck({
  controlRepo = null,
  platform = process.platform,
  run = defaultRun,
} = {}) {
  const results = []

  const version = run('sbx', ['version'])
  const found = /v(\d+\.\d+\.\d+)/.exec(version.stdout)?.[1]
  if (version.status !== 0 || !found) {
    results.push(missing('sbx-installed', 'Install sbx (winget install Docker.sbx)'))
  } else if (!newer(found, MINIMUM_SBX_VERSION)) {
    results.push(missing('sbx-installed', `Upgrade sbx to ${MINIMUM_SBX_VERSION} or later`, found))
  } else {
    results.push(ok('sbx-installed', found))
  }

  const diagnose = run('sbx', ['diagnose', '--no-input']).stdout
  const line = (name) => diagnose.split('\n').find((l) => l.includes(name)) ?? ''
  const passed = (name) => line(name).includes('✓')
  results.push(
    passed('Daemon')
      ? ok('sbx-daemon', 'healthy')
      : missing('sbx-daemon', 'Start the sbx daemon (sbx daemon start)'),
    passed('Authentication')
      ? ok('sbx-signed-in', 'signed in')
      : missing('sbx-signed-in', 'Sign sbx in to Docker (sbx login), in your own terminal'),
    passed('Global network policy')
      ? ok('sbx-network-policy', 'initialized')
      : missing('sbx-network-policy', 'Initialize the sbx global network policy (after sbx login)'),
  )

  if (!controlRepo) {
    results.push(
      missing('control-repo', 'Name the control repository with --control-repo <owner/name>'),
    )
  } else {
    const repo = run('gh', ['api', `repos/${controlRepo}`, '--jq', '.private'])
    if (repo.status !== 0) {
      results.push(missing('control-repo', `Create the private control repository ${controlRepo}`))
    } else if (repo.stdout.trim() !== 'true') {
      results.push(missing('control-repo', `Make ${controlRepo} private`))
    } else {
      results.push(ok('control-repo', `${controlRepo} (private)`))
      const absent = ['path-classes.json', 'pause.json', 'trust-policy.json'].filter(
        (file) =>
          run('gh', ['api', `repos/${controlRepo}/contents/${file}`, '--jq', '.name']).status !== 0,
      )
      results.push(
        absent.length
          ? missing('control-layout', `Seed the control repository layout: ${absent.join(', ')}`)
          : ok('control-layout', 'path-classes.json, pause.json, trust-policy.json'),
      )
    }
  }

  if (platform === 'win32') {
    const sleep = run('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE']).stdout
    const ac = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(sleep)?.[1]
    results.push(
      ac !== undefined && Number.parseInt(ac, 16) === 0
        ? ok('host-sleep', 'sleep on AC power is off')
        : missing(
            'host-sleep',
            'Turn off sleep on AC power (powercfg /change standby-timeout-ac 0)',
          ),
    )
  } else {
    results.push({ id: 'host-sleep', status: 'not-applicable', detail: platform })
  }

  for (const later of LATER_ACTS) results.push({ ...later, status: 'later' })
  return { ok: results.every((r) => r.status !== 'missing'), results }
}

export function main(argv, { run } = {}) {
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const [verb] = argv.filter((arg, i) => !arg.startsWith('--') && !argv[i - 1]?.startsWith('--'))
  if (verb !== 'check') {
    process.stderr.write('Usage: agentflow-sdlc box check [--control-repo <owner/name>] [--json]\n')
    return 2
  }
  const controlRepo = flag('--control-repo') ?? process.env.AGENTFLOW_CONTROL_REPO ?? null
  const report = boxCheck({ controlRepo, run })
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    for (const r of report.results) {
      const text = r.status === 'missing' || r.status === 'later' ? r.act : r.detail
      const when = r.status === 'later' ? ` (needed by ${r.milestone})` : ''
      process.stdout.write(`${r.status.padEnd(14)} ${r.id.padEnd(22)} ${text ?? ''}${when}\n`)
    }
  }
  return report.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
