#!/usr/bin/env node
import { spawn } from 'node:child_process'

const port = 49175
const env = {
  ...process.env,
  PORT: String(port),
  COCKPIT_PORT: String(port),
  AGENTFLOW_REPOSITORIES: 'smota/agentflow-sdlc',
  COCKPIT_WRITE_ACTIONS: 'false',
  COCKPIT_DATA_DIR: '.agent-runs/cockpit-smoke',
}
const child = spawn(process.execPath, ['scripts/cockpit-server.mjs'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => (output += chunk.toString()))
child.stderr.on('data', (chunk) => (output += chunk.toString()))
try {
  await waitFor(() => output.includes('AgentFlow Cockpit listening'), 5000)
  const health = await fetch(`http://127.0.0.1:${port}/healthz`)
  if (!health.ok) throw new Error(`/healthz failed: ${health.status}`)
  const asset = await fetch(`http://127.0.0.1:${port}/assets/cockpit/agentflow-logo.png`)
  if (!asset.ok) throw new Error(`asset failed: ${asset.status}`)
  process.stdout.write(
    `${JSON.stringify({ ok: true, health: health.status, asset: asset.status }, null, 2)}\n`,
  )
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message, output }, null, 2)}\n`)
  process.exitCode = 1
} finally {
  child.kill()
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('cockpit server did not start')
}
