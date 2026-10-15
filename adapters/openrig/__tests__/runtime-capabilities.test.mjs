import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateRuntimeCapabilities } from '../runtime-capabilities.mjs'
import { evaluateOperationalPreflight } from '../operational-preflight.mjs'

const nowMs = Date.parse('2026-10-15T12:00:00Z')
function fixture() {
  const expected = {
    providerRoute: 'munito',
    model: 'qwen/qwen3.8-27b',
    effort: 'medium',
    generation: 'generation-2',
    launchId: 'launch-2',
    sessionId: 'session-2',
  }
  return {
    runtime: 'pi',
    nowMs,
    expected,
    report: {
      protocol: 'openrig.pi-runner-observation',
      version: 1,
      runtimeVersion: '1.2.0',
      sourceVerified: true,
      occupantVerified: true,
      hookSourceVerified: true,
      hookGeneration: 'generation-2',
      observation: JSON.parse(
        readFileSync(
          new URL('./fixtures/pi-runner-observation-candidate-v1.json', import.meta.url),
          'utf8',
        ),
      ),
    },
  }
}
describe('Pi runtime compatibility consumes candidate source evidence honestly (#524)', () => {
  it('exposes separate candidate dimensions without claiming installed public compatibility', () => {
    expect(evaluateRuntimeCapabilities(fixture())).toMatchObject({
      compatible: false,
      status: 'candidate-only',
      processReady: true,
      historyVerified: true,
      actualExecutionVerified: true,
      occupantVerified: true,
      hookOccupantVerified: true,
      hookSchemaCompatibility: 'unknown',
      effects: [],
    })
  })
  it.each(['protocol', 'version', 'runtime'])(
    'holds unknown %s without version inference',
    (field) => {
      const input = fixture()
      if (field === 'runtime') input.runtime = 'unknown'
      else input.report[field] = 'unknown'
      expect(evaluateRuntimeCapabilities(input)).toMatchObject({
        compatible: false,
        status: 'unsupported',
      })
    },
  )
  it('does not turn the reported runtime version into a compatibility promise', () => {
    const input = fixture()
    input.report.runtimeVersion = '999.0.0'
    input.report.compatible = true
    input.report.publiclySupported = true
    expect(evaluateRuntimeCapabilities(input).compatible).toBe(false)
  })
  it('reports failed restore history while retaining process readiness', () => {
    const input = fixture()
    Object.assign(input.report.observation, {
      catchupStatus: 'failed',
      catchupVerified: false,
      catchupFailure: 'entry-not-found',
    })
    expect(evaluateRuntimeCapabilities(input)).toMatchObject({
      compatible: false,
      processReady: true,
      historyVerified: false,
    })
  })
  it('does not verify unrequested or pending history', () => {
    for (const catchupStatus of ['not-requested', 'pending']) {
      const input = fixture()
      Object.assign(input.report.observation, { catchupStatus, catchupVerified: null })
      expect(evaluateRuntimeCapabilities(input).historyVerified).toBe(false)
    }
  })
  it('rejects stale generation and distinguishes hook occupant mismatch from hook schema', () => {
    const input = fixture()
    input.report.observation.observedExecution.generation = 'prior-generation'
    input.report.hookGeneration = 'prior-generation'
    expect(evaluateRuntimeCapabilities(input)).toMatchObject({
      compatible: false,
      occupantVerified: false,
      hookOccupantVerified: false,
      hookSchemaCompatibility: 'unknown',
    })
  })
  it('does not treat a carried matching generation as verified occupant identity', () => {
    const input = fixture()
    delete input.report.occupantVerified
    expect(evaluateRuntimeCapabilities(input).occupantVerified).toBe(false)
  })
  it('does not infer provider from a model namespace or renew stale execution', () => {
    const input = fixture()
    delete input.report.observation.observedExecution.providerRoute
    expect(evaluateRuntimeCapabilities(input).actualExecutionVerified).toBe(false)
    const old = fixture()
    old.report.observation.observedExecution.observedAt = '2026-10-15T11:58:00Z'
    expect(evaluateRuntimeCapabilities(old).actualExecutionVerified).toBe(false)
  })
  it('drops private paths, resume material, and arbitrary RPC error payloads', () => {
    const input = fixture()
    Object.assign(input.report.observation, {
      sessionFile: 'PRIVATE_FIXTURE_PATH',
      resumeToken: 'PRIVATE_FIXTURE_TOKEN',
      error: 'PRIVATE_FIXTURE_RPC',
    })
    expect(JSON.stringify(evaluateRuntimeCapabilities(input))).not.toContain('PRIVATE_FIXTURE')
  })
})

describe('operational preflight runtime compatibility integration (#524)', () => {
  function preflight(report) {
    const { expected } = fixture()
    const contract = {
      seat: 'dev.build',
      runtime: 'pi',
      providerRoute: expected.providerRoute,
      model: expected.model,
      effort: expected.effort,
      profile: 'builder-pi',
    }
    return evaluateOperationalPreflight({
      contracts: [contract],
      installedContracts: [contract],
      daemon: { state: 'running' },
      now: new Date(nowMs).toISOString(),
      task: {
        owner: 'operator',
        rigName: 'fixture',
        requiredSeats: ['dev.build'],
        bindings: {
          'dev.build': {
            generation: expected.generation,
            sessionId: expected.sessionId,
            launchId: expected.launchId,
          },
        },
      },
      observations: {
        rigName: 'fixture',
        complete: true,
        entries: [
          {
            ...contract,
            ...expected,
            eventAt: new Date(nowMs).toISOString(),
            sourceVerified: true,
            occupantVerified: true,
            bindingVerified: true,
            processReady: true,
            catchupVerified: true,
            authorized: true,
          },
        ],
      },
      runtimeCompatibility: [{ seat: 'dev.build', report }],
    })
  }
  it('holds candidate-only compatibility despite otherwise positive execution evidence', () => {
    expect(preflight(fixture().report).admitted).toBe(false)
  })
  it('re-evaluates raw unknown reports instead of trusting compatible booleans', () => {
    expect(
      preflight({
        protocol: 'invented',
        version: 1,
        compatible: true,
        sourceVerified: true,
        publiclySupported: true,
      }).admitted,
    ).toBe(false)
  })
})
