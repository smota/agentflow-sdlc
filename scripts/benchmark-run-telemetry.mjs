#!/usr/bin/env node
// Measurement-only comparison of the public local-preview run journey with telemetry off,
// exported to a local OTLP receiver, and written to the local spool. This is not a qualification gate.
import { createServer } from 'node:http'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { runDelivery } from './run-delivery.mjs'
import { recordDigest } from '../lib/core/record-digest.mjs'

const SAMPLES = 12
const WARMUPS = 2
const MODES = ['disabled', 'enabled', 'offline']
const rootDir = resolve('.agent-runs/completion')
const tempRoot = mkdtempSync(join(tmpdir(), 'agentflow-run-telemetry-'))
mkdirSync(rootDir, { recursive: true })
const requests = []
const server = createServer((request, response) => {
  const started = performance.now()
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const bytes = Buffer.concat(chunks)
    let payload = null
    try {
      payload = JSON.parse(bytes.toString('utf8'))
    } catch {}
    requests.push({
      path: request.url,
      bytes: bytes.length,
      handlingMs: performance.now() - started,
      payload,
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
})

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}
const summary = (values) => ({
  count: values.length,
  p50Ms: Number(percentile(values, 0.5).toFixed(3)),
  p95Ms: Number(percentile(values, 0.95).toFixed(3)),
})
function freshFixture(mode, sample) {
  const root = mkdtempSync(join(tempRoot, `${mode}-${sample}-`))
  const app = 'module.exports = (value) => value.trim().toLowerCase()\n'
  const test =
    "const {test}=require('node:test');const assert=require('node:assert/strict');test('normalizes query',()=>assert.equal(require('./app.cjs')(' Search '),'search'))\n"
  writeFileSync(join(root, 'app.cjs'), app)
  writeFileSync(join(root, 'app.test.cjs'), test)
  const candidate = { inputs: ['app.cjs', 'app.test.cjs'] }
  const check = {
    id: 'suite',
    criterionId: 'query',
    executable: process.execPath,
    args: ['--test', '--test-reporter=junit', 'app.test.cjs'],
    assertions: ['normalizes query'],
    timeoutMs: 5000,
    format: 'junit-stdout',
  }
  writeFileSync(
    join(root, 'acceptance.json'),
    JSON.stringify({
      version: 2,
      goalRevision: 'fixture:1',
      criteria: [
        {
          id: 'query',
          definitionDigest: recordDigest({ ...check, ...candidate }),
          assertions: ['normalizes query'],
        },
      ],
    }),
  )
  const observability = {
    enabled: mode !== 'disabled',
    offline: mode === 'offline',
    ...(mode === 'enabled' ? { otlpEndpoint } : {}),
    ...(mode === 'offline' ? { spoolDir: join(root, '.agent-runs', 'telemetry') } : {}),
  }
  writeFileSync(
    join(root, 'agent-workflow.config.json'),
    JSON.stringify({
      observability,
      delivery: {
        source: { kind: 'local-preview' },
        candidate,
        checks: { suite: check },
        contracts: { 'product-manager': 'acceptance.json' },
      },
    }),
  )
  return root
}
function payloadsFromSpool(root) {
  const dir = join(root, '.agent-runs', 'telemetry')
  if (!readdirSync(dir, { withFileTypes: true }).length) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')).payload)
}
let otlpEndpoint
await new Promise((resolveListen, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolveListen)
})
otlpEndpoint = `http://127.0.0.1:${server.address().port}`

const measured = []
let expectedResult = null
try {
  for (let sample = -WARMUPS; sample < SAMPLES; sample++) {
    const rotate = (sample + WARMUPS) % MODES.length
    const order = MODES.slice(rotate).concat(MODES.slice(0, rotate))
    for (const mode of order) {
      const root = freshFixture(mode, sample)

      const commandResults = []
      const outputs = []
      const requestStart = requests.length
      const mutation = ['--writer', 'benchmark', '--generation', '0', '--execute']
      const runOne = async (commandArgs) => {
        const start = performance.now()
        const originalWrite = process.stderr.write
        if (mode !== 'disabled') process.stderr.write = () => true
        let code
        let timing
        try {
          code = await runDelivery([...commandArgs, '--target', root, '--json'], {
            emit: (value) => outputs.push(value),
            onTiming: (value) => {
              timing = value
            },
          })
        } finally {
          process.stderr.write = originalWrite
        }
        return { code, wallMs: performance.now() - start, ...timing }
      }
      const journeyStart = performance.now()
      commandResults.push(await runOne(['start', 'bench', '--goal', 'fixture:1', ...mutation]))
      commandResults.push(await runOne(['freeze', 'bench', ...mutation]))
      commandResults.push(await runOne(['verify', 'bench', '--check', 'suite', ...mutation]))
      const journeyWallMs = performance.now() - journeyStart
      const result = outputs.at(-1)?.result
      const events = JSON.parse(
        readFileSync(join(root, '.agent-runs', 'runs', 'bench', 'events.json'), 'utf8'),
      )
      const observed = events.findLast((event) => event.kind === 'observation')?.payload
        ?.observation
      const accepted = result?.verification?.outcome === 'pass'
      const decision = {
        accepted,
        outcome: result?.verification?.outcome ?? null,
        criterionId: observed?.criterionId ?? null,
        candidateDigest: observed?.candidateDigest ?? null,
        definitionDigest: observed?.definitionDigest ?? null,
        origin: observed?.origin ?? null,
        assertionOutcomes:
          observed?.assertions?.map(({ id, outcome }) => ({ id, outcome })) ?? null,
      }
      const payloads = mode === 'offline' ? payloadsFromSpool(root) : []
      const sessionDurations = commandResults.map((item) => item.applicationMs)
      if (
        sessionDurations.length !== 3 ||
        sessionDurations.some((value) => !Number.isFinite(value))
      )
        throw new Error(
          `${mode} sample ${sample}: expected three application session durations; got ${sessionDurations.length}`,
        )
      if (commandResults.some(({ code }) => code !== 0) || !accepted)
        throw new Error(`${mode} sample ${sample}: public start/freeze/verify journey did not pass`)
      if (expectedResult === null) expectedResult = decision
      else if (JSON.stringify(decision) !== JSON.stringify(expectedResult))
        throw new Error(`Accepted observations differed in ${mode} sample ${sample}`)
      const appElapsedMs = sessionDurations.reduce((sum, value) => sum + value, 0)
      const requestSet = mode === 'enabled' ? requests.slice(requestStart) : []
      const telemetryRequests = requestSet.filter(
        ({ path }) => path === '/v1/traces' || path === '/v1/metrics',
      )
      const spoolStats = payloads.reduce((total, payload) => total + payload.records.length, 0)
      if (sample >= 0)
        measured.push({
          mode,
          sample,
          journeyWallMs,
          appElapsedMs,
          outsideApplicationMs: commandResults.reduce((sum, item) => sum + item.shutdownMs, 0),
          decision,
          collectorRequests: telemetryRequests.length,
          collectorBytes: telemetryRequests.reduce((total, request) => total + request.bytes, 0),
          spoolRecords: spoolStats,
          spoolBytes:
            mode === 'offline'
              ? readdirSync(join(root, '.agent-runs', 'telemetry'))
                  .filter((name) => name.endsWith('.json'))
                  .reduce(
                    (total, name) =>
                      total + statSync(join(root, '.agent-runs', 'telemetry', name)).size,
                    0,
                  )
              : 0,
        })
    }
  }
} finally {
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
}

const byMode = Object.fromEntries(
  MODES.map((mode) => [mode, measured.filter((row) => row.mode === mode)]),
)
const baseline = byMode.disabled
const results = {}
for (const mode of MODES) {
  const rows = byMode[mode]
  results[mode] = {
    applicationElapsed: summary(rows.map(({ appElapsedMs }) => appElapsedMs)),
    totalJourneyWall: summary(rows.map(({ journeyWallMs }) => journeyWallMs)),
    outsideApplication: summary(rows.map(({ outsideApplicationMs }) => outsideApplicationMs)),
    acceptedObservation: rows.every(
      ({ decision }) => JSON.stringify(decision) === JSON.stringify(expectedResult),
    ),
    collectorRequests: rows.reduce((sum, row) => sum + row.collectorRequests, 0),
    collectorBytes: rows.reduce((sum, row) => sum + row.collectorBytes, 0),
    spoolRecords: rows.reduce((sum, row) => sum + row.spoolRecords, 0),
    spoolBytes: rows.reduce((sum, row) => sum + row.spoolBytes, 0),
  }
  if (mode !== 'disabled') {
    const deltas = rows.map((row, index) => row.appElapsedMs - baseline[index].appElapsedMs)
    const ratios = rows.map((row, index) =>
      baseline[index].appElapsedMs === 0
        ? null
        : (100 * (row.appElapsedMs - baseline[index].appElapsedMs)) / baseline[index].appElapsedMs,
    )
    const finiteRatios = ratios.filter(Number.isFinite)
    const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    const variance =
      deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (deltas.length - 1)
    const halfWidth = 2.201 * Math.sqrt(variance / deltas.length) // two-sided 95% t interval, df=11
    results[mode].pairedApplicationOverhead = {
      deltaMs: summary(deltas),
      percent:
        finiteRatios.length === ratios.length
          ? (() => {
              const value = summary(finiteRatios)
              return { count: value.count, p50Percent: value.p50Ms, p95Percent: value.p95Ms }
            })()
          : null,
      meanDeltaMs: Number(mean.toFixed(3)),
      confidence95MeanDeltaMs: [
        Number((mean - halfWidth).toFixed(3)),
        Number((mean + halfWidth).toFixed(3)),
      ],
      stableDirection:
        mean - halfWidth > 0 ? 'positive' : mean + halfWidth < 0 ? 'negative' : 'unstable',
      perSampleDeltaMs: deltas.map((value) => Number(value.toFixed(3))),
    }
  }
}

const output = {
  measurementOnly: true,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  workload: {
    journey: 'runDelivery start -> freeze -> verify',
    source: 'local-preview',
    processCollector: 'real Node.js test process via collectProcessObservation',
    samples: SAMPLES,
    warmupsPerMode: WARMUPS,
    pairedBySample: true,
    sameFixtureBytes: true,
    noAddedWaits: true,
    acceptedObservationEquality: expectedResult,
  },
  exporter: {
    receiverRequests: requests.length,
    receiverBytes: requests.reduce((sum, request) => sum + request.bytes, 0),
    receiverHandling: summary(requests.map((request) => request.handlingMs)),
  },
  results,
  interpretation:
    'Application elapsed uses the same invocation-start to pre-shutdown callback boundary in all modes. Outside application measures shutdown/flush including exporter work, not pure network latency. Total journey wall includes shutdown. This is a warm in-process local-preview workload, not cold process or full delivery qualification. A confidence interval crossing zero is reported as unstable; no target or qualification is implied.',
}
const outputPath = join(rootDir, 'integrated-telemetry.json')
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ outputPath, ...output }, null, 2)}\n`)
rmSync(tempRoot, { recursive: true, force: true })
