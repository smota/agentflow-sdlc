import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { judgeProbe, week0Gate } from '../week0-gate.mjs'

const CLEAN_PROBE = 'ssh=absent\nghconfig=absent\ngithub=401\nofflist=403\n'

// A fake runner for `sbx`, `gh` and `powercfg`. `probe` is what the sandbox probe prints.
function fakeRun({ probe = CLEAN_PROBE, signedIn = true } = {}) {
  return (command, args) => {
    const key = [command, ...args].join(' ')
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' })
    if (key === 'sbx version') return ok('sbx version v0.54.1')
    if (key.startsWith('sbx diagnose')) {
      return ok(
        [
          '✓ Daemon — healthy',
          `${signedIn ? '✓' : '✗'} Authentication`,
          '✓ Global network policy — initialized',
        ].join('\n'),
      )
    }
    if (key === 'sbx secret ls') return ok('No secrets found\n')
    if (key.startsWith('gh api repos/me/control --jq')) return ok('true\n')
    if (key.startsWith('gh api repos/me/control/contents')) return ok('file\n')
    if (command === 'powercfg') return ok('Current AC Power Setting Index: 0x00000000')
    if (key.startsWith('sbx run') || key.startsWith('sbx rm')) return ok()
    if (key.startsWith('sbx exec')) return ok(probe)
    return { status: 1, stdout: '', stderr: `unexpected ${key}` }
  }
}

// A fake sandbox for the drills: the agent command runs directly in a node child.
const FAKE_SANDBOX_SCRIPT = `
const [, , step, ...rest] = process.argv
if (step === 'exec') {
  const cmd = rest.slice(1)
  if (cmd[0] === 'sh' && /sleep/.test(cmd[2] ?? '')) setTimeout(() => {}, 600000)
}
`

let root
let sandbox
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'week0-gate-test-'))
  const script = join(root, 'fake-sbx.cjs')
  writeFileSync(script, FAKE_SANDBOX_SCRIPT)
  sandbox = {
    startCommand: [process.execPath, script, 'start', '{name}'],
    command: [process.execPath, script, 'exec', '{name}'],
    stopCommand: [process.execPath, script, 'stop', '{name}'],
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('week-0 gate', () => {
  it('passes a clean probe and fails each kind of escape', () => {
    expect(judgeProbe(CLEAN_PROBE).every((c) => c.passed)).toBe(true)
    const failed = (probe) =>
      judgeProbe(probe)
        .filter((c) => !c.passed)
        .map((c) => c.id)
    expect(failed(CLEAN_PROBE.replace('ssh=absent', 'ssh=present'))).toEqual(['no-ssh-keys'])
    expect(failed(CLEAN_PROBE.replace('github=401', 'github=200'))).toEqual([
      'no-github-credential',
    ])
    expect(failed(CLEAN_PROBE.replace('offlist=403', 'offlist=200'))).toEqual([
      'off-allowlist-blocked',
    ])
    expect(failed('')).toHaveLength(4)
  })

  it('passes with every check and writes the result', async () => {
    const report = await week0Gate({
      root,
      controlRepo: 'me/control',
      run: fakeRun(),
      sandbox,
      drillOptions: { pollMs: 100, startWaitMs: 5000 },
    })
    expect(report.checks.map((c) => [c.id, c.passed])).toEqual([
      ['box-check', true],
      ['no-ssh-keys', true],
      ['no-gh-config', true],
      ['no-github-credential', true],
      ['off-allowlist-blocked', true],
      ['kill-under-10s', true],
      ['cap-refuses', true],
    ])
    expect(report.passed).toBe(true)
    const saved = JSON.parse(readFileSync(join(root, '.agentflow', 'gates', 'week0.json'), 'utf8'))
    expect(saved).toMatchObject({ gate: 'week0', passed: true, sbx: '0.54.1' })
  }, 30000)

  it('fails without running the drills when a setup act is missing', async () => {
    const report = await week0Gate({
      root,
      controlRepo: 'me/control',
      run: fakeRun({ signedIn: false }),
      sandbox,
    })
    expect(report.passed).toBe(false)
    expect(report.checks.map((c) => c.id)).toEqual(['box-check'])
    expect(report.checks[0].detail).toMatch(/sbx login/)
  })
})
