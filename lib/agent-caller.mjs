// Environment markers that agent runtimes set for the commands they run. A person's own terminal
// sets none of them. This is the local trust model, not proof of identity: it stops an agent
// runtime from recording a person's answer, and it does not authenticate the person.
export const AGENT_RUNTIME_MARKERS = Object.freeze([
  { name: 'AI_AGENT', runtime: 'agent runtime' },
  { name: 'CLAUDECODE', runtime: 'Claude Code' },
  { name: 'CLAUDE_CODE_ENTRYPOINT', runtime: 'Claude Code' },
  { name: 'CODEX_SANDBOX', runtime: 'Codex' },
  { name: 'CODEX_SANDBOX_NETWORK_DISABLED', runtime: 'Codex' },
  { name: 'CODEX_THREAD_ID', runtime: 'Codex' },
  { name: 'OPENRIG_SESSION_NAME', runtime: 'an OpenRig seat' },
  { name: 'OPENRIG_NODE_ID', runtime: 'an OpenRig seat' },
])

/** Returns the agent runtime this process runs under, or null for a non-agent caller. */
export function detectAgentRuntime(env = process.env) {
  for (const marker of AGENT_RUNTIME_MARKERS) {
    const value = env?.[marker.name]
    if (typeof value === 'string' && value.trim()) return { ...marker }
  }
  return null
}
