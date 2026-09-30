#!/usr/bin/env node
// Local repeatable comparison of createTelemetry modes; this is a measurement, not a pass/fail gate.
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createTelemetry } from '../lib/observability/otel.mjs'

const SAMPLE_COUNT = 20
const WARMUP_COUNT = 3
const observations = Array.from({ length: 100 }, (_, index) => ({
  kind: 'github_client_request',
  method: index % 4 === 0 ? 'POST' : 'GET',
  status: 200,
  requestBytes: 256 + index,
  responseBytes: 512 + index,
  duration: index + 1,
}))

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(fraction * sorted.length) - 1]
}

function summary(values) {
  return {
    count: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
  }
}

async function startReceiver() {
  const requests = []
  const server = createServer((request, response) => {
    const start = performance.now()
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
    })
    request.on('end', () => {
      requests.push({ path: request.url, bytes, handlingMs: performance.now() - start })
      response.writeHead(200)
      response.end()
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function measure(mode, { endpoint, spoolRoot, sample }) {
  let spoolDir
  const options = { enabled: mode !== 'disabled', maxQueueSize: 2048 }
  if (mode === 'enabled') options.otlpEndpoint = endpoint
  if (mode === 'offline') {
    options.offline = true
    spoolDir = mkdtempSync(join(spoolRoot, 'offline-'))
    options.spoolDir = spoolDir
  }

  const totalStart = performance.now()
  const telemetry = createTelemetry(options)
  const observeStart = performance.now()
  for (const observation of observations) telemetry.observer(observation)
  const observerMs = performance.now() - observeStart
  const shutdownStart = performance.now()
  await telemetry.shutdown()
  const shutdownMs = performance.now() - shutdownStart
  const totalMs = performance.now() - totalStart
  const report = telemetry.getReport()
  if (spoolDir) rmSync(spoolDir, { recursive: true, force: true })
  return { sample, mode, totalMs, observerMs, shutdownMs, drops: telemetry.getDrops(), report }
}

const receiver = await startReceiver()
const spoolRoot = mkdtempSync(join(tmpdir(), 'agentflow-process-telemetry-'))
const modes = ['disabled', 'enabled', 'offline']
const raw = []
try {
  for (let sample = 0; sample < SAMPLE_COUNT + WARMUP_COUNT; sample++) {
    const order = modes.slice(sample % modes.length).concat(modes.slice(0, sample % modes.length))
    for (const mode of order) {
      const result = await measure(mode, { endpoint: receiver.endpoint, spoolRoot, sample })
      if (sample >= WARMUP_COUNT) raw.push(result)
    }
  }
} finally {
  await receiver.close()
  rmSync(spoolRoot, { recursive: true, force: true })
}

const byMode = Object.fromEntries(
  modes.map((mode) => [mode, raw.filter((result) => result.mode === mode)]),
)
const baseline = byMode.disabled
const results = Object.fromEntries(
  modes.map((mode) => {
    const records = byMode[mode]
    const deltas = records.map((record, index) => record.totalMs - baseline[index].totalMs)
    const output = {
      totalLatency: summary(records.map((record) => record.totalMs)),
      observerLatency: summary(records.map((record) => record.observerMs)),
      shutdownAndFlushLatency: summary(records.map((record) => record.shutdownMs)),
      drops: records.reduce((total, record) => total + record.drops, 0),
    }
    if (mode !== 'disabled') {
      const p95OverheadMs = percentile(deltas, 0.95)
      output.pairedOverhead = {
        count: deltas.length,
        p50Ms: Number(percentile(deltas, 0.5).toFixed(3)),
        p95Ms: Number(p95OverheadMs.toFixed(3)),
        disabledP95Ms: Number(
          percentile(
            baseline.map((record) => record.totalMs),
            0.95,
          ).toFixed(3),
        ),
      }
    }
    return [mode, output]
  }),
)

const receiverBytes = receiver.requests.reduce((total, request) => total + request.bytes, 0)
process.stdout.write(
  `${JSON.stringify(
    {
      measurementOnly: true,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      workload: {
        observationCountPerSample: observations.length,
        identicalPayloadAcrossModes: true,
        lifecycle: 'createTelemetry, observe every record, shutdown and flush',
        samples: SAMPLE_COUNT,
        warmupsPerMode: WARMUP_COUNT,
      },
      exporter: {
        localOtlpRequests: receiver.requests.length,
        localOtlpBytes: receiverBytes,
        collectorHandlingMs: summary(receiver.requests.map((request) => request.handlingMs)),
      },
      results,
      interpretation:
        'Paired p95 overhead is measured against the disabled run from the same sample. This local workload is not a production acceptance result.',
    },
    null,
    2,
  )}\n`,
)
