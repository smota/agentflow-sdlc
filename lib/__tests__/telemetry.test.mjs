import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createTelemetry } from '../observability/otel.mjs'
import { analyzeSpool } from '../../scripts/analyze-telemetry.mjs'

describe('Telemetry implementation', () => {
  let receiverServer
  let receivedRequests = []
  let otlpEndpoint = ''

  beforeAll(async () => {
    return new Promise((resolve) => {
      receiverServer = createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          receivedRequests.push({ url: req.url, body })
          res.writeHead(200)
          res.end()
        })
      })
      receiverServer.listen(0, '127.0.0.1', () => {
        otlpEndpoint = `http://127.0.0.1:${receiverServer.address().port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    if (receiverServer) {
      if (typeof receiverServer.closeAllConnections === 'function') {
        receiverServer.closeAllConnections()
      }
      await new Promise((resolve) => receiverServer.close(resolve))
    }
  })

  it('drops secrets and respects privacy allowlist', async () => {
    const t = createTelemetry({ enabled: true, otlpEndpoint, maxQueueSize: 10 })
    t.observer({ kind: 'test', tokenCount: 42, accessToken: 'secret', someOtherField: 'value' })
    await t.shutdown()
    // 1 dropped because of 'accessToken' (a secret)
    expect(t.getDrops()).toBe(1)
  })

  it('exports actual trace attributes and metric values to a local OTLP receiver', async () => {
    receivedRequests.length = 0
    const t = createTelemetry({ enabled: true, otlpEndpoint, maxQueueSize: 10 })

    t.observer({ kind: 'github_cli_request', method: 'GET', requestBytes: 100, responseBytes: 200 })

    await t.shutdown()
    expect(t.getDrops()).toBe(0)

    const metricsRequest = receivedRequests.find((r) => r.url === '/v1/metrics')
    expect(metricsRequest).toBeDefined()
    const metrics = JSON.parse(metricsRequest.body).resourceMetrics.flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics),
    )
    expect(
      metrics.find((metric) => metric.name === 'github_cli_request_count').sum.dataPoints[0]
        .asDouble,
    ).toBe(1)
    expect(
      metrics.find((metric) => metric.name === 'github_cli_request_response_bytes').histogram
        .dataPoints[0].sum,
    ).toBe(200)
    const tracesRequest = receivedRequests.find((r) => r.url === '/v1/traces')
    expect(tracesRequest).toBeDefined()
    const spans = JSON.parse(tracesRequest.body).resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    )
    expect(spans).toHaveLength(2)
    const requestSpan = spans.find((span) => span.name === 'github_cli_request')
    const sessionSpan = spans.find((span) => span.name === 'agentflow.session')
    expect(requestSpan.traceId).toBe(sessionSpan.traceId)
    expect(requestSpan.parentSpanId).toBe(sessionSpan.spanId)
    expect(requestSpan.attributes).toContainEqual({
      key: 'responseBytes',
      value: { intValue: 200 },
    })
  })

  it('disabled mode drops nothing (since it does nothing) and has identical API', async () => {
    const t = createTelemetry({ enabled: false })
    t.observer({ kind: 'test', bytes: 100 })
    await t.shutdown()
    expect(t.getDrops()).toBe(0)
  })

  it('offline shutdown preserves both signal payloads', async () => {
    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agentflow-telemetry-'))

    const t = createTelemetry({ enabled: true, offline: true, spoolDir: tmpDir })

    t.observer({ kind: 'session', state: 'completed' })
    await t.shutdown()

    expect(t.getDrops()).toBe(0)
    expect(fs.existsSync(tmpDir)).toBe(true)
    const files = fs.readdirSync(tmpDir)
    expect(files.length).toBeGreaterThan(0)
    const kinds = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(fs.readFileSync(path.join(tmpDir, file), 'utf8')).payload.kind)
    expect(kinds).toContain('traces')
    expect(kinds).toContain('metrics')
    const analysis = analyzeSpool(tmpDir)
    expect(analysis.acceptedRecords).toBe(1)
    expect(analysis.input.invalidFiles).toBe(0)
    expect(analysis.durationMs.execution).toBeNull()
  })

  it('run-decision invariance holds regardless of telemetry configuration or failure', async () => {
    const { createRunService } = await import('../application/run-service.mjs')
    const { createMemoryRunStore } = await import('../sources/run-store.mjs')

    const executeWorkload = async (telemetryOpts, failObserver = false) => {
      const store = createMemoryRunStore()
      const t = createTelemetry(telemetryOpts)
      const service = createRunService({
        store,
        authorize: async ({ kind }) => kind !== 'human-acceptance',
        resolveContract: async () => null,
        resolveCollaboration: async () => null,
        resolveObservation: async () => null,
        observeWriter: async () => ({ stopped: true }),
        observeWorkspace: async () => ({ verified: true, candidateDigest: 'a'.repeat(64) }),
        reconcileOperation: async () => ({ state: 'unknown' }),
        observer: (event) => {
          if (failObserver) throw new Error('Simulated observation failure')
          t.observer(event)
        },
      })

      const authority = { owner: 'tester', generation: 0 }
      const res = await service.start({
        runId: 'run-1',
        goalRef: 'test',
        owner: 'tester',
        profile: 'standard',
        boundary: 'observe',
        writer: { host: 'localhost', pid: 1, instance: '1' },
        authority,
      })
      const observed = [res.status]
      const record = async (kind, payload) =>
        service.record(kind, payload, {
          expectedRevision: (await service.read()).revision,
          authority,
        })
      await record('candidate', { digest: 'a'.repeat(64) })
      try {
        await service.advance({ contract: {}, authority })
      } catch (error) {
        observed.push(error.message)
      }
      try {
        await record('candidate', { digest: 'invalid' })
      } catch (error) {
        observed.push(error.message)
      }
      await record('paused', { reason: 'test interruption' })
      observed.push((await service.status()).status)
      const plan = await service.recoveryPlan({
        owner: 'tester',
        boundary: 'observe',
        writer: { instance: 'next', host: 'localhost', pid: 123 },
      })
      const resumed = await service.resume({ plan, authority })
      observed.push(resumed.status, (await service.read()).state.generation)
      await t.shutdown()
      return observed
    }

    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agentflow-telemetry-'))

    const baseState = await executeWorkload({ enabled: false })
    const enabledState = await executeWorkload({ enabled: true, otlpEndpoint })
    const offlineState = await executeWorkload({ enabled: true, offline: true, spoolDir: tmpDir })
    const failureState = await executeWorkload({ enabled: true, otlpEndpoint }, true)

    expect(enabledState).toEqual(baseState)
    expect(offlineState).toEqual(baseState)
    expect(failureState).toEqual(baseState)
    expect(baseState[0]).toBe('active')
    expect(baseState[1]).toBe('Human acceptance is unresolved')
    expect(baseState.slice(-3)).toEqual(['paused', 'active', 1])
  })
})
