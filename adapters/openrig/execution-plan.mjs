import { parseDocument } from 'yaml'
import { resolveExecutionContracts } from '../../lib/config/execution-contract.mjs'

// Parse once before lifecycle writes. Duplicate keys and alias expansion are never a source of
// implicit precedence. Keeping the document preserves comments and unrelated OpenRig fields.
export function executionDocument(text, label = 'execution YAML') {
  const document = parseDocument(text, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`${label}: ${document.errors[0].message}`)
  document.toJS({ maxAliasCount: 0 })
  return document
}

export function parseExecutionYaml(text, label) {
  const value = executionDocument(text, label).toJS({ maxAliasCount: 0 })
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label ?? 'execution YAML'} must be a mapping`)
  }
  return value
}

export function planRigExecution({
  rigText,
  configText,
  preset,
  config = {},
  overrides = {},
  inventory = null,
}) {
  const document = executionDocument(rigText, 'rig')
  const rig = document.toJS({ maxAliasCount: 0 })
  const bundleConfig = parseExecutionYaml(configText, 'bundle configurations')
  const selectedPreset = preset ?? bundleConfig.recommended
  const resolved = resolveExecutionContracts({
    rig,
    bundleConfig,
    preset: selectedPreset,
    config,
    overrides,
    inventory,
  })
  if (!resolved.ok) return { ...resolved, preset: selectedPreset }
  const contracts = resolved.contracts

  for (let podIndex = 0; podIndex < rig.pods.length; podIndex += 1) {
    const pod = rig.pods[podIndex]
    for (let memberIndex = 0; memberIndex < pod.members.length; memberIndex += 1) {
      const member = pod.members[memberIndex]
      const contract = contracts.find((item) => item.seat === `${pod.id}.${member.id}`)
      for (const field of ['runtime', 'model', 'effort', 'profile']) {
        document.setIn(
          ['pods', podIndex, 'members', memberIndex, field],
          field === 'model' ? contract.runnerModel : contract[field],
        )
      }
    }
  }
  return { ...resolved, contracts, preset: selectedPreset, rigText: document.toString() }
}
