import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { planRigExecution } from '../execution-plan.mjs'

const rigText = `# keep this rig comment
name: fixture
summary: >
  Existing summary remains.
pods:
  - id: dev
    members:
      - id: build
        model: antigravity/gemini-3.8-flash # explicit compatible pin
        effort: medium
        runtime: pi
        profile: builder-pi
        startup:
          files:
            - path: model:keep.md
`
const configText = `recommended: all-codex
seats:
  dev.build:
    runtimes:
      pi: builder-pi
      codex: builder
presets:
  all-codex:
    dev.build: codex
  keep-pi:
    dev.build: pi
`

describe('execution-plan consumer contract (#517)', () => {
  it('materializes a delivery runtime change with a matching model and profile despite field order', () => {
    const result = planRigExecution({ rigText, configText, preset: 'all-codex' })
    expect(result.ok).toBe(true)
    const member = parse(result.rigText).pods[0].members[0]
    expect(member).toMatchObject({ runtime: 'codex', profile: 'builder', model: 'gpt-6-astra' })
    expect(result.contracts[0]).toMatchObject({
      runtime: member.runtime,
      model: member.model,
      profile: member.profile,
    })
    expect(result.rigText).toContain('# keep this rig comment')
    expect(member.startup.files[0].path).toBe('model:keep.md')
  })

  it('preserves an explicit compatible pin and produces deterministic read-only previews', () => {
    const args = { rigText, configText, preset: 'keep-pi' }
    const one = planRigExecution(args)
    expect(one.ok).toBe(true)
    expect(parse(one.rigText).pods[0].members[0].model).toBe('antigravity/gemini-3.8-flash')
    expect(planRigExecution(args)).toEqual(one)
    expect(args.rigText).toBe(rigText)
  })

  it('rejects duplicate execution keys, duplicate presets and aliases instead of guessing', () => {
    expect(() =>
      planRigExecution({
        rigText: rigText.replace('runtime: pi', 'runtime: pi\n        runtime: codex'),
        configText,
      }),
    ).toThrow()
    expect(() =>
      planRigExecution({ rigText, configText: configText + '  all-codex:\n    dev.build: pi\n' }),
    ).toThrow()
    expect(() =>
      planRigExecution({
        rigText: rigText.replace('runtime: pi', 'runtime: &shared pi\n        model: *shared'),
        configText,
      }),
    ).toThrow()
  })

  it('rejects an incompatible explicit override before returning materialized output', () => {
    const result = planRigExecution({
      rigText,
      configText,
      overrides: { seats: { 'dev.build': { runtime: 'codex', model: 'claude-wrong' } } },
    })
    expect(result.ok).toBe(false)
    expect(result.rigText).toBeUndefined()
  })

  it('honors the selected preset in every shipped squad and retains the out-of-band eval seat', () => {
    for (const base of ['agentflow', 'agentflow-product', 'agentflow-steer']) {
      const root = resolve('adapters/openrig', base)
      const result = planRigExecution({
        rigText: readFileSync(resolve(root, 'rig.yaml'), 'utf8'),
        configText: readFileSync(resolve(root, 'configurations.yaml'), 'utf8'),
        preset: 'all-codex',
      })
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
      for (const contract of result.contracts.filter((c) => c.seat !== 'eval.tester'))
        expect(contract.runtime).toBe('codex')
      const output = parse(result.rigText)
      for (const pod of output.pods)
        for (const member of pod.members) {
          const c = result.contracts.find((c) => c.seat === `${pod.id}.${member.id}`)
          expect(member).toMatchObject({
            runtime: c.runtime,
            model: c.model,
            profile: c.profile,
            effort: c.effort,
          })
        }
      if (base === 'agentflow')
        expect(result.contracts.some((c) => c.seat === 'eval.tester')).toBe(true)
    }
  })
})
