import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { renderOnboardingView } from '../cockpit-ui.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const serverScript = resolve(packageRoot, 'scripts/cockpit-server.mjs')

async function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => res(port))
    })
    srv.on('error', rej)
  })
}

async function waitForServer(url, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`)
      if (res.ok) return true
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Server did not start at ${url} within ${timeoutMs}ms`)
}

describe('Cockpit Onboarding Affordance (P4-C5 to P4-C8)', () => {
  let tempDir
  let targetDir
  let port
  let serverProcess
  let baseUrl

  beforeEach(async () => {
    tempDir = mkdtempSync(join(realpathSync(tmpdir()), 'cockpit-onboarding-'))
    targetDir = mkdtempSync(join(realpathSync(tmpdir()), 'cockpit-adopter-target-'))
    port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`

    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: packageRoot,
      env: {
        ...process.env,
        PORT: String(port),
        AGENTFLOW_REPOSITORIES: 'test/repo',
        COCKPIT_WRITE_ACTIONS: 'true',
        COCKPIT_DATA_DIR: tempDir,
        COCKPIT_SESSION_SECRET: 'test-session-secret-32-chars-long',
        COCKPIT_REMOTE: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForServer(baseUrl)
  })

  afterEach(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM')
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
    if (targetDir && existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('P4-C5: GET /onboarding serves the visual stepper page with tool readiness and profile picker', async () => {
    const res = await fetch(`${baseUrl}/onboarding?target=${encodeURIComponent(targetDir)}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Project Onboarding Stepper')
    expect(html).toContain('1. Environment Tool Readiness')
    expect(html).toContain('2. Project & Composition Configuration')
    expect(html).toContain('standard - Recommended')
  })

  it('P4-C6: POST /onboarding/plan generates adoption preview with SHA256 digest', async () => {
    const planRes = await fetch(`${baseUrl}/onboarding/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        targetDir,
        profile: 'standard',
        harness: true,
      }),
    })

    expect(planRes.status).toBe(200)
    const data = await planRes.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeDefined()
    expect(data.plan.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(data.plan.changes.length).toBeGreaterThan(0)
    expect(data.plan.changes.some((c) => (c.target || c.path) === 'AGENTS.md')).toBe(true)
  })

  it('P4-C7: POST /onboarding/apply verifies confirmation digest and applies adoption', async () => {
    // 1. Get plan
    const planRes = await fetch(`${baseUrl}/onboarding/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ targetDir, profile: 'standard', harness: true }),
    })
    const { plan } = await planRes.json()

    // 2. Try applying with invalid confirm token -> must fail 400
    const failRes = await fetch(`${baseUrl}/onboarding/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        targetDir,
        plan,
        confirm: 'invalid0000000000000000000000000000000000000000000000000000000000',
      }),
    })
    expect(failRes.status).toBe(400)
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false)

    // 3. Apply with correct digest
    const applyRes = await fetch(`${baseUrl}/onboarding/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        targetDir,
        plan,
        confirm: plan.digest,
      }),
    })

    expect(applyRes.status).toBe(200)
    const applyData = await applyRes.json()
    expect(applyData.ok).toBe(true)
    expect(applyData.receipt).toBeDefined()
    expect(applyData.receipt.receiptToken).toBeDefined()
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(targetDir, 'agent-framework-lock.json'))).toBe(true)
  })

  it('P4-C8: POST /onboarding/inspect returns tools and repository inventory', async () => {
    const inspectRes = await fetch(`${baseUrl}/onboarding/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ targetDir, profile: 'standard' }),
    })

    expect(inspectRes.status).toBe(200)
    const data = await inspectRes.json()
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.tools)).toBe(true)
    expect(data.tools.some((t) => t.name === 'node')).toBe(true)
    expect(data.inventory).toBeDefined()
  })

  it('renderOnboardingView unit tests: renders receipt and error states cleanly', () => {
    const receiptHtml = renderOnboardingView({
      targetDir: '/test/path',
      receipt: { transactionId: 'tx-12345', recoveryToken: 'rec-67890' },
    })
    expect(receiptHtml).toContain('Adoption Applied')
    expect(receiptHtml).toContain('tx-12345')
    expect(receiptHtml).toContain('rec-67890')

    const errorHtml = renderOnboardingView({
      targetDir: '/test/path',
      error: 'Plan calculation failed: duplicate files',
    })
    expect(errorHtml).toContain('Error')
    expect(errorHtml).toContain('Plan calculation failed: duplicate files')
  })
})
