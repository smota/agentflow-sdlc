import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { GATE_CLASSES, createGate, createGatePendingEvent } from '../core/gate.mjs'
import { createGatePendingHook } from '../adapters/gate-pending-hook.mjs'
import { validateActionBoundary } from '../lifecycle-contracts.mjs'

const config = JSON.parse(readFileSync(new URL('../../defaults/sdlc.config.json', import.meta.url)))

const candidateDigest = 'b'.repeat(64)

function releaseGate() {
  return createGate({
    gateClass: GATE_CLASSES.releaseOfCandidate,
    subjectDigest: candidateDigest,
    subjectKind: 'candidateDigest',
    requiredRole: 'reviewer',
  })
}

const ref = (overrides = {}) => ({
  kind: 'review',
  system: 'github',
  uri: 'https://example.test/approval/1',
  authority: 'authoritative',
  relationship: 'input',
  revision: 'abc',
  ...overrides,
})

describe('gate-pending event and outbound hook contract', () => {
  it('1. opening a gate emits exactly one typed event carrying gate class, subject digest and required role', () => {
    const gate = releaseGate()
    const event = createGatePendingEvent(gate, 'run-1')
    expect(event.type).toBe('gate-pending')
    expect(event.version).toBe(1)
    expect(event.gateClass).toBe(GATE_CLASSES.releaseOfCandidate)
    expect(event.subjectDigest).toBe(candidateDigest)
    expect(event.subjectKind).toBe('candidateDigest')
    expect(event.requiredRole).toBe('reviewer')
    expect(event.unitRef).toBe('run-1')
    expect(typeof event.digest).toBe('string')
  })

  it('2. an unconfigured hook emits nothing and does not error; gates still function', async () => {
    const deliver = vi.fn()
    const hook = createGatePendingHook({}, { deliver })
    expect(hook.configured).toBe(false)
    const gate = releaseGate()
    await expect(hook.emit(gate, 'run-1')).resolves.toMatchObject({ delivered: false })
    expect(deliver).not.toHaveBeenCalled()
    expect(gate.type).toBe('gate')
  })

  it('3. a configured hook receives the event exactly once per gate opening, not once per evaluation', async () => {
    const deliver = vi.fn().mockResolvedValue()
    const hook = createGatePendingHook(
      { gateNotifications: { hookUrl: 'https://example.test/hooks/gate-pending' } },
      { deliver },
    )
    expect(hook.configured).toBe(true)
    const gate = releaseGate()
    await hook.emit(gate, 'run-1')
    await hook.emit(gate, 'run-1')
    await hook.emit(gate, 'run-1')
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('4. external-action without a humanApprovalRef is refused', () => {
    const result = validateActionBoundary(
      {
        version: 1,
        profile: 'high-assurance',
        requested: 'external-action',
        effective: 'external-action',
        owningRole: 'developer',
      },
      config,
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('humanApprovalRef'))).toBe(true)
  })

  it('5. external-action with a humanApprovalRef but no delivery handoff is refused', () => {
    const result = validateActionBoundary(
      {
        version: 1,
        profile: 'high-assurance',
        requested: 'external-action',
        effective: 'external-action',
        owningRole: 'developer',
        humanApprovalRef: ref(),
      },
      config,
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => /delivery ?handoff/i.test(error))).toBe(true)
  })

  it('6. external-action with both a humanApprovalRef and a delivery handoff is permitted', () => {
    const result = validateActionBoundary(
      {
        version: 1,
        profile: 'high-assurance',
        requested: 'external-action',
        effective: 'external-action',
        owningRole: 'developer',
        humanApprovalRef: ref(),
        deliveryHandoff: {
          version: 1,
          id: 'handoff-1',
          state: 'proposed',
          sourceRole: 'pr-readiness',
          artifactRefs: [],
          validationRefs: [],
          approvalRefs: [],
        },
      },
      config,
    )
    expect(result.ok).toBe(true)
    // The product records the handoff; it never performs the action itself. Nothing in this
    // contract, or anywhere it delegates to, executes a deployment or notifies anyone.
  })
})
