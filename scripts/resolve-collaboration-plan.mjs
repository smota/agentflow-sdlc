#!/usr/bin/env node
import { resolveCollaborationPlan, COLLABORATION_MODES } from '../lib/collaboration-plan.mjs'

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function flag(name) {
  return process.argv.includes(`--${name}`)
}

try {
  const result = resolveCollaborationPlan({
    issueNumber: arg('issue') ? Number(arg('issue')) : null,
    requestedMode: arg('mode', 'auto-minimal'),
    profile: arg('profile', 'standard'),
    risk: arg('risk', 'medium'),
    effort: arg('effort', 'medium'),
    uncertainty: arg('uncertainty', 'medium'),
    changeSurface: arg('change-surface', ''),
    broadDiscovery: flag('broad-discovery'),
    isolatedSpike: flag('isolated-spike'),
    executionTarget: arg('execution-target', 'pi-parent'),
  })
  if (flag('json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`[resolve-collaboration-plan] ${result.ok ? 'READY' : 'BLOCKED'}`)
    console.log(`mode: ${result.plan.collaborationMode}`)
    console.log(`reason: ${result.plan.reason}`)
    console.log(`helpers: ${result.plan.helpers.map((helper) => helper.role).join(', ') || 'none'}`)
    if (result.errors.length) console.log(`errors: ${result.errors.join('; ')}`)
  }
  process.exit(result.ok ? 0 : 1)
} catch (error) {
  console.error(error.message)
  console.error(`modes: ${COLLABORATION_MODES.join(', ')}`)
  process.exit(1)
}
