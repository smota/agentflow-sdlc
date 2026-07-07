import { describe, it, expect } from 'vitest'
import { replaceMarkdownSection } from '../issue-markdown.mjs'

describe('replaceMarkdownSection', () => {
  it('replaces an existing markdown section', () => {
    const body = '## Problem statement\n\nOld\n\n## Acceptance criteria\n\n- [ ] Before\n'

    const updated = replaceMarkdownSection(body, 'Acceptance criteria', '- [x] After', false)

    expect(updated).toBe('## Problem statement\n\nOld\n\n## Acceptance criteria\n\n- [x] After\n')
  })

  it('appends a missing section when allowed', () => {
    const body = '## Problem statement\n\nOld\n'

    const updated = replaceMarkdownSection(body, 'Test plan', '- deterministic', true)

    expect(updated).toBe('## Problem statement\n\nOld\n\n## Test plan\n\n- deterministic\n')
  })

  it('errors when the section is missing and creation is not allowed', () => {
    const body = '## Problem statement\n\nOld\n'

    expect(() => replaceMarkdownSection(body, 'Test plan', '- deterministic', false)).toThrow(
      /--create-if-missing/,
    )
  })

  it('replaces the last section even without a following heading', () => {
    const body = '## Problem statement\n\nOld\n\n## Open questions\n\nPending\n'

    const updated = replaceMarkdownSection(body, 'Open questions', 'Resolved.', false)

    expect(updated).toBe('## Problem statement\n\nOld\n\n## Open questions\n\nResolved.\n')
  })

  it('replaces the first section when there is no preamble', () => {
    const body = '## Scope\n\nBefore\n\n## Test plan\n\n- old\n'

    const updated = replaceMarkdownSection(body, 'Scope', 'After', false)

    expect(updated).toBe('## Scope\n\nAfter\n\n## Test plan\n\n- old\n')
  })

  it('rejects an empty section name', () => {
    expect(() => replaceMarkdownSection('## A\n', '   ', 'x', true)).toThrow(
      /Section name cannot be empty/,
    )
  })
})
