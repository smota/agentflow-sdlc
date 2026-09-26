import { describe, expect, it } from 'vitest'
import { evaluateGateTransition, evaluateGuardedAction } from '../cockpit-actions.mjs'
import { renderGateTransitionModal } from '../cockpit-ui.mjs'

describe('Interactive Gate Dialogs with Dual-Control Enforcement (Issue #276)', () => {
  describe('evaluateGateTransition', () => {
    it('allows transition on standard profile with healthy readiness and operator role', () => {
      const result = evaluateGateTransition({
        currentPhase: 'developer',
        targetPhase: 'tester',
        readinessHealth: { score: 85, grade: 'healthy' },
        selectedPath: { profile: 'standard', risk: 'medium' },
        userRole: 'operator',
        confirmation: true,
      })

      expect(result.allowed).toBe(true)
      expect(result.reasons).toHaveLength(0)
      expect(result.waiverApplied).toBe(false)
    })

    it('rejects promotion by non-write role (viewer)', () => {
      const result = evaluateGateTransition({
        currentPhase: 'developer',
        targetPhase: 'tester',
        readinessHealth: { score: 90, grade: 'healthy' },
        selectedPath: { profile: 'standard', risk: 'low' },
        userRole: 'viewer',
        confirmation: true,
      })

      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('role-cannot-promote')
    })

    it('enforces dual-control: rejects high-assurance transition when author approves themselves', () => {
      const result = evaluateGateTransition({
        currentPhase: 'reviewer',
        targetPhase: 'pr-readiness',
        readinessHealth: { score: 95, grade: 'healthy' },
        selectedPath: { profile: 'high-assurance', risk: 'critical' },
        authorId: 'alice',
        approverId: 'alice',
        userRole: 'maintainer',
        confirmation: true,
      })

      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('dual-control-violation-author-cannot-approve')
    })

    it('allows high-assurance transition when author and approver are distinct (Four-Eyes Principle)', () => {
      const result = evaluateGateTransition({
        currentPhase: 'reviewer',
        targetPhase: 'pr-readiness',
        readinessHealth: { score: 95, grade: 'healthy' },
        selectedPath: { profile: 'high-assurance', risk: 'critical' },
        authorId: 'alice',
        approverId: 'bob',
        userRole: 'maintainer',
        confirmation: true,
      })

      expect(result.allowed).toBe(true)
      expect(result.reasons).toHaveLength(0)
    })

    it('demands human waiver when readiness score is below threshold', () => {
      const result = evaluateGateTransition({
        currentPhase: 'developer',
        targetPhase: 'tester',
        readinessHealth: { score: 65, grade: 'needs-attention' },
        selectedPath: { profile: 'standard', risk: 'medium' },
        userRole: 'operator',
        confirmation: true,
      })

      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('readiness-check-incomplete-waiver-required')
    })

    it('accepts valid waiver with justification and applies waiver', () => {
      const result = evaluateGateTransition({
        currentPhase: 'developer',
        targetPhase: 'tester',
        readinessHealth: { score: 65, grade: 'needs-attention' },
        selectedPath: { profile: 'standard', risk: 'medium' },
        userRole: 'operator',
        confirmation: true,
        waiver: {
          reason: 'Non-blocking lint warning deferred to tech-debt tracking issue #285',
          approverId: 'bob',
        },
      })

      expect(result.allowed).toBe(true)
      expect(result.waiverApplied).toBe(true)
    })

    it('rejects waiver when reason is too short', () => {
      const result = evaluateGateTransition({
        currentPhase: 'developer',
        targetPhase: 'tester',
        readinessHealth: { score: 65, grade: 'needs-attention' },
        selectedPath: { profile: 'standard', risk: 'medium' },
        userRole: 'operator',
        confirmation: true,
        waiver: {
          reason: 'too short',
          approverId: 'bob',
        },
      })

      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('waiver-reason-too-short')
    })

    it('rejects waiver self-approved by author in high-assurance mode', () => {
      const result = evaluateGateTransition({
        currentPhase: 'tester',
        targetPhase: 'reviewer',
        readinessHealth: { score: 70, grade: 'needs-attention' },
        selectedPath: { profile: 'high-assurance', risk: 'high' },
        authorId: 'alice',
        approverId: 'bob',
        userRole: 'operator',
        confirmation: true,
        waiver: {
          reason: 'Valid justification for bypassing exploratory check',
          approverId: 'alice', // Author trying to approve waiver
        },
      })

      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('dual-control-violation-waiver-author-cannot-approve')
    })
  })

  describe('renderGateTransitionModal', () => {
    it('renders readiness dimensions, path badges, and target phase selection', () => {
      const goal = {
        number: 101,
        title: 'Authentication overhaul',
        author: 'alice',
        selectedPath: { profile: 'high-assurance', risk: 'critical' },
        evidenceHealth: {
          score: 85,
          grade: 'healthy',
          dimensions: [
            { id: 'scope', label: 'Scope', score: 100, detail: 'Criteria complete' },
            { id: 'design', label: 'Design', score: 90, detail: 'Arch review complete' },
            { id: 'validation', label: 'Validation', score: 80, detail: 'Automated tests pass' },
          ],
        },
      }

      const html = renderGateTransitionModal(goal, { user: 'bob', csrfToken: 'token-123' })
      expect(html).toContain('Gate Transition & Readiness Verification')
      expect(html).toContain('Authentication overhaul')
      expect(html).toContain('high-assurance')
      expect(html).toContain('critical risk')
      expect(html).toContain('Scope')
      expect(html).toContain('name="targetPhase"')
      expect(html).toContain('name="csrf"')
      expect(html).not.toContain('Dual-Control Violation')
    })

    it('renders dual-control violation alert and disables button if user is the author on high-assurance', () => {
      const goal = {
        number: 102,
        title: 'Payment gateway',
        author: 'alice',
        selectedPath: { profile: 'high-assurance', risk: 'high' },
        evidenceHealth: { score: 90, grade: 'healthy', dimensions: [] },
      }

      const html = renderGateTransitionModal(goal, { user: 'alice' })
      expect(html).toContain('Dual-Control Violation')
      expect(html).toContain('disabled')
    })

    it('renders waiver input form when readiness score is below 80', () => {
      const goal = {
        number: 103,
        title: 'Feature with missing docs',
        author: 'alice',
        selectedPath: { profile: 'standard', risk: 'low' },
        evidenceHealth: { score: 65, grade: 'needs-attention', dimensions: [] },
      }

      const html = renderGateTransitionModal(goal, { user: 'bob' })
      expect(html).toContain('Human Waiver Request')
      expect(html).toContain('name="waiverReason"')
    })
  })
})
