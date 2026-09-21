import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The run service must be governed by the TARGET project's configuration and posture. It used to
// load config from process.cwd() - the framework checkout on the documented entry path - and always
// used the default posture, so an adopter's own choices were silently ignored.
const captured = []
vi.mock('../../lib/application/run-service.mjs', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createRunService: (options) => {
      captured.push(options)
      return { status: async () => ({ state: 'active' }) }
    },
  }
})

const { runDelivery } = await import('../run-delivery.mjs')

function targetProject({ posture }) {
  const root = mkdtempSync(join(tmpdir(), 'agentflow-target-wiring-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1\n')
  const defaults = JSON.parse(readFileSync('defaults/sdlc.config.json', 'utf8'))
  defaults.labels = { ...defaults.labels, type: [...defaults.labels.type, 'target-only-label'] }
  writeFileSync(join(root, 'sdlc.config.json'), JSON.stringify(defaults))
  writeFileSync(
    join(root, 'agent-workflow.config.json'),
    JSON.stringify({
      posture,
      delivery: { source: { kind: 'local-preview' }, candidate: { inputs: ['src/a.js'] } },
    }),
  )
  return root
}

describe('run CLI governs a run with the target project’s own configuration', () => {
  it('passes the target’s posture and sdlc config to the run service, not the working directory’s', async () => {
    captured.length = 0
    const root = targetProject({ posture: 'autonomous' })
    await runDelivery(['status', 'demo', '--target', root], { emit: () => {} })

    expect(captured).toHaveLength(1)
    expect(captured[0].posture).toBe('autonomous')
    expect(captured[0].sdlcConfig.labels.type).toContain('target-only-label')
  })

  it('leaves the posture to the service default when the target configures none', async () => {
    captured.length = 0
    const root = targetProject({ posture: undefined })
    await runDelivery(['status', 'demo', '--target', root], { emit: () => {} })

    expect(captured[0].posture).toBeUndefined()
  })
})
