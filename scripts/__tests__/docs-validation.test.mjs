import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateDocs } from '../validate-docs.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

describe('documentation validation', () => {
  it('keeps local links, role hubs, headings, and CLI command names valid', () => {
    expect(validateDocs(repoRoot)).toEqual(expect.objectContaining({ ok: true, errors: [] }))
  })
})
