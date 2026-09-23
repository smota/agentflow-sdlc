import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveConfigAuthority } from './authority.mjs'
import { loadSdlcConfig } from '../sdlc-state.mjs'
import { inspectHarnessIntelligence } from './harness-intelligence.mjs'
import { resolvePosture } from '../core/posture.mjs'

export function inspectEffectiveConfig({ targetDir = process.cwd() } = {}) {
  const root = resolve(targetDir)
  const authority = resolveConfigAuthority(root)
  const domain = loadSdlcConfig(root)

  const workflowPath = join(root, 'agent-workflow.config.json')
  let workflow = {}
  if (existsSync(workflowPath)) {
    try {
      workflow = JSON.parse(readFileSync(workflowPath, 'utf8'))
    } catch {
      workflow = { parseError: true }
    }
  }

  const harnessIntelligence = inspectHarnessIntelligence(root)
  const postureName = workflow.posture || 'assisted'
  let resolvedPosture = null
  try {
    resolvedPosture = resolvePosture({
      posture: postureName,
      changeClass: 'standard',
      config: workflow,
    })
  } catch {
    resolvedPosture = { posture: postureName, resolved: false }
  }

  return {
    targetDir: root,
    authority: {
      domainPath: authority.domainPath,
      workflowPath: authority.workflowPath,
      valid: authority.validation.ok,
    },
    posture: {
      configured: postureName,
      effective: resolvedPosture,
    },
    workflow: {
      ciCommands: workflow.ciCommands || [],
      branching: workflow.branching || {},
      routing: workflow.routing || { defaultMode: 'single-agent' },
      collaboration: workflow.collaboration || {},
      bounded: workflow.bounded || {},
      extensions: workflow.extensions || { enabledPacks: [] },
    },
    harnessIntelligence,
    domain: {
      version: domain.version,
      paths: domain.paths || {},
      actionPolicy: domain.actionPolicy || {},
      deliveryPolicy: domain.deliveryPolicy || {},
    },
  }
}
