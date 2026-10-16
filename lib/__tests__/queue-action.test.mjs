import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACTIONS, ACTION_BOUNDARIES, validateDelegationPolicy } from '../core/delegation-grant.mjs'
describe('canonical queue creation action #521', () => {
  it('classifies delivery as an external effect with its own required boundary', () => {
    expect(ACTIONS.get('queue:create')).toBe(true)
    expect(ACTION_BOUNDARIES.get('queue:create')).toBe('external-action')
    expect(ACTION_BOUNDARIES.get('edit')).toBe('mutate-worktree')
  })
  it('keeps the portable schema and core action vocabulary aligned', () => {
    const schema = JSON.parse(readFileSync('schemas/delegation-grant.schema.json', 'utf8'))
    const enums = []
    const walk = (value) => {
      if (value && typeof value === 'object') {
        if (Array.isArray(value.enum) && value.enum.includes('rig:mutate')) enums.push(value.enum)
        Object.values(value).forEach(walk)
      }
    }
    walk(schema)
    expect(enums.length).toBeGreaterThan(0)
    expect(enums.every((values) => values.includes('queue:create'))).toBe(true)
  })
  it('does not add delivery to an existing issuer policy', () => {
    const policy = {
      version: 1,
      issuers: [
        {
          id: 'existing',
          mode: 'local-cooperative',
          origin: 'fixture',
          authorityRef: 'fixture',
          allowedActions: ['edit'],
          allowThroughMerge: false,
        },
      ],
      requiredChecks: [],
      reviewPolicy: 'automated',
      materiality: 'fixed-scope-v1',
      allowSubdelegation: false,
      safetyReserve: 1,
    }
    validateDelegationPolicy(policy)
    expect(policy.issuers[0].allowedActions).toEqual(['edit'])
  })
})
