import { describe, expect, it } from 'vitest'
import { validateProductDocument } from '../validate-product.mjs'

describe('validateProductDocument', () => {
  it('validates a compliant product document', () => {
    const valid = `
# Product Definition: Demo

## 1. Vision & Core Job-to-be-Done
When a developer initiates a build, I want to verify contracts, so I can deploy safely.

## 2. System Invariants
- INVARIANT 1: Zero data loss.

## 3. Intentions & Tradeoffs
- Determinism over speed.

## 4. Capability Map & Boundaries
| Capability ID | Module Responsibility | Boundary |
| :--- | :--- | :--- |
| \`core-auth\` | User authentication | JWT |

## 5. Active Horizon & Anti-Goals
- Anti-goals: No plaintext passwords.
    `
    const result = validateProductDocument(valid)
    expect(result.ok).toBe(true)
    expect(result.capabilities).toEqual(['core-auth'])
  })

  it('fails when canonical job statement is missing', () => {
    const invalid = `
# Product Definition: Demo
## 1. Vision & Core Job-to-be-Done
Build a web application.
## 2. System Invariants
## 3. Intentions & Tradeoffs
## 4. Capability Map & Boundaries
## 5. Active Horizon & Anti-Goals
    `
    const result = validateProductDocument(invalid)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('Job Statement'))).toBe(true)
  })

  it('fails when a required section is missing', () => {
    const missing = `
# Product Definition: Demo
## 1. Vision & Core Job-to-be-Done
When a user visits, I want to authenticate, so I can grant access.
## 2. System Invariants
    `
    const result = validateProductDocument(missing)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('Missing required section'))).toBe(true)
  })
})
