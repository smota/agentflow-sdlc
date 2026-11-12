// `agentflow-sdlc bridge` (#582). The configured path runs against a fake exec; no test calls a
// real `rig` (the spawned CLI checks run only without a configured rig, where rig is never called).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { NO_RIG_MESSAGE } from '../../lib/bridge/config.mjs'
import { stableQueueId } from '../../lib/bridge/queue-id.mjs'
import { parseSourceRef } from '../../lib/core/source-ref.mjs'
import { createFilesystemWorkItem } from '../../lib/sources/filesystem-source.mjs'
import { createSourceAdapter } from '../../lib/sources/registry.mjs'
import { main } from '../bridge.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function project(bridge) {
  const dir = mkdtempSync(join(tmpdir(), 'agentflow-bridge-cli-'))
  dirs.push(dir)
  if (bridge !== undefined) {
    writeFileSync(
      join(dir, 'agent-workflow.config.json'),
      JSON.stringify({ adapters: { openrig: { bridge } } }),
    )
  }
  return dir
}

function sink() {
  let text = ''
  return { write: (chunk) => (text += chunk), text: () => text }
}

function fakeRig() {
  const calls = []
  const rows = new Map()
  const execFile = async (file, args) => {
    calls.push(args)
    const fail = (error, message) => {
      throw Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: JSON.stringify({ error, message }),
      })
    }
    if (args[0] === '--version') return { stdout: 'rig 0.7.6' }
    if (args[0] === 'queue' && args[1] === 'show') {
      if (!rows.has(args[2])) fail('not_found', `qitem ${args[2]} not found`)
      return { stdout: JSON.stringify(rows.get(args[2])) }
    }
    if (args[0] === 'queue' && args[1] === 'list')
      return { stdout: JSON.stringify({ items: [...rows.values()] }) }
    if (args[0] === 'queue' && args[1] === 'create') {
      const value = (flag) => args[args.indexOf(flag) + 1]
      const row = {
        qitemId: value('--id'),
        state: 'pending',
        destinationSession: value('--destination'),
        sourceSession: value('--source'),
        tags: value('--tags').split(','),
        body: readFileSync(value('--body-file'), 'utf8'),
      }
      rows.set(row.qitemId, row)
      return { stdout: JSON.stringify(row) }
    }
    if (args[0] === 'workflow' && args[1] === 'list')
      return { stdout: JSON.stringify({ instances: [] }) }
    fail('unexpected', args.join(' '))
  }
  return { execFile, calls, rows }
}

const SUBCOMMANDS = [
  ['intake', 'filesystem:local#a'],
  ['start', 'q-1'],
  ['evidence', 'filesystem:local#a', '--phase', '1'],
  ['reconcile'],
  ['release', 'filesystem:local#a'],
  ['escalate', 'filesystem:local#a', '--reason', 'x'],
  ['status'],
]

describe('bridge CLI without a rig (#582 AC6)', () => {
  it.each([
    ['no bridge section', undefined],
    ['an empty rig', { rig: '', source: { adapter: 'filesystem' } }],
    ['no delivery rigs', { rigs: { control: 'c', delivery: [] } }],
  ])('every subcommand exits 0 with %s, without a source adapter or rig', async (_, bridge) => {
    const dir = project(bridge)
    for (const argv of SUBCOMMANDS) {
      for (const json of [false, true]) {
        const stdout = sink()
        let touched = false
        const code = await main([...argv, '--target', dir, ...(json ? ['--json'] : [])], {
          execFile: async () => {
            touched = true
          },
          createSource: () => {
            touched = true
          },
          stdout,
          stderr: sink(),
        })
        expect(code).toBe(0)
        expect(touched).toBe(false)
        if (json) {
          expect(JSON.parse(stdout.text())).toMatchObject({ ok: true, status: 'no-rig' })
        } else {
          expect(stdout.text()).toBe(`${NO_RIG_MESSAGE}\n`)
        }
      }
    }
  })

  it('is routed from bin/cli.mjs and documents itself', () => {
    const dir = project()
    const run = (args) =>
      spawnSync(process.execPath, [join(repoRoot, 'bin/cli.mjs'), ...args], { encoding: 'utf8' })
    const status = run(['bridge', 'status', '--target', dir])
    expect(status.status).toBe(0)
    expect(status.stdout).toBe(`${NO_RIG_MESSAGE}\n`)
    const help = run(['bridge', '--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain(
      'agentflow-sdlc bridge <intake|start|evidence|reconcile|release|escalate|status>',
    )
    expect(run(['--help']).stdout).toMatch(/\|bridge[|>]/)
  })

  it('exits 2 for an unknown subcommand', async () => {
    expect(await main(['launch', '--target', project()], { stdout: sink(), stderr: sink() })).toBe(
      2,
    )
  })
})

describe('bridge CLI with a rig (#582)', () => {
  function configured(extra = {}) {
    const dir = project({
      rig: 'agentflow-p',
      source: { adapter: 'filesystem', root: 'work' },
      ...extra,
    })
    mkdirSync(join(dir, 'work'))
    return dir
  }

  it('intake queues a ready item through rig with the stable id', async () => {
    const dir = configured()
    const ref = createFilesystemWorkItem(join(dir, 'work'), {
      id: 'a',
      title: 't',
      labels: ['agentflow:ready'],
    })
    const rig = fakeRig()
    const stdout = sink()
    const code = await main(['intake', ref, '--target', dir, '--json'], {
      execFile: rig.execFile,
      stdout,
      stderr: sink(),
    })
    expect(code).toBe(0)
    const stableId = stableQueueId(parseSourceRef(ref))
    expect(JSON.parse(stdout.text())).toMatchObject({
      ok: true,
      status: 'queued',
      qitemId: stableId,
    })
    expect(rig.rows.get(stableId)).toMatchObject({ destinationSession: 'pm-analyst@agentflow-p' })
    const again = sink()
    expect(
      await main(['intake', ref, '--target', dir, '--json'], {
        execFile: rig.execFile,
        stdout: again,
        stderr: sink(),
      }),
    ).toBe(0)
    expect(JSON.parse(again.text()).status).toBe('already-queued')
    expect(rig.rows.size).toBe(1)
  })

  it('applies a pushed payload file only as a report and exits 0 when not ready', async () => {
    const dir = configured()
    const ref = createFilesystemWorkItem(join(dir, 'work'), { id: 'b', title: 't', labels: [] })
    writeFileSync(join(dir, 'payload.json'), JSON.stringify({ labels: ['agentflow:ready'] }))
    const rig = fakeRig()
    const stdout = sink()
    const code = await main(
      ['intake', ref, '--payload-file', 'payload.json', '--target', dir, '--json'],
      {
        execFile: rig.execFile,
        cwd: dir,
        stdout,
        stderr: sink(),
      },
    )
    expect(code).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'not-ready',
      pushedContentIgnored: ['labels'],
    })
    expect(rig.rows.size).toBe(0)
  })

  it('exits 1 when rig is missing, the config is invalid, or the predicate is unsupported', async () => {
    const enoent = async () => {
      throw Object.assign(new Error('spawn rig ENOENT'), { code: 'ENOENT' })
    }
    const out = sink()
    expect(
      await main(['reconcile', '--target', configured(), '--json'], {
        execFile: enoent,
        stdout: out,
        stderr: sink(),
      }),
    ).toBe(1)
    expect(JSON.parse(out.text())).toMatchObject({
      status: 'rig-unavailable',
      reason: 'rig not found on PATH',
    })

    const invalid = sink()
    expect(
      await main(['status', '--target', project({ rig: 'r' }), '--json'], {
        stdout: invalid,
        stderr: sink(),
      }),
    ).toBe(1)
    expect(JSON.parse(invalid.text()).problems).toContain(
      'adapters.openrig.bridge.source.adapter is required',
    )

    const dir = configured({ ready: { kind: 'status', in: ['ready'] } })
    const ref = createFilesystemWorkItem(join(dir, 'work'), {
      id: 'c',
      title: 't',
      status: 'ready',
    })
    const limited = (source, context) =>
      Object.assign(createSourceAdapter(source, context), {
        readyPredicateKinds: ['label', 'lifecycle'],
      })
    const unsupported = sink()
    const code = await main(['intake', ref, '--target', dir, '--json'], {
      execFile: fakeRig().execFile,
      stdout: unsupported,
      stderr: sink(),
      createSource: limited,
    })
    expect(JSON.parse(unsupported.text())).toMatchObject({
      ok: false,
      status: 'unsupported-predicate',
    })
    expect(code).toBe(1)
  })

  it('exits 2 when a required argument is missing', async () => {
    const stderr = sink()
    expect(
      await main(['intake', '--target', configured()], {
        execFile: fakeRig().execFile,
        stdout: sink(),
        stderr,
      }),
    ).toBe(2)
    expect(stderr.text()).toContain('missing <ref>')
  })

  it('several delivery rigs over a source without claim exit 1 quoting the source limits (#586 AC4)', async () => {
    const dir = configured({
      rig: undefined,
      rigs: { control: 'agentflow-p', delivery: ['agentflow-p-d1', 'agentflow-p-d2'] },
    })
    const noClaim = (source, context) => {
      const adapter = createSourceAdapter(source, context)
      return { ...adapter, capabilities: adapter.capabilities.filter((item) => item !== 'claim') }
    }
    const rig = fakeRig()
    const stdout = sink()
    const code = await main(['reconcile', '--target', dir, '--json'], {
      execFile: rig.execFile,
      stdout,
      stderr: sink(),
      createSource: noClaim,
    })
    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({
      ok: false,
      status: 'invalid-config',
      detail: { maxDeliveryRigs: 1, reasons: ['source adapter filesystem does not declare claim'] },
    })
    expect(rig.calls).toEqual([])
  })

  it('defers intake when open gates reach maxOpenGates (#586 AC3)', async () => {
    const dir = configured({ maxOpenGates: 1 })
    const work = join(dir, 'work')
    createFilesystemWorkItem(work, { id: 'gated', title: 't', labels: [] })
    const source = createSourceAdapter(
      { adapter: 'filesystem', root: 'work' },
      { targetDir: dir, env: {} },
    )
    const plan = await source.previewMutation({
      operation: 'add-comment',
      parameters: { id: 'gated', body: '<!-- agentflow-gate:waiting:g-1 -->' },
      actionBoundary: { effective: 'external-action' },
    })
    await source.flushReceipt(await source.applyMutation(plan, { confirm: plan.token }))
    const ref = createFilesystemWorkItem(work, { id: 'd', title: 't', labels: ['agentflow:ready'] })
    const rig = fakeRig()
    const stdout = sink()
    expect(
      await main(['intake', ref, '--target', dir, '--json'], {
        execFile: rig.execFile,
        stdout,
        stderr: sink(),
      }),
    ).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'deferred',
      reason: 'gate-capacity',
      openGates: 1,
      capacity: 1,
    })
    expect(rig.rows.size).toBe(0)
  })

  it('refuses gate resolution from a delivery seat session (decision 9)', async () => {
    const dir = configured()
    const ref = createFilesystemWorkItem(join(dir, 'work'), { id: 'e', title: 't' })
    const stdout = sink()
    const code = await main(['intake', ref, '--event', 'review-done', '--target', dir, '--json'], {
      env: { OPENRIG_SESSION_NAME: 'dev-build@agentflow-p' },
      execFile: fakeRig().execFile,
      stdout,
      stderr: sink(),
    })
    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({ ok: false, status: 'refused' })
  })

  it('reads the committed roster without the private overlay', async () => {
    const calls = []
    const dir = configured()
    const stdout = sink()
    expect(
      await main(['status', '--target', dir, '--json'], {
        execFile: fakeRig().execFile,
        stdout,
        stderr: sink(),
        loadRoster: (target, options) => (
          calls.push({ target, options }),
          { roster: { people: [] } }
        ),
      }),
    ).toBe(0)
    expect(calls).toEqual([{ target: dir, options: expect.objectContaining({ overlay: false }) }])
    expect(JSON.parse(stdout.text()).roster).toBe('team-roster')
  })

  it('release and reconcile need a named caller; --session names one (decision 9)', async () => {
    const dir = configured()
    const ref = createFilesystemWorkItem(join(dir, 'work'), { id: 'r', title: 't' })
    const unnamed = sink()
    expect(
      await main(['release', ref, '--target', dir, '--json'], {
        env: {},
        execFile: fakeRig().execFile,
        stdout: unnamed,
        stderr: sink(),
      }),
    ).toBe(1)
    expect(JSON.parse(unnamed.text())).toMatchObject({ status: 'refused' })
    const named = sink()
    expect(
      await main(['release', ref, '--session', 'human@agentflow-p', '--target', dir, '--json'], {
        env: {},
        execFile: fakeRig().execFile,
        stdout: named,
        stderr: sink(),
      }),
    ).toBe(0)
    expect(JSON.parse(named.text())).toMatchObject({ ok: true, status: 'free', holder: null })
    const reconciled = sink()
    expect(
      await main(['reconcile', '--target', dir, '--json'], {
        env: { OPENRIG_SESSION_NAME: 'human@agentflow-p' },
        execFile: fakeRig().execFile,
        stdout: reconciled,
        stderr: sink(),
      }),
    ).toBe(0)
    expect(JSON.parse(reconciled.text()).status).toBe('reconciled')
  })

  it('status reports the source limits and rig availability', async () => {
    const stdout = sink()
    expect(
      await main(['status', '--target', configured(), '--json'], {
        execFile: fakeRig().execFile,
        stdout,
        stderr: sink(),
      }),
    ).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'configured',
      source: 'filesystem',
      limits: { maxDeliveryRigs: null },
      rigs: { control: 'agentflow-p', delivery: ['agentflow-p'] },
      queue: { ok: true },
    })
  })
})
