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

const packageRoot = process.cwd()

describe('role product catalog', () => {
  it('defines nine lifecycle roles and one QA sidecar with exclusive ownership', () => {
    const result = validateRoleCatalog({ packageRoot })
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.catalog.roles.filter((role) => role.kind === 'lifecycle')).toHaveLength(9)
    expect(
      result.catalog.roles.filter((role) => role.kind === 'sidecar').map((role) => role.slug),
    ).toEqual(['qa-expert'])
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
