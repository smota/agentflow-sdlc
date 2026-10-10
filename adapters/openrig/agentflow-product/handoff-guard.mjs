// Product seat send guard (issue 363). A product seat may not wake another seat directly: new work
// to delivery goes through `agentflow-sdlc handoff deliver`, which holds it while the delivery squad
// is busy. This file is installed with the product base and loaded by the seat's runtime:
//   - Claude Code: a PreToolUse hook runs it on every Bash call (exit 2 blocks the call).
//   - Pi: an extension in the seat's own agent directory imports it on every bash tool call.
// It has no imports, so it keeps working when the product checkout moves.

const PRODUCT_SEAT = /^pm-[^@\s]+@\S+$/

// Commands that put text into another seat's terminal or queue. Flags may come before the verb.
// They are matched against the shell words with quoting and escapes removed (see shellWords).
const DIRECT_SENDS = [
  { pattern: /\brig\s+(?:-\S+\s+)*send\b/, name: 'rig send' },
  {
    pattern:
      /\brig\s+(?:-\S+\s+)*queue\s+(?:-\S+\s+)*(?:create|handoff|handoff-and-complete|inbox-drop|fallback)\b/,
    name: 'rig queue create/handoff',
  },
  {
    pattern: /\btmux\s+(?:-\S+\s+)*(?:send-keys|send|paste-buffer|pasteb)\b/,
    name: 'tmux send-keys',
  },
  { pattern: /\bagentflow-sdlc\s+handoff\s+release\b/, name: 'agentflow-sdlc handoff release' },
  { pattern: /\bcli\.mjs\s+handoff\s+release\b/, name: 'agentflow-sdlc handoff release' },
  // A verb the guard cannot read before the shell runs it ($VERB, $(...), `...`) is held too.
  {
    pattern: /\b(?:rig|tmux)\s+(?:-\S+\s+)*(?:queue\s+(?:-\S+\s+)*)?[$`]/,
    name: 'a rig or tmux command with a computed verb',
  },
]

// The text the shell would see as words: line continuations, ANSI-C `$'`, quotes, and backslash
// escapes are removed, so `rig "send"`, `rig queue 'create'`, and `r\ig send` read as written.
export function shellWords(command) {
  return String(command ?? '')
    .replace(/\\\r?\n/g, '')
    .replace(/\$(?=['"])/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/['"]/g, '')
}

export function isProductSeat(session) {
  return typeof session === 'string' && PRODUCT_SEAT.test(session)
}

/** Decide one shell command. Only product seats are checked; every other session passes. */
export function guardDecision({ session, command }) {
  if (!isProductSeat(session)) return { block: false }
  const text = shellWords(command)
  const hit = DIRECT_SENDS.find((item) => item.pattern.test(text))
  if (!hit) return { block: false }
  return {
    block: true,
    reason:
      `Blocked for product seat ${session}: ${hit.name} is not a send path for this seat. ` +
      'Send with `agentflow-sdlc handoff deliver --to <session> --body-file <file> [--goal <uri>] [--transition <uri>] [--reply]`. ' +
      'It delivers now when the delivery squad is free and holds the handoff while it is busy. ' +
      'Only the person can release a held handoff. Put message text in --body-file, not in the command line.',
  }
}

// PreToolUse hook for Claude Code and Codex: the tool call arrives as JSON on stdin. Exit 2 blocks it
// and shows stderr to the agent. Any failure in a product seat blocks too.
export async function runHook({
  stdin = process.stdin,
  env = process.env,
  stderr = process.stderr,
} = {}) {
  const session = env.OPENRIG_SESSION_NAME
  if (!isProductSeat(session)) return 0
  try {
    let raw = ''
    for await (const chunk of stdin) raw += chunk
    const call = JSON.parse(raw || '{}')
    const command = call.tool_input?.command ?? call.tool_input?.cmd
    if (command === undefined || command === null) return 0
    const text = Array.isArray(command) ? command.join(' ') : String(command)
    const decision = guardDecision({ session, command: text })
    if (!decision.block) return 0
    stderr.write(`${decision.reason}\n`)
    return 2
  } catch (error) {
    stderr.write(`Product seat send guard failed closed: ${error.message}\n`)
    return 2
  }
}

// The hook command each runtime runs. Non-product sessions exit at once without loading anything;
// a product session that cannot load the installed guard is blocked.
export const HOOK_COMMAND =
  'node -e \'const s=process.env.OPENRIG_SESSION_NAME||"";if(!/^pm-[^@\\s]+@\\S+$/.test(s))process.exit(0);' +
  'const p=require(\"path\").join(require(\"os\").homedir(),\".openrig\",\"specs\",\"agentflow-product\",\"handoff-guard.mjs\");' +
  'import(require(\"url\").pathToFileURL(p).href).then(m=>m.runHook()).then(c=>process.exit(c),e=>{console.error(\"Product seat send guard unavailable: \"+e.message);process.exit(2)})' +
  "'"
