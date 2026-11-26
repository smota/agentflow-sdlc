import { describe, expect, it } from 'vitest'
import {
  normalizePathToPosix,
  scrubObject,
  scrubSecretsAndPii,
} from '../runtime/context-sanitizer.mjs'

// These cases moved here from the retired handover-protocol test (design item M0-2), because
// lib/providers/engineering-evidence.mjs still depends on the sanitizer.
describe('context sanitizer', () => {
  it('normalizes Windows workstation paths to POSIX and anonymizes the home folder', () => {
    const normalized = normalizePathToPosix('C:\\Users\\someone\\code\\project\\lib\\runtime.mjs')
    expect(normalized).not.toContain('\\')
    expect(normalized).toContain('~/code/project/lib/runtime.mjs')
    expect(normalizePathToPosix(42)).toBe('')
  })

  it('scrubs tokens, keys and bearer credentials', () => {
    const scrubbed = scrubSecretsAndPii(
      [
        'GitHub token: ghp_1234567890abcdef1234567890abcdef1234', // pragma: allowlist secret
        'API key: sk-abcdefghijklmnopqrstuvwxyz1234567890', // pragma: allowlist secret
        'AWS key: AKIAIOSFODNN7EXAMPLE', // pragma: allowlist secret
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ae7H8UZZwCr4L2I', // pragma: allowlist secret
      ].join('\n'),
    )
    expect(scrubbed).not.toMatch(/ghp_|sk-abc|AKIAIOSFODNN7EXAMPLE|eyJhbGci/) // pragma: allowlist secret
    expect(scrubbed).toContain('[REDACTED_GH_TOKEN]')
    expect(scrubbed).toContain('[REDACTED_API_KEY]')
    expect(scrubbed).toContain('[REDACTED_AWS_KEY]')
    expect(scrubbed).toContain('Bearer [REDACTED_BEARER_TOKEN]')
  })

  it('scrubs strings nested in objects and arrays, and leaves other values alone', () => {
    const result = scrubObject({
      note: 'token ghp_1234567890abcdef1234567890abcdef1234', // pragma: allowlist secret
      list: ['sk-abcdefghijklmnopqrstuvwxyz1234567890', 7], // pragma: allowlist secret
      flag: true,
    })
    expect(result.note).toContain('[REDACTED_GH_TOKEN]')
    expect(result.list).toEqual(['[REDACTED_API_KEY]', 7])
    expect(result.flag).toBe(true)
  })
})
