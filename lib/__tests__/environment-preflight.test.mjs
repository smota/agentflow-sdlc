import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { inspectEnvironment, probeEnvironment, validateEnvironment } from '../environment.mjs'
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(probes) {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-preflight-'))
  roots.push(root)
  writeFileSync(join(root, 'agent-workflow.config.json'), JSON.stringify({ delivery: { probes } }))
  return root
}
describe('context-aware environment preflight', () => {
  it('invalidates capability results when executable resolution changes', async () => {
    const root = fixture([
      {
        id: 'agent',
        executable: 'agent',
        args: [],
        effect: 'observe',
        profile: 'agent',
        required: true,
        expectedText: 'ready',
      },
    ])
    let executable = 'first-runtime'
    const resolver = () => executable
    const before = inspectEnvironment(root, { resolver })
    const report = await probeEnvironment(root, {
      profile: 'agent',
      authorize: async () => true,
      resolver,
      runner: () => {
        executable = 'second-runtime'
        return 'ready'
      },
    })
    expect(report.readiness).toBe('blocked')
    expect(report.capabilities[0].state).toBe('unknown')
    expect(inspectEnvironment(root, { resolver }).contextDigest).not.toBe(before.contextDigest)
  })
  it('does not turn executable discovery into a capability claim', () => {
    const result = inspectEnvironment(fixture([]), { resolver: () => 'located' })
    expect(result.readiness).toBe('limited')
    expect(result.capabilities.every((c) => c.state === 'unknown')).toBe(true)
  })
  it('preserves a Windows executable path and argument boundaries', async () => {
    const executable = 'C:\\Program Files\\Agent\\agent.exe',
      args = ['--value', 'has spaces']
    const root = fixture([
      {
        id: 'agent',
        executable,
        args,
        effect: 'provider-execution',
        profile: 'agent',
        required: true,
        expectedText: 'ready',
      },
    ])
    const calls = []
    const report = await probeEnvironment(root, {
      profile: 'agent',
      authorize: async () => true,
      runner: (bin, argv) => {
        calls.push([bin, argv])
        return 'ready'
      },
    })
    expect(calls).toEqual([[executable, args]])
    expect(report.readiness).toBe('runnable')
  })
  it('does not execute denied effects or accept an empty no-op response', async () => {
    const root = fixture([
      {
        id: 'agent',
        executable: 'agent',
        args: [],
        effect: 'external-mutation',
        profile: 'agent',
        required: true,
        expectedText: 'ready',
      },
    ])
    let calls = 0
    expect(
      (
        await probeEnvironment(root, {
          profile: 'agent',
          authorize: async () => false,
          runner: () => {
            calls++
            return 'ready'
          },
        })
      ).readiness,
    ).toBe('blocked')
    expect(calls).toBe(0)
    expect(
      (
        await probeEnvironment(root, {
          profile: 'agent',
          authorize: async () => true,
          runner: () => '',
        })
      ).readiness,
    ).toBe('blocked')
    expect(validateEnvironment(root, { runner: () => '' }).ok).toBe(false)
  })
})
