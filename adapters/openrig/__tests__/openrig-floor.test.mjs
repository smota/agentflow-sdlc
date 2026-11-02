import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const bundlePath = resolve(import.meta.dirname, '../agentflow/bundle.yaml')

describe('openrig compatibility floor (#554)', () => {
  it('requires OpenRig CLI and daemon 0.7.6', () => {
    const parsed = parse(readFileSync(bundlePath, 'utf8'))
    expect(parsed.compatibility.min_cli_version).toBe('0.7.6')
    expect(parsed.compatibility.min_daemon_version).toBe('0.7.6')
  })
})
