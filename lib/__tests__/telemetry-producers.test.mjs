import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintCandidate } from '../verification/workspace.mjs'
import { createLocalCliProvider } from '../providers/local-cli.mjs'

describe('physical observation boundaries', () => {
  it('measures actual candidate UTF-8 reads without changing identity or exposing paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-physical-read-'))
    const content = 'é\r\n'
    writeFileSync(join(root, 'private-name.txt'), content)
    const definition = { inputs: ['private-name.txt'] }
    const expected = fingerprintCandidate(root, definition)
    const events = []
    expect(
      fingerprintCandidate(root, definition, { observer: (event) => events.push(event) }),
    ).toEqual(expected)
    expect(events).toEqual([
      { kind: 'file_read', bytes: Buffer.byteLength(content), files: 1, purpose: 'candidate' },
    ])
    expect(
      fingerprintCandidate(root, definition, {
        observer: () => {
          throw new Error('offline')
        },
      }),
    ).toEqual(expected)
  })

  it('reports one dispatch pair and contains async observer failure', async () => {
    const events = []
    const provider = createLocalCliProvider({
      id: 'agy-cli',
      platform: 'agy',
      executable: 'agy',
      executionTarget: 'agy-cli',
      spawn: () => ({ status: 0, stdout: 'private output', stderr: '' }),
      observer: async (event) => {
        events.push(event)
        throw new Error('observer offline')
      },
    })
    const plan = provider.plan({ args: [] })
    expect(provider.execute(plan, { confirm: plan.token }).status).toBe('pass')
    await new Promise((resolve) => setImmediate(resolve))
    expect(events.map((event) => event.state)).toEqual(['started', 'completed'])
    expect(events[0].operationId).toBe(events[1].operationId)
    expect(events[1].duration).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(events)).not.toContain('private output')
  })
})

describe('process transition observation semantics', () => {
  it.each([false, true])(
    'distinguishes proposed and acknowledged start (failure=%s)',
    async (fail) => {
      const { createRunService } = await import('../application/run-service.mjs')
      const { createMemoryRunStore } = await import('../sources/run-store.mjs')
      const { normalizeObservation } = await import('../observability/events.mjs')
      const events = []
      const store = createMemoryRunStore()
      if (fail)
        store.append = async () => {
          throw new Error('PRIVATE_FAILURE')
        }
      const service = createRunService({
        store,
        authorize: async () => true,
        observer: (event) => events.push(event),
      })
      const start = service.start({
        runId: 'private-run',
        goalRef: 'PRIVATE_GOAL',
        owner: 'writer',
        boundary: 'observe',
        authority: { owner: 'writer', generation: 0 },
      })
      if (fail) await expect(start).rejects.toThrow('PRIVATE_FAILURE')
      else await start
      expect(events.map((event) => event.kind)).toEqual([
        'run_event_attempted',
        fail ? 'run_event_failed' : 'run_event_appended',
      ])
      for (const event of events) {
        expect(event).toMatchObject({
          eventKind: 'started',
          fromPhase: null,
          fromRole: null,
          toPhase: 0,
          toRole: 'product-manager',
        })
        expect(normalizeObservation(event)).not.toBeNull()
        expect(JSON.stringify(event)).not.toContain('PRIVATE_GOAL')
        expect(JSON.stringify(event)).not.toContain('PRIVATE_FAILURE')
      }
      expect(events[0].eventId).toBe(events[1].eventId)
      expect((await store.read()).events).toHaveLength(fail ? 0 : 1)
    },
  )
})
