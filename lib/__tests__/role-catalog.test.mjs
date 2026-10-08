import { describe, expect, it } from 'vitest'
import {
  canonicalRoleIdentity,
  createRoleHandoff,
  loadMethodCatalog,
  loadRoleCatalog,
  resolveRoleContract,
  validateRoleCatalog,
  validateRoleHandoff,
  validateRoleMethodConfig,
} from '../role-catalog.mjs'
import { createAcceptanceContract } from '../core/role-collaboration.mjs'
import { phaseZeroCollaboration } from './phase-zero-bootstrap.mjs'

const packageRoot = process.cwd()

describe('role product catalog', () => {
  it('defines nine lifecycle roles, one bootstrap predecessor, and one QA sidecar', () => {
    const result = validateRoleCatalog({ packageRoot })
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.catalog.roles.filter((role) => role.kind === 'lifecycle')).toHaveLength(9)
    expect(
      result.catalog.roles.filter((role) => role.kind === 'lifecycle').map((role) => role.phase),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(
      result.catalog.roles.filter((role) => role.kind === 'bootstrap').map((role) => role.slug),
    ).toEqual(['requester'])
    expect(
      result.catalog.roles.filter((role) => role.kind === 'sidecar').map((role) => role.slug),
    ).toEqual(['qa-expert'])
    const phaseZero = result.catalog.roles.find((role) => role.phase === 0)
    expect(phaseZero.qualifiedName).toBe('agentflow:product-manager')
    expect(phaseZero.acceptsFrom).toEqual(['agentflow:requester'])
    expect(phaseZero.sendsTo).toContain('agentflow:analyst')
    expect(result.transitionKeys.has('agentflow:requester->agentflow:product-manager')).toBe(true)
    expect(result.transitionKeys.has('agentflow:product-manager->agentflow:analyst')).toBe(true)
    const ownership = result.catalog.roles.flatMap((role) => role.owns)
    expect(new Set(ownership).size).toBe(ownership.length)
  })

  it('resolves current short and qualified product identities only', () => {
    const catalog = loadRoleCatalog(packageRoot)
    expect(canonicalRoleIdentity('product-manager', catalog)).toBe('agentflow:product-manager')
    expect(canonicalRoleIdentity('agentflow:implementation-planner', catalog)).toBe(
      'agentflow:implementation-planner',
    )
    expect(canonicalRoleIdentity('product-manager-jtbd', catalog)).toBeNull()
    expect(canonicalRoleIdentity('review', catalog)).toBeNull()
  })

  it('composes typed method parameters without changing role ownership or authority', () => {
    const base = loadRoleCatalog(packageRoot).roles.find((role) => role.slug === 'analyst')
    const result = resolveRoleContract({
      role: 'analyst',
      packageRoot,
      config: {
        roleMethods: {
          bindings: {
            'agentflow:analyst': [
              {
                method: 'agentflow:method:event-storming',
                parameters: { includeExternalActors: false },
              },
            ],
          },
        },
      },
    })
    expect(result.appliedMethods).toEqual([
      {
        id: 'agentflow:method:event-storming',
        parameters: { includeExternalActors: false },
      },
    ])
    expect(result.role.outputs).toContain('event-model')
    expect(result.role.owns).toEqual(base.owns)
    expect(result.role.authority).toEqual(base.authority)
    expect(() =>
      resolveRoleContract({
        role: 'analyst',
        packageRoot,
        config: {
          roleMethods: {
            bindings: {
              analyst: [
                { method: 'agentflow:method:event-storming', parameters: { unknown: true } },
              ],
            },
          },
        },
      }),
    ).toThrow('does not define parameter unknown')
  })

  it('validates digest-bound handoffs and rejects invalid transitions or drift', () => {
    const base = {
      id: 'handoff-1',
      subject: 'issue:188',
      state: 'issued',
      fromRole: 'agentflow:developer',
      toRole: 'agentflow:tester',
      rolePassId: 'phase-4',
      profile: 'standard',
      actionBoundary: 'observe',
      inputRefs: [],
      outputRefs: [
        {
          kind: 'implementation',
          system: 'git',
          uri: 'working-copy',
          authority: 'authoritative',
          relationship: 'implements',
        },
      ],
      validationRefs: [],
      expectedAction: 'run deterministic validation',
      acceptanceCriteria: ['implementation evidence is readable'],
      acceptanceContract: createAcceptanceContract({
        id: 'acceptance-1',
        subject: 'issue:188',
        ownerRole: 'agentflow:developer',
        deliveryRole: 'agentflow:tester',
        collaborationClass: 'bilateral',
        candidateDigest: 'a'.repeat(64),
        criteria: [
          {
            id: 'tests-readable',
            description: 'implementation evidence is readable',
            verification: 'deterministic',
            required: true,
          },
        ],
        councilPolicy: {
          required: false,
          seats: [],
          decisionOwner: 'agentflow:developer',
        },
      }),
      openQuestions: [],
      methodPlays: [],
      provenance: {
        platform: 'codex',
        executor: 'codex-cli',
        transport: 'local-cli',
        delegationBoundary: 'current-session',
      },
    }
    const handoff = createRoleHandoff(base)
    expect(validateRoleHandoff({ handoff, packageRoot }).ok).toBe(true)
    expect(
      validateRoleHandoff({ handoff: { ...handoff, expectedAction: 'changed' }, packageRoot }).ok,
    ).toBe(false)
    const invalid = createRoleHandoff({
      ...base,
      fromRole: 'agentflow:analyst',
      toRole: 'agentflow:developer',
    })
    expect(validateRoleHandoff({ handoff: invalid, packageRoot }).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'handoff.transition' })]),
    )
  })

  it('accepts the catalog bootstrap into phase 0 and rejects self, unknown, and missing edges', () => {
    const candidateDigest = 'a'.repeat(64)
    const valid = phaseZeroCollaboration({
      subject: 'issue:188',
      candidateDigest,
      description: 'problem and outcome are explicit',
    })
    expect(valid.senderId).toBe('agentflow:requester')
    expect(valid.senderId).not.toBe(valid.receiver.qualifiedName)
    expect(valid.contract.ownerRole).toBe(valid.senderId)
    expect(valid.contract.deliveryRole).toBe('agentflow:product-manager')
    const accepted = validateRoleHandoff({ handoff: valid.handoff, packageRoot })
    expect(accepted.ok).toBe(true)
    expect(accepted.findings).toEqual([])

    const outgoing = phaseZeroCollaboration({
      subject: 'issue:188',
      candidateDigest,
      fromRole: 'agentflow:product-manager',
      toRole: 'agentflow:analyst',
      description: 'acceptance criteria are testable',
      id: 'outgoing',
    })
    expect(validateRoleHandoff({ handoff: outgoing.handoff, packageRoot }).ok).toBe(true)

    const self = phaseZeroCollaboration({
      subject: 'issue:188',
      candidateDigest,
      fromRole: 'agentflow:product-manager',
      toRole: 'agentflow:product-manager',
      id: 'self',
    })
    const selfResult = validateRoleHandoff({ handoff: self.handoff, packageRoot })
    expect(selfResult.ok).toBe(false)
    expect(selfResult.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'handoff.transition',
          message: expect.stringContaining('agentflow:product-manager->agentflow:product-manager'),
        }),
      ]),
    )

    const missingEdge = phaseZeroCollaboration({
      subject: 'issue:188',
      candidateDigest,
      fromRole: 'agentflow:analyst',
      toRole: 'agentflow:product-manager',
      id: 'missing-edge',
    })
    const missingResult = validateRoleHandoff({ handoff: missingEdge.handoff, packageRoot })
    expect(missingResult.ok).toBe(false)
    expect(missingResult.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'handoff.transition' })]),
    )

    const unknown = createRoleHandoff({
      ...valid.handoff,
      fromRole: 'agentflow:unknown-sender',
      acceptanceContract: createAcceptanceContract({
        id: 'unknown-contract',
        subject: 'issue:188',
        ownerRole: 'agentflow:unknown-sender',
        deliveryRole: 'agentflow:product-manager',
        collaborationClass: 'linear',
        candidateDigest,
        criteria: [
          {
            id: 'check',
            description: 'problem and outcome are explicit',
            verification: 'deterministic',
            required: true,
          },
        ],
        councilPolicy: {
          required: false,
          seats: [],
          decisionOwner: 'agentflow:unknown-sender',
        },
      }),
      digest: '',
    })
    const unknownHandoff = createRoleHandoff(unknown)
    const unknownResult = validateRoleHandoff({ handoff: unknownHandoff, packageRoot })
    expect(unknownResult.ok).toBe(false)
    expect(unknownResult.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'handoff.from-role' })]),
    )
  })

  it('keeps methods as role-bound additive plays', () => {
    const catalog = loadRoleCatalog(packageRoot)
    const methods = loadMethodCatalog(packageRoot)
    expect(methods.methods).toHaveLength(9)
    for (const method of methods.methods) {
      expect(catalog.roles.some((role) => role.qualifiedName === method.role)).toBe(true)
      expect(method.adds).not.toHaveProperty('owns')
      expect(method.adds).not.toHaveProperty('authority')
      expect(method.adds).not.toHaveProperty('transitions')
    }
  })

  it('validates typed role method bindings as product configuration', () => {
    const valid = {
      roleMethods: {
        bindings: {
          'agentflow:analyst': [
            {
              method: 'agentflow:method:event-storming',
              parameters: { includeExternalActors: false },
            },
          ],
        },
      },
    }
    expect(validateRoleMethodConfig({ config: valid, packageRoot }).ok).toBe(true)

    const invalid = structuredClone(valid)
    invalid.roleMethods.bindings['agentflow:analyst'][0].method = 'agentflow:method:tdd'
    const result = validateRoleMethodConfig({ config: invalid, packageRoot })
    expect(result.ok).toBe(false)
    expect(result.findings.map((item) => item.message).join('\n')).toContain(
      'applies to agentflow:developer',
    )
  })
})
