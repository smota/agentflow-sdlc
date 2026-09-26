import http from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPortInUse, ProcessSupervisor } from '../qa/process-supervisor.mjs'
import {
  ARTIFACT_TYPES,
  computeArtifactDigest,
  verifyQAEvidenceContract,
} from '../qa/qa-contract-verifier.mjs'

describe('Sandboxed Black-box QA Engine (#279)', () => {
  const toolPolicy = JSON.parse(
    readFileSync(resolve(process.cwd(), 'roles/tester/tool-policy.json'), 'utf8'),
  )

  it('1. Tool policy blocks code modification or reading tools for role tester (NFR-01)', () => {
    const prohibitedCheck = verifyQAEvidenceContract({
      testVerdict: 'passed',
      invokedTools: ['run_terminal', 'write_to_file', 'replace_file_content'],
      toolPolicy,
    })

    expect(prohibitedCheck.ok).toBe(false)
    expect(prohibitedCheck.errors.some((e) => e.includes('write_to_file'))).toBe(true)
    expect(prohibitedCheck.errors.some((e) => e.includes('replace_file_content'))).toBe(true)
    expect(prohibitedCheck.errors.some((e) => e.includes('VIOLATION_SEPARATION_OF_DUTIES'))).toBe(
      true,
    )

    const allowedCheck = verifyQAEvidenceContract({
      testVerdict: 'failed',
      invokedTools: ['run_terminal', 'http_client', 'browser_screenshot'],
      toolPolicy,
    })

    expect(
      allowedCheck.errors.filter((e) => e.includes('VIOLATION_SEPARATION_OF_DUTIES')),
    ).toHaveLength(0)
  })

  it('2. QA pass without execution evidence is rejected by contract verifier', () => {
    const result = verifyQAEvidenceContract({
      testVerdict: 'passed',
      acceptanceCriteria: ['AC-01', 'AC-02'],
      executionArtifacts: [],
      toolPolicy,
    })

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('REJECTED_MISSING_EXECUTION_EVIDENCE'))).toBe(true)
  })

  it('3. All acceptance criteria must be covered by verifiable execution artifacts', () => {
    const artifact1 = {
      id: 'art-1',
      type: ARTIFACT_TYPES.TERMINAL_LOG,
      criterionId: 'AC-01',
      content: 'Server started successfully on port 3000\n[GET /health] 200 OK',
    }

    const incomplete = verifyQAEvidenceContract({
      testVerdict: 'passed',
      acceptanceCriteria: ['AC-01', 'AC-02'],
      executionArtifacts: [artifact1],
      toolPolicy,
    })

    expect(incomplete.ok).toBe(false)
    expect(
      incomplete.errors.some((e) =>
        e.includes("Acceptance criterion 'AC-02' lacks required execution evidence artifact"),
      ),
    ).toBe(true)

    const artifact2 = {
      id: 'art-2',
      type: ARTIFACT_TYPES.HTTP_RESPONSE,
      criterionId: 'AC-02',
      content: JSON.stringify({ status: 200, healthy: true }),
    }

    const complete = verifyQAEvidenceContract({
      testVerdict: 'passed',
      acceptanceCriteria: ['AC-01', 'AC-02'],
      executionArtifacts: [artifact1, artifact2],
      toolPolicy,
    })

    expect(complete.ok).toBe(true)
    expect(complete.verifiedArtifacts).toHaveLength(2)
  })

  it('4. Cryptographic SHA-256 digest validation detects tampered evidence (NFR-03)', () => {
    const validContent = 'HTTP/1.1 200 OK\nContent-Type: application/json'
    const correctDigest = computeArtifactDigest(validContent)

    const validResult = verifyQAEvidenceContract({
      testVerdict: 'passed',
      acceptanceCriteria: ['AC-01'],
      executionArtifacts: [
        {
          id: 'art-1',
          type: ARTIFACT_TYPES.HTTP_RESPONSE,
          criterionId: 'AC-01',
          content: validContent,
          digest: correctDigest,
        },
      ],
      toolPolicy,
    })

    expect(validResult.ok).toBe(true)
    expect(validResult.verifiedArtifacts[0].digest).toBe(correctDigest)

    const tamperedResult = verifyQAEvidenceContract({
      testVerdict: 'passed',
      acceptanceCriteria: ['AC-01'],
      executionArtifacts: [
        {
          id: 'art-1',
          type: ARTIFACT_TYPES.HTTP_RESPONSE,
          criterionId: 'AC-01',
          content: validContent,
          digest: '0000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      toolPolicy,
    })

    expect(tamperedResult.ok).toBe(false)
    expect(tamperedResult.errors.some((e) => e.includes('TAMPERED_ARTIFACT_DIGEST'))).toBe(true)
  })

  it('5. Process Supervisor spawns child process, tracks PID, and cleanly frees port upon termination (NFR-02)', async () => {
    const supervisor = new ProcessSupervisor()
    const testPort = 39281

    // Verify port is free initially
    const initiallyInUse = await isPortInUse(testPort)
    expect(initiallyInUse).toBe(false)

    // Spawn a node http server listening on testPort
    const serverScript = `
      const http = require('http');
      const server = http.createServer((req, res) => res.end('ok'));
      server.listen(${testPort}, '127.0.0.1', () => console.log('READY'));
    `
    const proc = supervisor.spawnProcess({
      command: process.execPath,
      args: ['-e', serverScript],
      port: testPort,
      label: 'mock-dev-server',
    })

    expect(proc.pid).toBeGreaterThan(0)
    expect(supervisor.getRunningProcesses()).toHaveLength(1)

    // Wait briefly for port to bind
    let portBound = false
    for (let i = 0; i < 20; i++) {
      if (await isPortInUse(testPort)) {
        portBound = true
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(portBound).toBe(true)

    // Terminate process
    await supervisor.terminateProcess(proc.pid, { force: true })

    // Wait briefly for port to be released
    let portFreed = false
    for (let i = 0; i < 20; i++) {
      if (!(await isPortInUse(testPort))) {
        portFreed = true
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }

    expect(portFreed).toBe(true)
    expect(proc.status).toBe('terminated')
  })
})
