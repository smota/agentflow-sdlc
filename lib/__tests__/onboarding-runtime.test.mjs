import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { buildRuntimeRequest, assessRuntimeEvidence } from '../onboarding/runtime-handoff.mjs'
import { CAPABILITY_CLI, CAPABILITY_SKILLS, SCHEMA_VERSION } from '../core/onboarding-state.mjs'

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/onboarding-runtime.schema.json', import.meta.url), 'utf8'),
)
const ajv = new Ajv()
const validateSchema = ajv.compile(schema)

describe('Generic runtime capability contract (S2 issue251)', () => {
  describe('buildRuntimeRequest', () => {
    it('builds standard v1 request with required capabilities and defaults', () => {
      const req = buildRuntimeRequest({ runtimeId: 'test-runtime' })
      expect(req.schemaVersion).toBe(SCHEMA_VERSION)
      expect(req.runtimeId).toBe('test-runtime')
      expect(req.additionalRuntimes).toEqual([])
      expect(req.sharedUpdate).toBe(false)
      expect(req.assessUpdates).toBe(true)
      expect(typeof req.requestId).toBe('string')
      expect(req.requestId.length).toBeGreaterThan(0)
      expect(req.requiredCapabilities).toHaveLength(2)
      expect(validateSchema(req)).toBe(true)
    })

    it('binds explicit additional runtimes and shared update scope', () => {
      const req = buildRuntimeRequest({
        runtimeId: 'primary-runtime',
        additionalRuntimes: ['secondary-runtime'],
        sharedUpdate: true,
        requestId: 'custom-req-123',
      })
      expect(req.requestId).toBe('custom-req-123')
      expect(req.sharedUpdate).toBe(true)
      expect(validateSchema(req)).toBe(true)
    })

    it('throws on invalid arguments', () => {
      expect(() => buildRuntimeRequest()).toThrow(TypeError)
      expect(() => buildRuntimeRequest({ runtimeId: '' })).toThrow(TypeError)
      expect(() => buildRuntimeRequest({ runtimeId: 'ok', sharedUpdate: 'not-bool' })).toThrow(
        TypeError,
      )
      expect(() => buildRuntimeRequest({ runtimeId: 'ok', additionalRuntimes: 'invalid' })).toThrow(
        TypeError,
      )
    })
  })

  describe('assessRuntimeEvidence and synthetic trials', () => {
    it('validates verified runtime Alpha matching schema and ready state', () => {
      const request = buildRuntimeRequest({
        runtimeId: 'alpha-runtime',
        requestId: 'req-alpha-001',
      })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-alpha-001',
        runtimeId: 'alpha-runtime',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'current',
            evidence: 'observed',
            version: '2.4.0',
            provenance: 'package-registry:agentflow-cli@2.4.0',
            updateEvidence: 'observed',
            updateProvenance: 'package-registry:agentflow-cli@2.4.0',
          },
          {
            id: CAPABILITY_SKILLS,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'current',
            evidence: 'observed',
            version: '2.4.0',
            provenance: 'runtime-catalog:agentflow-skills',
            hostDiscovered: true,
            updateEvidence: 'observed',
            updateProvenance: 'runtime-catalog:agentflow-skills',
          },
        ],
      }

      expect(validateSchema(evidence)).toBe(true)
      const assessment = assessRuntimeEvidence(request, evidence)
      expect(validateSchema(assessment)).toBe(true)
      expect(assessment.runtimeReady).toBe(true)
      expect(assessment.action).toBe('ready')
      expect(assessment.errors).toEqual([])
      expect(assessment.unknowns).toEqual([])
    })

    it('handles compatible deferred update without blocking adoption', () => {
      const request = buildRuntimeRequest({ runtimeId: 'beta-runtime', requestId: 'req-beta-002' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-beta-002',
        runtimeId: 'beta-runtime',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'deferred',
            evidence: 'observed',
            version: '2.3.9',
            provenance: 'container-mount:/opt/agentflow/bin/agentflow',
          },
          {
            id: CAPABILITY_SKILLS,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'deferred',
            evidence: 'observed',
            version: '2.3.9',
            provenance: 'container-mount:/opt/agentflow/skills',
            hostDiscovered: true,
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(true)
      expect(assessment.action).toBe('ready')
      expect(assessment.proposals).toEqual([
        expect.objectContaining({ type: 'deferred-update', componentId: CAPABILITY_CLI }),
        expect.objectContaining({ type: 'deferred-update', componentId: CAPABILITY_SKILLS }),
      ])
    })
  })

  describe('Adversarial and failure repros', () => {
    it('fails closed on hostDiscovered string "false" or non-boolean true', () => {
      const request = buildRuntimeRequest({ runtimeId: 'disc-rt', requestId: 'req-disc' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-disc',
        runtimeId: 'disc-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'valid-provenance',
          },
          {
            id: CAPABILITY_SKILLS,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'valid-provenance',
            hostDiscovered: 'false',
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(false)
      expect(assessment.unknowns).toContainEqual(
        expect.objectContaining({ componentId: CAPABILITY_SKILLS, field: 'hostDiscovered' }),
      )
    })

    it('rejects non-string or object provenance', () => {
      const request = buildRuntimeRequest({ runtimeId: 'prov-rt', requestId: 'req-prov' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-prov',
        runtimeId: 'prov-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: { invalid: 'object' },
          },
        ],
      }

      expect(validateSchema(evidence)).toBe(false)
      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(false)
      expect(assessment.errors).toContainEqual(
        expect.stringContaining('provenance must be a bounded non-empty string'),
      )
      expect(assessment.proposals).toEqual([])
    })

    it('rejects duplicate capability IDs as invalid and returns no actionable proposals', () => {
      const request = buildRuntimeRequest({ runtimeId: 'dup-rt', requestId: 'req-dup' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-dup',
        runtimeId: 'dup-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'missing',
            compatibility: 'unknown',
            operationOutcome: 'not-requested',
            updateDisposition: 'unknown',
            evidence: 'unavailable',
          },
          {
            id: CAPABILITY_CLI,
            presence: 'missing',
            compatibility: 'unknown',
            operationOutcome: 'not-requested',
            updateDisposition: 'unknown',
            evidence: 'unavailable',
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(false)
      expect(assessment.action).toBe('reconcile')
      expect(assessment.errors).toContainEqual(expect.stringContaining('Duplicate capability id'))
      expect(assessment.proposals).toEqual([])
    })

    it('treats missing component as UNKNOWN and never infers missing to propose install', () => {
      const request = buildRuntimeRequest({ runtimeId: 'missing-rt', requestId: 'req-miss' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-miss',
        runtimeId: 'missing-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'cli-prov',
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(false)
      expect(assessment.action).toBe('reconcile')
      const skillsComp = assessment.components.find((c) => c.id === CAPABILITY_SKILLS)
      expect(skillsComp.presence).toBe('unknown')
      expect(assessment.proposals).not.toContainEqual(
        expect.objectContaining({ type: 'install', componentId: CAPABILITY_SKILLS }),
      )
    })

    it('normalizes unverified available updateDisposition to unknown when release evidence is absent', () => {
      const request = buildRuntimeRequest({ runtimeId: 'up-rt', requestId: 'req-up' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-up',
        runtimeId: 'up-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'available',
            evidence: 'observed',
            provenance: 'cli-prov',
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      const cliComp = assessment.components.find((c) => c.id === CAPABILITY_CLI)
      expect(cliComp.updateDisposition).toBe('unknown')
      expect(assessment.proposals).not.toContainEqual(expect.objectContaining({ type: 'update' }))
    })

    it('proposes verified update when updateEvidence, updateProvenance, and availableVersion are present', () => {
      const request = buildRuntimeRequest({
        runtimeId: 'up-rt-2',
        requestId: 'req-up-2',
        sharedUpdate: true,
      })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-up-2',
        runtimeId: 'up-rt-2',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'available',
            evidence: 'observed',
            provenance: 'cli-prov',
            updateEvidence: 'observed',
            updateProvenance: 'registry-metadata',
            availableVersion: '3.0.0',
          },
          {
            id: CAPABILITY_SKILLS,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'skills-prov',
            hostDiscovered: true,
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(true)
      expect(assessment.proposals).toContainEqual(
        expect.objectContaining({
          type: 'update',
          componentId: CAPABILITY_CLI,
          shared: true,
        }),
      )
    })

    it('retains compatibility reuse orthogonal to release unknown', () => {
      const request = buildRuntimeRequest({ runtimeId: 'reuse-rt', requestId: 'req-reuse' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-reuse',
        runtimeId: 'reuse-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'cli-prov',
          },
          {
            id: CAPABILITY_SKILLS,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'skills-prov',
            hostDiscovered: true,
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(true)
      expect(assessment.action).toBe('ready')
    })

    it('suppresses install/update proposals on ambiguous unknown operationOutcome and requests reconcile', () => {
      const request = buildRuntimeRequest({ runtimeId: 'amb-rt', requestId: 'req-amb' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'req-amb',
        runtimeId: 'amb-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'missing',
            compatibility: 'unknown',
            operationOutcome: 'unknown',
            updateDisposition: 'unknown',
            evidence: 'unavailable',
          },
          {
            id: CAPABILITY_SKILLS,
            presence: 'available',
            compatibility: 'compatible',
            operationOutcome: 'succeeded',
            updateDisposition: 'unknown',
            evidence: 'observed',
            provenance: 'skills-prov',
            hostDiscovered: true,
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(false)
      expect(assessment.action).toBe('reconcile')
      expect(assessment.proposals).toEqual([])
      expect(assessment.unknowns).toContainEqual(
        expect.objectContaining({ componentId: CAPABILITY_CLI, field: 'operationOutcome' }),
      )
    })

    it('returns no actionable proposals on requestId/runtimeId mismatch or malformed evidence', () => {
      const request = buildRuntimeRequest({ runtimeId: 'target-rt', requestId: 'req-id-genuine' })
      const evidence = {
        schemaVersion: 1,
        requestId: 'spoofed-req',
        runtimeId: 'target-rt',
        components: [
          {
            id: CAPABILITY_CLI,
            presence: 'missing',
            compatibility: 'unknown',
            operationOutcome: 'not-requested',
            updateDisposition: 'unknown',
            evidence: 'unavailable',
          },
        ],
      }

      const assessment = assessRuntimeEvidence(request, evidence)
      expect(assessment.runtimeReady).toBe(false)
      expect(assessment.action).toBe('reconcile')
      expect(assessment.proposals).toEqual([])
      expect(assessment.errors).toContainEqual(
        expect.stringContaining('does not match request requestId'),
      )
    })

    it('strictly validates request version, booleans, bounds, and requiredCapabilities', () => {
      const validReq = buildRuntimeRequest({ runtimeId: 'valid-rt' })
      expect(() => assessRuntimeEvidence(null, {})).toThrow(TypeError)
      expect(() => assessRuntimeEvidence({ ...validReq, schemaVersion: 2 }, {})).toThrow(TypeError)
      expect(() => assessRuntimeEvidence({ ...validReq, sharedUpdate: 'not-a-bool' }, {})).toThrow(
        TypeError,
      )
      expect(() => assessRuntimeEvidence({ ...validReq, requiredCapabilities: [] }, {})).toThrow(
        TypeError,
      )
    })
  })
})
