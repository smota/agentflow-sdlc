import { describe, expect, it } from 'vitest'
import { formatSourceRef, parseSourceRef } from '../core/source-ref.mjs'

describe('source reference strings', () => {
  it('parses and formats a portable reference', () => {
    expect(parseSourceRef('github:smota/agentflow-sdlc#582')).toEqual({
      system: 'github',
      scope: 'smota/agentflow-sdlc',
      id: '582',
    })
    expect(parseSourceRef('filesystem:local#item-7')).toEqual({
      system: 'filesystem',
      scope: 'local',
      id: 'item-7',
    })
    expect(formatSourceRef({ system: 'filesystem', scope: 'local', id: 'item-7' })).toBe(
      'filesystem:local#item-7',
    )
    const text = 'github:smota/agentflow-sdlc#582'
    expect(formatSourceRef(parseSourceRef(text))).toBe(text)
  })

  it('returns null for text that is not a reference', () => {
    for (const text of [
      '',
      null,
      42,
      'github',
      'github:#1',
      ':scope#1',
      'github:scope#',
      'github:scope#1#2',
      'GitHub:scope#1',
      'github:sco pe#1',
    ]) {
      expect(parseSourceRef(text)).toBeNull()
    }
  })

  it('refuses to format parts that would not parse back', () => {
    expect(() => formatSourceRef({ system: 'github', scope: 'a#b', id: '1' })).toThrow(
      'invalid source reference',
    )
    expect(() => formatSourceRef({ system: '', scope: 'a', id: '1' })).toThrow()
    expect(() => formatSourceRef({ system: 'x', scope: 'a', id: '' })).toThrow()
  })
})
