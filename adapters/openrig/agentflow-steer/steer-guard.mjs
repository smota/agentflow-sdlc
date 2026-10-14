// Steering seat safety guard (Issue #481).
// The external supervisory steering seat operates strictly out-of-rig and is barred from:
//   1. Modifying repository files or authoring code
//   2. Executing git commit, git push, or git merge
//   3. Advance internal squad delivery phases (agentflow-sdlc handoff deliver)
//   4. Direct messaging or queueing tasks to builder or test seats (dev.build*, dev.qa, dev.test-eng)
//   5. Sending keystroke interrupts (^C)
//
// This file is installed with the steer rig base and loaded by harness PreToolUse hooks:
//   - Claude Code: PreToolUse hook on Bash and file modification tools.
//   - Codex: PreToolUse hook in codex.toml.
//   - Pi: Pre-tool extension.
// It has zero external dependencies so it works reliably in any node environment.

const STEER_SEAT = /^steer(?:-[^@\s]+)?@\S+$/

const PROHIBITED_GIT_COMMANDS = [
  { pattern: /\bgit\b[\s\S]*\bcommit\b/, name: 'git commit' },
  { pattern: /\bgit\b[\s\S]*\bpush\b/, name: 'git push' },
  { pattern: /\bgit\b[\s\S]*\bmerge\b/, name: 'git merge' },
  { pattern: /\bgit\b[\s\S]*\bcherry-pick\b/, name: 'git cherry-pick' },
  { pattern: /\bgit\b[\s\S]*\brebase\b/, name: 'git rebase' },
  { pattern: /\bgit\b[\s\S]*\bworktree\s+add\b/, name: 'git worktree add' },
]

const PROHIBITED_DELIVERY_COMMANDS = [
  {
    pattern: /\b(?:agentflow-sdlc|cli\.mjs)\b[\s\S]*\bhandoff\s+deliver\b/,
    name: 'agentflow-sdlc handoff deliver',
  },
]

const PROHIBITED_KEYSTROKE_INTERRUPTS = [
  { pattern: /\brig\s+send\b[\s\S]*(?:\^C|\x03)/, name: 'rig send keystroke interrupt (^C)' },
  { pattern: /\btmux\s+send-keys\b[\s\S]*C-c/, name: 'tmux send-keys C-c' },
]

const PROHIBITED_TARGET_SEATS = [
  /\b(?:dev-build|builder|dev-qa|qa|dev-test-eng|test-eng|rev-review|reviewer|pm-analyst|analyst)@/i,
  /\b(?:builder-jr|builder-sr|build|test-eng-pi|builder-pi)\b/i,
]

const ALLOWED_TARGET_SEATS = [
  /\b(?:pm-manager|manager)@/i,
  /\b(?:orch-arch|architect)@/i,
  /\bhuman\b/i,
]

export function isSteerSeat(session) {
  if (typeof session !== 'string') return false
  const trimmed = session.trim()
  return STEER_SEAT.test(trimmed) || trimmed === 'steer.lead'
}

/** Check if command contains unauthorized queue sends or direct messages */
export function checkTargetRouting(command) {
  const isRigSend = /\brig\s+send\s+([^\s"']+)/.exec(command)
  if (isRigSend) {
    const target = isRigSend[1]
    if (ALLOWED_TARGET_SEATS.some((re) => re.test(target))) return null
    if (PROHIBITED_TARGET_SEATS.some((re) => re.test(target))) {
      return `rig send to in-rig squad member '${target}'`
    }
    return `rig send to unrecognized target '${target}'`
  }

  const isQueueCreate = /\brig\s+queue\s+create\b[\s\S]*--(?:destination|seat)\s+([^\s"']+)/.exec(
    command,
  )
  if (isQueueCreate) {
    const target = isQueueCreate[1]
    if (ALLOWED_TARGET_SEATS.some((re) => re.test(target))) return null
    if (PROHIBITED_TARGET_SEATS.some((re) => re.test(target))) {
      return `rig queue create to in-rig squad member '${target}'`
    }
  }

  return null
}

/**
 * Evaluates whether a tool invocation or shell command is permitted for a steering seat.
 */
export function guardDecision({ session, command = '', toolName = '' } = {}) {
  if (!isSteerSeat(session)) return { block: false }

  // Check file modification tool names
  const lowerTool = String(toolName).toLowerCase()
  if (
    lowerTool.includes('write') ||
    lowerTool.includes('edit') ||
    lowerTool.includes('replacefilecontent') ||
    lowerTool.includes('createfile')
  ) {
    return {
      block: true,
      reason: `Blocked for steering seat ${session}: direct file modification tool '${toolName}' is prohibited. The steering plane operates strictly read-only on code and repository assets.`,
    }
  }

  if (!command) return { block: false }

  // Check git mutations
  for (const item of PROHIBITED_GIT_COMMANDS) {
    if (item.pattern.test(command)) {
      return {
        block: true,
        reason: `Blocked for steering seat ${session}: '${item.name}' is prohibited. Steering seats must never modify git history, branches, or worktrees.`,
      }
    }
  }

  // Check delivery handoffs
  for (const item of PROHIBITED_DELIVERY_COMMANDS) {
    if (item.pattern.test(command)) {
      return {
        block: true,
        reason: `Blocked for steering seat ${session}: '${item.name}' is prohibited. Internal delivery handoffs are governed strictly by in-rig delivery agents under agentflow-orchestrator.`,
      }
    }
  }

  // Check keystroke interrupts
  for (const item of PROHIBITED_KEYSTROKE_INTERRUPTS) {
    if (item.pattern.test(command)) {
      return {
        block: true,
        reason: `Blocked for steering seat ${session}: '${item.name}' is prohibited. Keystroke interrupts corrupt terminal processes. Use calibrated queue triage and nudge instead.`,
      }
    }
  }

  // Check target routing allowlist
  const routeViolation = checkTargetRouting(command)
  if (routeViolation) {
    return {
      block: true,
      reason: `Blocked for steering seat ${session}: ${routeViolation} violates the Target Routing Allowlist. Steering seats communicate exclusively with 'pm.manager' (goal intake), 'orch.arch' (delivery sync/unfreeze), or 'human' (gates). Direct communication with builders or testers is prohibited.`,
    }
  }

  return { block: false }
}

/**
 * PreToolUse hook handler for Claude Code, Codex, and Pi runtimes.
 * Receives tool call JSON on stdin. Exits with 2 to block prohibited execution.
 */
export async function runHook({
  stdin = process.stdin,
  env = process.env,
  stderr = process.stderr,
} = {}) {
  const session = env.OPENRIG_SESSION_NAME
  if (!isSteerSeat(session)) return 0

  try {
    let raw = ''
    for await (const chunk of stdin) raw += chunk
    const call = JSON.parse(raw || '{}')

    const toolName = call.tool_name || call.name || ''
    const command = call.tool_input?.command ?? call.tool_input?.cmd ?? ''
    const text = Array.isArray(command) ? command.join(' ') : String(command)

    const decision = guardDecision({ session, command: text, toolName })
    if (!decision.block) return 0

    stderr.write(`${decision.reason}\n`)
    return 2
  } catch (error) {
    stderr.write(`Steering seat safety guard failed closed: ${error.message}\n`)
    return 2
  }
}

// Standalone CLI helper
if (process.argv[1]?.endsWith('steer-guard.mjs')) {
  const args = process.argv.slice(2)
  if (args.includes('--check')) {
    const cmdIndex = args.indexOf('--check') + 1
    const command = args[cmdIndex] || ''
    const session = process.env.OPENRIG_SESSION_NAME || 'steer.lead'
    const decision = guardDecision({ session, command })
    if (decision.block) {
      console.error(decision.reason)
      process.exit(2)
    }
    console.log('ALLOWED')
    process.exit(0)
  }
}
