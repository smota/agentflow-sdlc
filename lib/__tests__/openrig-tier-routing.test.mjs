import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUILDER_RUNGS,
  CONSEQUENCE_FLOOR_RE,
  LEAN_BUILDER_RUNGS,
  canAdmitNextSlice,
  countUnmergedAccepted,
  resolveBuilderRung,
  resolveBuilderSeat,
  resolvePhaseCompression,
  resolveStickyBuilderOnReturn,
} from '../../adapters/openrig/tier-routing.mjs'
import {
  BUILDER_RUNGS as LIFECYCLE_BUILDER_RUNGS,
  LEAN_BUILDER_RUNGS as LIFECYCLE_LEAN_BUILDER_RUNGS,
  canAdmitNextSlice as lifecycleCanAdmitNextSlice,
  countUnmergedAccepted as lifecycleCountUnmergedAccepted,
  resolveBuilderRung as lifecycleResolveBuilderRung,
  resolveBuilderSeat as lifecycleResolveBuilderSeat,
  resolvePhaseCompression as lifecycleResolvePhaseCompression,
  resolveStickyBuilderOnReturn as lifecycleResolveStickyBuilderOnReturn,
  siblingRecord,
} from '../../adapters/openrig/lifecycle.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('openrig tier routing and builder rungs (#510)', () => {
  it('exports expected rung definitions and re-exports them from lifecycle', () => {
    expect(BUILDER_RUNGS).toEqual({
      P0: 'dev.build-jr',
      P1: 'dev.build',
      P2: 'dev.build-sr',
      P3: 'dev.build-sr',
      P4: 'dev.build-sr',
    })
    expect(LEAN_BUILDER_RUNGS).toEqual({
      P0: 'dev.build',
      P1: 'dev.build',
      P2: 'dev.build',
      P3: 'dev.build',
      P4: 'dev.build',
    })
    expect(LIFECYCLE_BUILDER_RUNGS).toEqual(BUILDER_RUNGS)
    expect(LIFECYCLE_LEAN_BUILDER_RUNGS).toEqual(LEAN_BUILDER_RUNGS)
    expect(lifecycleResolveBuilderRung).toBe(resolveBuilderRung)
    expect(lifecycleResolveBuilderSeat).toBe(resolveBuilderSeat)
    expect(lifecycleResolvePhaseCompression).toBe(resolvePhaseCompression)
    expect(lifecycleResolveStickyBuilderOnReturn).toBe(resolveStickyBuilderOnReturn)
    expect(lifecycleCountUnmergedAccepted).toBe(countUnmergedAccepted)
    expect(lifecycleCanAdmitNextSlice).toBe(canAdmitNextSlice)
  })

  it('supports squadPreset: lean-4-seat and resolvePhaseCompression for P0/P1 vs P2-P4', () => {
    const leanP0 = resolveBuilderRung({
      workflowProfile: 'bounded',
      collaborationClass: 'linear',
      capabilityTier: 'lightweight',
      fileCount: 1,
      squadPreset: 'lean-4-seat',
    })
    expect(leanP0).toEqual({
      rung: 'P0',
      seat: 'dev.build',
      reason: 'bounded-lightweight',
      subagentDelegation: true,
      recommendedEffort: 'low',
    })

    const leanP2 = resolveBuilderRung({
      collaborationClass: 'council',
      squadPreset: 'lean-4-seat',
    })
    expect(leanP2).toEqual({
      rung: 'P2',
      seat: 'dev.build',
      reason: 'council/deep-reasoning',
      subagentDelegation: true,
      recommendedEffort: 'medium',
    })

    expect(resolvePhaseCompression({ rung: 'P0' })).toEqual({
      compositePass: true,
      phases: [3, 4, 5],
      externalGatePhases: [6, 7, 8],
      squadPreset: 'lean-4-seat',
      reason: 'bounded-composite-builder-pass',
    })
    expect(resolvePhaseCompression({ rung: 'P1' }).compositePass).toBe(true)
    expect(resolvePhaseCompression({ rung: 'P2' }).compositePass).toBe(false)
    expect(resolvePhaseCompression({ rung: 'P1', touchesOracles: true }).compositePass).toBe(false)
  })

  describe('resolveBuilderRung and resolveBuilderSeat', () => {
    it('routes bounded + linear + lightweight slices to P0 (dev.build-jr)', () => {
      const res = resolveBuilderRung({
        workflowProfile: 'bounded',
        collaborationClass: 'linear',
        capabilityTier: 'lightweight',
        fileCount: 1,
        touchSurface: ['src/utils/format.js'],
      })
      expect(res).toEqual({
        rung: 'P0',
        seat: 'dev.build-jr',
        reason: 'bounded-lightweight',
      })
      expect(
        resolveBuilderSeat({
          workflowProfile: 'bounded',
          collaborationClass: 'linear',
          capabilityTier: 'lightweight',
        }),
      ).toBe('dev.build-jr')
    })

    it('routes single-agent + light profile to P0 when fileCount <= 2', () => {
      const res = resolveBuilderRung({
        workflowProfile: 'light',
        collaborationClass: 'single-agent',
        capabilityTier: 'lightweight',
        fileCount: 2,
      })
      expect(res.rung).toBe('P0')
      expect(res.seat).toBe('dev.build-jr')
    })

    it('routes standard + bilateral + balanced slices to P1 (dev.build)', () => {
      const res = resolveBuilderRung({
        workflowProfile: 'standard',
        collaborationClass: 'bilateral',
        capabilityTier: 'balanced',
      })
      expect(res).toEqual({
        rung: 'P1',
        seat: 'dev.build',
        reason: 'standard-balanced',
      })
      expect(
        resolveBuilderSeat({
          workflowProfile: 'standard',
          collaborationClass: 'bilateral',
          capabilityTier: 'balanced',
        }),
      ).toBe('dev.build')
    })

    it('routes storage/locking/aliasing slices to P2 (dev.build-sr) even when fileCount === 1', () => {
      const storageRes = resolveBuilderRung({
        workflowProfile: 'bounded',
        collaborationClass: 'linear',
        capabilityTier: 'lightweight',
        fileCount: 1,
        touchSurface: ['src/storage/alias.rs'], // Issue #46
      })
      expect(storageRes).toEqual({
        rung: 'P2',
        seat: 'dev.build-sr',
        reason: 'consequence-floor',
      })

      const lockRes = resolveBuilderRung({
        workflowProfile: 'bounded',
        collaborationClass: 'linear',
        capabilityTier: 'lightweight',
        fileCount: 1,
        touchSurface: ['src/lock/hardlink.rs'], // Issue #47
      })
      expect(lockRes).toEqual({
        rung: 'P2',
        seat: 'dev.build-sr',
        reason: 'consequence-floor',
      })
    })

    it('routes council / architect-lead / deep-reasoning slices to P2 (dev.build-sr)', () => {
      const councilRes = resolveBuilderRung({
        collaborationClass: 'council',
      })
      expect(councilRes.rung).toBe('P2')
      expect(councilRes.seat).toBe('dev.build-sr')

      const leadRes = resolveBuilderRung({
        capabilityTier: 'architect-lead',
      })
      expect(leadRes.rung).toBe('P2')
      expect(leadRes.seat).toBe('dev.build-sr')

      const deepRes = resolveBuilderRung({
        capabilityTier: 'deep-reasoning',
      })
      expect(deepRes.rung).toBe('P2')
      expect(deepRes.seat).toBe('dev.build-sr')
    })

    it('routes high-assurance / human-gated slices to P4 (dev.build-sr)', () => {
      const haRes = resolveBuilderRung({
        workflowProfile: 'high-assurance',
      })
      expect(haRes).toEqual({
        rung: 'P4',
        seat: 'dev.build-sr',
        reason: 'high-assurance / human-gated',
      })

      const hgRes = resolveBuilderRung({
        collaborationClass: 'human-gated',
      })
      expect(hgRes).toEqual({
        rung: 'P4',
        seat: 'dev.build-sr',
        reason: 'high-assurance / human-gated',
      })
    })

    it('rejects any builder rung when touchesOracles: true or touchSurface includes tests/oracles/foo.json', () => {
      expect(() =>
        resolveBuilderRung({
          touchesOracles: true,
        }),
      ).toThrow('Builders (P0-P4) are barred from modifying tests/oracles/**')

      expect(() =>
        resolveBuilderRung({
          touchSurface: ['tests/oracles/schema.json'],
        }),
      ).toThrow('Builders (P0-P4) are barred from modifying tests/oracles/**')

      expect(() =>
        resolveBuilderRung({
          touchSurface: ['packages/sub/tests/oracles/cases.json'],
        }),
      ).toThrow('Builders (P0-P4) are barred from modifying tests/oracles/**')
    })
  })

  describe('resolveStickyBuilderOnReturn', () => {
    it('simulates 4 -> 3 -> 4 return on #30 (P0, dev.build-jr) and verifies dev.build-jr is preserved', () => {
      const res = resolveStickyBuilderOnReturn({
        previousSeat: 'dev.build-jr',
        previousRung: 'P0',
        updatedConsequenceFloor: 'standard',
        previousTouchSurface: ['src/cli/flag.js'],
        updatedTouchSurface: ['src/cli/flag.js'],
      })
      expect(res).toEqual({
        seat: 'dev.build-jr',
        rung: 'P0',
        sticky: true,
        escalated: false,
      })
    })

    it('verifies escalation to dev.build-sr only when updatedConsequenceFloor or updatedTouchSurface widens into high-consequence paths', () => {
      const resConsequence = resolveStickyBuilderOnReturn({
        previousSeat: 'dev.build-jr',
        previousRung: 'P0',
        updatedConsequenceFloor: 'high-consequence',
        previousTouchSurface: ['src/cli/flag.js'],
        updatedTouchSurface: ['src/cli/flag.js'],
      })
      expect(resConsequence).toEqual({
        seat: 'dev.build-sr',
        rung: 'P2',
        sticky: false,
        escalated: true,
        reason: 'consequence-floor-widened',
      })

      const resTouch = resolveStickyBuilderOnReturn({
        previousSeat: 'dev.build-jr',
        previousRung: 'P0',
        updatedConsequenceFloor: 'standard',
        previousTouchSurface: ['src/cli/flag.js'],
        updatedTouchSurface: ['src/cli/flag.js', 'src/storage/db.js'],
      })
      expect(resTouch).toEqual({
        seat: 'dev.build-sr',
        rung: 'P2',
        sticky: false,
        escalated: true,
        reason: 'consequence-floor-widened',
      })
    })

    it('escalates to dev.build (P1) when P0 touch surface widens beyond maxRungCeilingFiles without high consequence', () => {
      const res = resolveStickyBuilderOnReturn({
        previousSeat: 'dev.build-jr',
        previousRung: 'P0',
        updatedConsequenceFloor: 'standard',
        previousTouchSurface: ['src/cli/flag.js'],
        updatedTouchSurface: ['src/cli/flag.js', 'src/cli/help.js', 'src/cli/util.js'],
        maxRungCeilingFiles: 2,
      })
      expect(res).toEqual({
        seat: 'dev.build',
        rung: 'P1',
        sticky: false,
        escalated: true,
        reason: 'touch-surface-widened',
      })
    })

    it('preserves dev.build-sr when previous seat was dev.build-sr', () => {
      const res = resolveStickyBuilderOnReturn({
        previousSeat: 'dev.build-sr',
        previousRung: 'P2',
      })
      expect(res).toEqual({
        seat: 'dev.build-sr',
        rung: 'P2',
        sticky: true,
        escalated: false,
      })
    })
  })

  describe('countUnmergedAccepted and canAdmitNextSlice', () => {
    it('counts accepted/delivered slices that have not been integrated', () => {
      const boardRecords = [
        // Accepted on branch via phase 8 pass
        { id: 1, currentPhase: 8, status: 'pass', integrated: false },
        // Delivered (Awaiting-Integration)
        { id: 2, state: 'Delivered (Awaiting-Integration)' },
        // WIP at phase 8
        { id: 3, state: 'WIP', currentPhase: 8 },
        // Already integrated via flag
        { id: 4, currentPhase: 8, status: 'pass', integrated: true },
        // Already integrated via Delivered state
        { id: 5, state: 'Delivered' },
        // Already integrated via label
        { id: 6, state: 'Delivered (Awaiting-Integration)', labels: ['integrated:pr-42'] },
        // Early phase WIP
        { id: 7, state: 'WIP', currentPhase: 4 },
      ]

      expect(countUnmergedAccepted(boardRecords)).toBe(3)
    })

    it('returns ADMIT_OK when unmergedAccepted < 2', () => {
      const boardRecords = [{ id: 1, currentPhase: 8, status: 'pass', integrated: false }]
      const res = canAdmitNextSlice({ boardRecords, supervisorReachable: true })
      expect(res).toEqual({
        ok: true,
        status: 'ADMIT_OK',
        unmergedAccepted: 1,
        maxUnmergedAccepted: 2,
      })
    })

    it('returns PIPELINE_FULL when unmergedAccepted >= 2 (maxUnmergedAccepted = 2)', () => {
      const boardRecords = [
        { id: 1, currentPhase: 8, status: 'pass', integrated: false },
        { id: 2, state: 'Delivered (Awaiting-Integration)' },
      ]
      const res = canAdmitNextSlice({ boardRecords, supervisorReachable: true })
      expect(res).toEqual({
        ok: false,
        status: 'PIPELINE_FULL',
        unmergedAccepted: 2,
        maxUnmergedAccepted: 2,
      })
    })

    it('returns SUPERVISOR_UNREACHABLE when supervisorReachable: false and unmergedAccepted >= 1', () => {
      const boardRecords = [{ id: 1, currentPhase: 8, status: 'pass', integrated: false }]
      const res = canAdmitNextSlice({ boardRecords, supervisorReachable: false })
      expect(res).toEqual({
        ok: false,
        status: 'SUPERVISOR_UNREACHABLE',
        unmergedAccepted: 1,
        maxUnmergedAccepted: 2,
      })
    })

    it('returns ADMIT_OK when supervisorReachable: false but unmergedAccepted === 0', () => {
      const boardRecords = []
      const res = canAdmitNextSlice({ boardRecords, supervisorReachable: false })
      expect(res).toEqual({
        ok: true,
        status: 'ADMIT_OK',
        unmergedAccepted: 0,
        maxUnmergedAccepted: 2,
      })
    })
  })

  describe('lifecycle prompt reverse seam defect instructions', () => {
    it('contains updated Phase 4 return instructions mentioning RETURNS[4], Phase 3, and sticky builder affinity', () => {
      const lifecyclePath = resolve(__dirname, '../../adapters/openrig/lifecycle.mjs')
      const content = readFileSync(lifecyclePath, 'utf8')

      expect(content).toContain('RETURNS[4]')
      expect(content).toContain('Phase 3')
      expect(content).toContain('sticky builder')
      expect(content).toContain('affinity')

      // Check rendered output of siblingRecord for delivery squad
      const rendered = siblingRecord('delivery', 'agentflow-dev', 'agentflow-pm')
      expect(rendered).toContain('Reverse seam defect return:')
      expect(rendered).toContain('RETURNS[4] = [3, 1]')
      expect(rendered).toContain('Phase 3 for orch.arch planning/oracle addendum')
      expect(rendered).toContain(
        'preserving sticky builder seat affinity (dev.build-jr stays owner of P0 slices across 4 -> 3 -> 4)',
      )
    })
  })
})
