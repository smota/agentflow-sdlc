import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { planRigExecution } from '../../adapters/openrig/execution-plan.mjs'

const preview = JSON.parse(
  readFileSync(resolve('docs/operators/adoption-516/desired-execution.preview.json'), 'utf8'),
)
describe('held Dendro and AgentFlow adoption preview (#526)', () => {
  it('retains explicit holds and excludes live activation or historical run creation', () => {
    expect(preview).toMatchObject({
      mode: 'preview-only',
      activationAuthorized: false,
      admission: { held: true },
      actualRuntimeObservation: 'unknown',
      publication: 'existing-holds-preserved',
    })
    expect(preview.admission.reasons).toContain('dendro-backlog-paused')
    expect(preview.config).not.toHaveProperty('delivery')
    expect(preview.oracleWriter.defaultActive).toBe(false)
  })
  it.each(['agentflow', 'agentflow-product', 'agentflow-steer'])(
    'produces coherent desired contracts from actual %s source without installation',
    (base) => {
      const root = resolve('adapters/openrig', base)
      const result = planRigExecution({
        rigText: readFileSync(resolve(root, 'rig.yaml'), 'utf8'),
        configText: readFileSync(resolve(root, 'configurations.yaml'), 'utf8'),
        preset: 'all-codex',
        config: preview.config,
      })
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
      for (const pod of parse(result.rigText).pods)
        for (const member of pod.members) {
          const name = `${pod.id}.${member.id}`
          const desired = preview.config.adapters.openrig.executionPolicy.seats[name]
          expect(member).toMatchObject({
            runtime: desired.runtime,
            profile: desired.profile,
            effort: desired.effort,
            model: name === 'dev.build' ? 'munito/qwen/qwen3.8-27b' : desired.model,
          })
          const contract = result.contracts.find((item) => item.seat === name)
          expect(contract).toMatchObject(desired)
        }
    },
  )
  it('preserves calibration failures and requested-versus-observed provenance', () => {
    const report = JSON.parse(
      readFileSync(resolve('docs/operators/adoption-516/model-calibration.json'), 'utf8'),
    )
    expect(report.results).toHaveLength(5)
    expect(report.results.every((item) => item.actualRouteObservation === 'unverified')).toBe(true)
    expect(
      report.results.find((item) => item.requestedModel === 'google/gemma-4-12b').oracleMatched,
    ).toBe(false)
    expect(
      report.results.find((item) => item.requestedModel === 'deepseek-ai/deepseek-v4-flash')
        .priorDeepSeekSemanticFailureRetained,
    ).toBe(true)
  })
})
