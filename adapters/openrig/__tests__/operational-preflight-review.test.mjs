import { describe, expect, it } from 'vitest'
import { evaluateOperationalPreflight, parseCompactObservation } from '../operational-preflight.mjs'

function valid() {
  const tuple = {
    seat: 'dev.build',
    runtime: 'codex',
    providerRoute: 'openai-codex',
    model: 'gpt-6.1-sol',
    effort: 'medium',
    profile: 'builder',
  }
  return {
    contracts: [tuple],
    installedContracts: [{ ...tuple }],
    daemon: { state: 'running' },
    now: '2026-10-15T12:00:00Z',
    task: {
      rigName: 'fixture',
      owner: 'owner',
      requiredSeats: ['dev.build'],
      bindings: { 'dev.build': { generation: 'g2', sessionId: 's2' } },
    },
    observations: {
      rigName: 'fixture',
      complete: true,
      entries: [
        {
          ...tuple,
          generation: 'g2',
          sessionId: 's2',
          eventAt: '2026-10-15T12:00:00Z',
          sourceVerified: true,
          processReady: true,
          catchupVerified: true,
          occupantVerified: true,
          bindingVerified: true,
          authorized: true,
        },
      ],
    },
  }
}
describe('independent adversarial preflight review (#518)', () => {
  it.each(['missing', 'empty'])('holds %s task requirements instead of inventing them', (mode) => {
    const input = valid()
    if (mode === 'missing') delete input.task.requiredSeats
    else input.task.requiredSeats = []
    expect(evaluateOperationalPreflight(input).admitted).toBe(false)
  })
  it.each(['contracts', 'installedContracts', 'observations'])(
    'does not admit duplicate %s evidence',
    (field) => {
      const input = valid()
      const entries = field === 'observations' ? input.observations.entries : input[field]
      entries.push(structuredClone(entries[0]))
      expect(evaluateOperationalPreflight(input).admitted).toBe(false)
    },
  )
  it.each([
    null,
    [],
    {},
    { entries: [], totalNodes: 1, truncated: false },
    { entries: [], totalNodes: 0, truncated: true },
  ])('rejects malformed compact envelope %j', (envelope) => {
    expect(parseCompactObservation(JSON.stringify(envelope), 'fixture').complete).toBe(false)
  })
  it('rejects duplicate normalized compact seat identities', () => {
    const entry = { rigName: 'fixture', logicalId: 'dev.build', startupStatus: 'READY' }
    expect(
      parseCompactObservation(
        JSON.stringify({ entries: [entry, entry], totalNodes: 2, truncated: false }),
        'fixture',
      ).complete,
    ).toBe(false)
  })
  it('never attests actual execution from matching compact declarations', () => {
    const result = parseCompactObservation(
      JSON.stringify({
        entries: [
          {
            rigName: 'fixture',
            logicalId: 'dev.build',
            model: 'gpt-6.1-sol',
            runtime: 'codex',
            startupStatus: 'READY',
            resumeToken: 'PRIVATE_FIXTURE_TOKEN',
          },
        ],
        totalNodes: 1,
        truncated: false,
      }),
      'fixture',
    )
    expect(result.entries[0].sourceVerified).toBe(false)
    expect(result.entries[0].model).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FIXTURE_TOKEN')
  })
})
