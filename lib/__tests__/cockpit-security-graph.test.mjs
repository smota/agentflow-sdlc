import { describe, expect, it } from 'vitest'
import { buildCockpitGraph } from '../cockpit-graph.mjs'
import {
  createCsrfToken,
  createRateLimiter,
  rejectForbiddenTelemetryFields,
  securityHeaders,
  verifyCsrfToken,
} from '../cockpit-security.mjs'

describe('cockpit security hardening helpers', () => {
  it('creates and verifies csrf tokens', () => {
    const token = createCsrfToken({ sessionId: 's1', secret: 'x'.repeat(32), nonce: 'n1' })
    expect(verifyCsrfToken({ token, sessionId: 's1', secret: 'x'.repeat(32) })).toBe(true)
    expect(verifyCsrfToken({ token, sessionId: 'other', secret: 'x'.repeat(32) })).toBe(false)
  })

  it('returns security headers for remote UI', () => {
    const headers = securityHeaders({ publicUrl: 'https://cockpit.example.com' })
    expect(headers['Content-Security-Policy']).toContain(
      'frame-ancestors https://cockpit.example.com',
    )
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('rate limits repeated requests', () => {
    const limit = createRateLimiter({ limit: 2, windowMs: 1000 })
    expect(limit('a', 1).ok).toBe(true)
    expect(limit('a', 2).ok).toBe(true)
    expect(limit('a', 3).ok).toBe(false)
  })

  it('rejects forbidden telemetry fields', () => {
    expect(
      rejectForbiddenTelemetryFields({
        event: 'phase',
        prompt: 'secret',
        nested: { toolInput: 'x' },
      }),
    ).toEqual(['prompt', 'nested.toolInput'])
  })
})

describe('cockpit relationship graph', () => {
  it('derives graph nodes and edges from durable evidence', () => {
    const graph = buildCockpitGraph({
      issue: { number: 119, title: 'Cockpit', body: 'Depends on #134. Follow-up #139' },
      comments: [
        {
          id: 1,
          body: '<!-- agentflow:validation-summary -->\nok',
          html_url: 'https://example/comment',
        },
      ],
      pullRequests: [{ number: 126, title: 'Cockpit PR', merged_at: '2026-01-01T00:00:00Z' }],
      commits: [{ sha: 'abcdef123' }],
    })
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['issue:119', 'issue:134', 'comment:1', 'pr:126']),
    )
    expect(graph.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(['recorded-by', 'closes-or-implements']),
    )
  })
})
