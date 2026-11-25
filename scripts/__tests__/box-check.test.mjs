import { describe, expect, it } from 'vitest'
import { LATER_ACTS, boxCheck } from '../box-check.mjs'

const HEALTHY_DIAGNOSE = [
  '  ✓ Daemon — healthy',
  '  ✓ Authentication — signed in',
  '  ✓ Global network policy — initialized',
].join('\n')

// A fake command runner: `answers` maps "command arg0 arg1..." prefixes to results.
function fakeRun(answers) {
  return (command, args) => {
    const key = [command, ...args].join(' ')
    const match = Object.keys(answers).find((prefix) => key.startsWith(prefix))
    return match
      ? { status: 0, stderr: '', ...answers[match] }
      : { status: 1, stdout: '', stderr: 'not found' }
  }
}

const allGood = {
  'sbx version': { stdout: 'sbx version v0.54.1 abc' },
  'sbx diagnose': { stdout: HEALTHY_DIAGNOSE },
  'sbx secret ls': {
    stdout: 'SCOPE  TYPE  NAME  SECRET\n(global)  service  anthropic  (oauth configured)\n',
  },
  'sbx ls': {
    stdout:
      'SANDBOX  AGENT  STATUS  PORTS  WORKSPACE  CREATED\naf-1  claude  running    C:\\Users\\me\\work\\repo   2m\n',
  },
  'gh api repos/me/control --jq': { stdout: 'true\n' },
  'gh api repos/me/control/contents': { stdout: 'file\n' },
  powercfg: { stdout: 'Current AC Power Setting Index: 0x00000000' },
}

const byId = (report, id) => report.results.find((r) => r.id === id)

describe('box check', () => {
  it('passes when every week-0 act is done, and lists later acts without failing', () => {
    const report = boxCheck({ controlRepo: 'me/control', platform: 'win32', run: fakeRun(allGood) })
    expect(report.ok).toBe(true)
    expect(byId(report, 'sbx-installed')).toMatchObject({ status: 'ok', detail: '0.54.1' })
    expect(report.results.filter((r) => r.status === 'later')).toHaveLength(LATER_ACTS.length)
  })

  it('names the missing act when sbx is not signed in', () => {
    const run = fakeRun({
      ...allGood,
      'sbx diagnose': { stdout: '  ✓ Daemon — healthy\n  ✗ Authentication — not signed in' },
    })
    const report = boxCheck({ controlRepo: 'me/control', platform: 'win32', run })
    expect(report.ok).toBe(false)
    expect(byId(report, 'sbx-signed-in')).toMatchObject({
      status: 'missing',
      act: expect.stringMatching(/sbx login/),
    })
  })

  it('refuses an sbx older than the minimum version', () => {
    const run = fakeRun({ ...allGood, 'sbx version': { stdout: 'sbx version v0.50.9' } })
    expect(
      byId(boxCheck({ controlRepo: 'me/control', platform: 'win32', run }), 'sbx-installed').status,
    ).toBe('missing')
  })

  it('fails a public or missing control repository, and a missing layout file', () => {
    const publicRepo = fakeRun({ ...allGood, 'gh api repos/me/control --jq': { stdout: 'false' } })
    expect(
      byId(
        boxCheck({ controlRepo: 'me/control', platform: 'win32', run: publicRepo }),
        'control-repo',
      ).act,
    ).toMatch(/private/)
    expect(
      byId(
        boxCheck({ controlRepo: null, platform: 'win32', run: fakeRun(allGood) }),
        'control-repo',
      ).status,
    ).toBe('missing')
    const noLayout = fakeRun({
      ...allGood,
      'gh api repos/me/control/contents': { status: 1, stdout: '' },
    })
    expect(
      byId(
        boxCheck({ controlRepo: 'me/control', platform: 'win32', run: noLayout }),
        'control-layout',
      ).status,
    ).toBe('missing')
  })

  it('fails when a sandbox mounts the home folder, but not one under it', () => {
    const home = 'C:\\Users\\me'
    const homeMount = fakeRun({
      ...allGood,
      'sbx ls': {
        stdout:
          'SANDBOX  AGENT  STATUS  PORTS  WORKSPACE  CREATED\nclaude-me  claude  stopped    C:\\Users\\me   4m\n',
      },
    })
    expect(
      byId(
        boxCheck({ controlRepo: 'me/control', platform: 'win32', run: homeMount, home }),
        'sbx-no-home-mount',
      ),
    ).toMatchObject({ status: 'missing', act: expect.stringMatching(/C:\\Users\\me/) })
    expect(
      byId(
        boxCheck({ controlRepo: 'me/control', platform: 'win32', run: fakeRun(allGood), home }),
        'sbx-no-home-mount',
      ).status,
    ).toBe('ok')
  })

  it('fails when a github secret is stored in sbx', () => {
    const run = fakeRun({
      ...allGood,
      'sbx secret ls': { stdout: '(global)  service  github  (token configured)\n' },
    })
    expect(
      byId(boxCheck({ controlRepo: 'me/control', platform: 'win32', run }), 'sbx-no-github-secret')
        .status,
    ).toBe('missing')
  })

  it('fails when the host sleeps on AC power, and skips the check off Windows', () => {
    const sleepy = fakeRun({
      ...allGood,
      powercfg: { stdout: 'Current AC Power Setting Index: 0x000005dc' },
    })
    expect(
      byId(boxCheck({ controlRepo: 'me/control', platform: 'win32', run: sleepy }), 'host-sleep')
        .status,
    ).toBe('missing')
    expect(
      byId(
        boxCheck({ controlRepo: 'me/control', platform: 'linux', run: fakeRun(allGood) }),
        'host-sleep',
      ).status,
    ).toBe('not-applicable')
  })
})
