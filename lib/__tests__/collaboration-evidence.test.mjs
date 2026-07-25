import { describe, expect, it } from 'vitest'
import { validateCollaborationEvidence } from '../collaboration-evidence.mjs'

describe('collaboration evidence', () => {
  it('accepts single-agent evidence without helpers', () => {
    const result = validateCollaborationEvidence({
      collaborationMode: 'single-agent',
      reason: 'low-risk work',
      helpers: [],
    })
    expect(result.ok).toBe(true)
  })

  it('requires helper evidence for council mode', () => {
    const result = validateCollaborationEvidence({
      collaborationMode: 'council',
      reason: 'architecture uncertainty',
      helpers: [],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/requires/)
  })

  it('rejects multiple writer helpers', () => {
    const result = validateCollaborationEvidence({
      collaborationMode: 'spike',
      reason: 'experiment',
      synthesis: 'summary',
      helpers: [
        { role: 'a', permissions: 'writer', singleWriterRule: true },
        { role: 'b', permissions: 'writer', singleWriterRule: true },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/multiple helpers/)
  })

  it('rejects unbounded loop evidence', () => {
    const result = validateCollaborationEvidence({
      collaborationMode: 'single-agent',
      reason: 'format fix',
      helpers: [],
      loops: [{ loopType: 'format-fix' }],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/maxIterations/)
  })
})
