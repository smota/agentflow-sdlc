import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACTIONS, ACTION_BOUNDARIES, validateDelegationPolicy } from '../core/delegation-grant.mjs'

const policy = (actions) => ({
  version: 1,
  issuers: [
    {
      id: 'operator',
      mode: 'local-cooperative',
      origin: 'fixture',
      authorityRef: 'fixture://approval',
      allowedActions: actions,
      allowThroughMerge: false,
    },
  ],
  requiredChecks: ['tests'],
  reviewPolicy: 'human',
  materiality: 'fixed-scope-v1',
  allowSubdelegation: false,
  safetyReserve: 2,
})
describe('explicit rig mutation delegation vocabulary #523', () => {
  it('classifies rig mutation as an external effect at the external-action boundary', () => {
    expect(ACTIONS.get('rig:mutate')).toBe(true)
    expect(ACTION_BOUNDARIES.get('rig:mutate')).toBe('external-action')
  })
  it('permits an explicit issuer capability without expanding existing edit policies', () => {
    expect(() => validateDelegationPolicy(policy(['rig:mutate']))).not.toThrow()
    const existing = policy(['edit'])
    expect(validateDelegationPolicy(existing).issuers[0].allowedActions).toEqual(['edit'])
  })
  it('keeps the wire schema action vocabulary aligned', () => {
    const schema = JSON.parse(readFileSync('schemas/delegation-grant.schema.json', 'utf8'))
    expect(schema.properties.binding.properties.allowedActions.items.enum).toContain('rig:mutate')
  })
})
