// A portable source reference: `<system>:<scope>#<id>`, e.g. `github:smota/agentflow-sdlc#582`.
// The adapter that owns `system` turns the parsed parts into its native reference (toReference).
const SYSTEM = /^[a-z][a-z0-9-]*$/
const PART = /^[^\s#]+$/
const REFERENCE = /^([a-z][a-z0-9-]*):([^\s#]+)#([^\s#]+)$/

export function parseSourceRef(text) {
  if (typeof text !== 'string') return null
  const match = text.match(REFERENCE)
  if (!match) return null
  return { system: match[1], scope: match[2], id: match[3] }
}

export function formatSourceRef({ system, scope, id } = {}) {
  if (!SYSTEM.test(system ?? '') || !PART.test(scope ?? '') || !PART.test(String(id ?? ''))) {
    throw new Error(`invalid source reference parts: ${JSON.stringify({ system, scope, id })}`)
  }
  return `${system}:${scope}#${id}`
}
