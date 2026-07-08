import { describe, expect, it } from 'vitest'
import { validateReleaseNotesPerspective } from '../validate-release-closeout.mjs'

describe('release closeout validation', () => {
  it('accepts user-facing capability release notes', () => {
    const notes = `# Release v1.2.0

## Faster assisted updates for adopting projects

Teams can now plan framework updates with read-only discovery, approval gates, validation, and compatibility notes.

## Validation and compatibility

Validated with tests. No migration required.
`

    expect(validateReleaseNotesPerspective(notes)).toEqual({ ok: true, errors: [] })
  })

  it('rejects issue-led release notes', () => {
    const notes = `# Release v1.2.0

## Issue #123

- Implemented #123
`

    const result = validateReleaseNotesPerspective(notes)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('headings must lead with capabilities')
    expect(result.errors.join('\n')).toContain('must not lead with internal-only issue')
  })
})
