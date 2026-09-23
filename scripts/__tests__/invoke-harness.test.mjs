import { describe, expect, it } from 'vitest'
import { invokeHarness, isQuotaError } from '../invoke-harness.mjs'

describe('invokeHarness process execution helper', () => {
  it('detects quota and rate limit errors across various providers', () => {
    expect(isQuotaError("You've hit your weekly limit")).toBe(true)
    expect(isQuotaError("You've hit your session limit · resets 8:50am")).toBe(true)
    expect(isQuotaError('Rate limit reached for requests per minute')).toBe(true)
    expect(isQuotaError('Status code 429: Too Many Requests')).toBe(true)
    expect(isQuotaError('Normal compilation error: variable x not found')).toBe(false)
  })

  it('executes node non-interactively with arguments array and captures output', async () => {
    const result = await invokeHarness({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("HELLO_FROM_CHILD")'],
      timeoutMs: 5000,
    })
    expect(result.ok).toBe(true)
    expect(result.disposition).toBe('success')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('HELLO_FROM_CHILD')
  })

  it('handles child stdin writing and stream closing', async () => {
    const result = await invokeHarness({
      executable: process.execPath,
      args: [
        '-e',
        'let d = ""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => process.stdout.write("ECHO:" + d));',
      ],
      stdinContent: 'SPARRING_PAYLOAD',
      timeoutMs: 5000,
    })
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('ECHO:SPARRING_PAYLOAD')
  })

  it('detects timeout and terminates execution', async () => {
    const result = await invokeHarness({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 300,
    })
    expect(result.ok).toBe(false)
    expect(result.disposition).toBe('timeout')
    expect(result.error).toContain('timed out')
  })
})
