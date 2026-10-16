import { describe, expect, it } from 'vitest'
import { planRigExecution } from '../execution-plan.mjs'

describe('explicit provider route survives materialization (#517 review condition)', () => {
  it('does not double-prefix a custom gateway locator and matches canonical inventory', () => {
    const configText = `recommended: custom
seats:
  dev.build:
    runtimes:
      pi: builder-pi
presets:
  custom:
    dev.build:
      runtime: pi
      providerRoute: edge-gateway
      model: edge-gateway/qwen/test-model
`
    const args = {
      configText,
      rigText: `name: fixture
pods:
  - id: dev
    members:
      - id: build
        runtime: pi
        profile: builder-pi
        model: munito/qwen/old-model
        effort: medium
`,
      inventory: [
        { runtime: 'pi', providerRoute: 'edge-gateway', model: 'qwen/test-model', available: true },
      ],
    }
    const first = planRigExecution(args)
    expect(first.ok).toBe(true)
    expect(first.contracts[0]).toMatchObject({
      model: 'qwen/test-model',
      runnerModel: 'edge-gateway/qwen/test-model',
      support: 'supported',
    })
    const second = planRigExecution({ ...args, rigText: first.rigText })
    expect(second.ok).toBe(true)
    expect(second.rigText).toBe(first.rigText)
    expect(second.contracts[0].runnerModel).toBe('edge-gateway/qwen/test-model')
  })
})
