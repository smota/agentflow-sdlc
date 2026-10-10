// Product seat send guard (issue 363). A product seat may not wake another seat directly: new work
// to delivery goes through `agentflow-sdlc handoff deliver`, which holds it while the delivery squad
// is busy. This file is installed with the product base and loaded by the seat's runtime:
//   - Claude Code: a PreToolUse hook runs it on every Bash call (exit 2 blocks the call).
//   - Pi: an extension in the seat's own agent directory imports it on every bash tool call.
// It has no imports, so it keeps working when the product checkout moves.

const PRODUCT_SEAT = /^pm-[^@\s]+@\S+$/

const RIG_QUEUE_SENDS = new Set([
  'create',
  'handoff',
  'handoff-and-complete',
  'inbox-drop',
  'fallback',
])
const TMUX_SENDS = new Set(['send-keys', 'send', 'paste-buffer', 'pasteb'])

// Fail-closed backstop on the decoded text: a command that names rig together with a send verb
// is held wherever the words sit (redirections, wrappers, `node -e`, `bash -c`, and so on).
const MENTIONS = [
  {
    pattern: /\brig\b[\s\S]*\bsend\b|\bsend\b[\s\S]*\brig\b/,
    name: 'rig send',
  },
  {
    pattern:
      /\brig\b[\s\S]*\bqueue\b[\s\S]*\b(?:create|handoff|handoff-and-complete|inbox-drop|fallback)\b/,
    name: 'rig queue create/handoff',
  },
  {
    pattern: /\btmux\b[\s\S]*\b(?:send-keys|send|paste-buffer|pasteb)\b/,
    name: 'tmux send-keys',
  },
  {
    pattern: /\b(?:agentflow-sdlc|cli\.mjs)\b[\s\S]*\bhandoff\s+release\b/,
    name: 'agentflow-sdlc handoff release',
  },
]

const ANSI_C = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
}

// Decode the body of an ANSI-C `$'...'` string starting at index i (after the quote).
function ansiC(text, i) {
  let out = ''
  while (i < text.length && text[i] !== "'") {
    if (text[i] !== '\\') {
      out += text[i++]
      continue
    }
    const c = text[i + 1]
    let m
    if ((m = /^x([0-9A-Fa-f]{1,2})/.exec(text.slice(i + 1)))) {
      out += String.fromCharCode(parseInt(m[1], 16))
      i += 1 + m[0].length
    } else if ((m = /^u([0-9A-Fa-f]{1,4})|^U([0-9A-Fa-f]{1,8})/.exec(text.slice(i + 1)))) {
      out += String.fromCodePoint(parseInt(m[1] ?? m[2], 16))
      i += 1 + m[0].length
    } else if ((m = /^[0-7]{1,3}/.exec(text.slice(i + 1)))) {
      out += String.fromCharCode(parseInt(m[0], 8))
      i += 1 + m[0].length
    } else if (c === 'c' && i + 2 < text.length) {
      out += String.fromCharCode(text.charCodeAt(i + 2) & 0x1f)
      i += 3
    } else {
      out += ANSI_C[c] ?? c ?? ''
      i += 2
    }
  }
  return { value: out, next: i + 1 }
}

/**
 * Split a shell command into tokens as the shell would read the words: quotes, `$'...'`, escapes,
 * and line continuations are decoded. A word is `{ word, computed }`, where computed means the
 * shell fills part of it at run time ($VAR, $(...), `...`, globs, braces). Separators are
 * `{ sep }` and redirection operators `{ redirect }`.
 */
export function shellTokens(command) {
  const text = String(command ?? '')
  const tokens = []
  let word = null
  const add = (value, computed = false) => {
    word ??= { word: '', computed: false }
    word.word += value
    if (computed) word.computed = true
  }
  const end = () => {
    if (word) tokens.push(word)
    word = null
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      if (text[i + 1] === '\n') i += 2
      else if (text[i + 1] === '\r' && text[i + 2] === '\n') i += 3
      else {
        add(text[i + 1] ?? '')
        i += 2
      }
    } else if (c === "'") {
      const close = text.indexOf("'", i + 1)
      const stop = close === -1 ? text.length : close
      add(text.slice(i + 1, stop))
      i = stop + 1
    } else if (c === '$' && text[i + 1] === "'") {
      const { value, next } = ansiC(text, i + 2)
      add(value)
      i = next
    } else if (c === '"' || (c === '$' && text[i + 1] === '"')) {
      i += c === '$' ? 2 : 1
      add('')
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && '$`"\\\n'.includes(text[i + 1])) {
          if (text[i + 1] !== '\n') add(text[i + 1])
          i += 2
        } else {
          add(text[i], text[i] === '$' || text[i] === '`')
          i += 1
        }
      }
      i += 1
    } else if (c === '$' || c === '`') {
      add(c, true)
      i += 1
    } else if ('*?[{'.includes(c)) {
      add(c, true)
      i += 1
    } else if (c === '#' && !word) {
      while (i < text.length && text[i] !== '\n') i += 1
    } else if (/\s/.test(c) && c !== '\n') {
      end()
      i += 1
    } else if (c === '<' || c === '>') {
      if (word && /^\d+$/.test(word.word) && !word.computed) word = null
      end()
      let op = c
      i += 1
      while (i < text.length && '<>&|-'.includes(text[i])) op += text[i++]
      tokens.push({ redirect: op })
    } else if (';&|\n()'.includes(c)) {
      end()
      tokens.push({ sep: c })
      i += 1
    } else {
      add(c)
      i += 1
    }
  }
  end()
  return tokens
}

function basename(word) {
  return word.slice(word.lastIndexOf('/') + 1)
}

// The words of each simple command, without redirections and their targets.
function simpleCommands(tokens) {
  const commands = [[]]
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.sep) commands.push([])
    else if (token.redirect) {
      if (!token.redirect.endsWith('&') || tokens[i + 1]?.word !== undefined) i += 1
    } else commands.at(-1).push(token)
  }
  return commands.filter((words) => words.length > 0)
}

// Find a send in one simple command: rig or tmux in any word position (wrappers such as env,
// command, sudo, xargs), then the first word that is not a flag. A verb the shell computes is held.
function structuralHit(words) {
  for (let i = 0; i < words.length; i += 1) {
    const name = words[i].computed ? '' : basename(words[i].word)
    const assigned = /^[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(words[i].word)?.[1]
    if (assigned !== undefined && ['rig', 'tmux'].includes(basename(assigned.split(/\s/)[0]))) {
      return 'rig or tmux through a variable'
    }
    if (name !== 'rig' && name !== 'tmux') continue
    const rest = words.slice(i + 1).filter((word) => word.computed || !word.word.startsWith('-'))
    const verb = rest[0]
    if (!verb) continue
    if (verb.computed) return `a ${name} command with a computed verb`
    if (name === 'tmux' && TMUX_SENDS.has(verb.word)) return 'tmux send-keys'
    if (name === 'rig' && verb.word === 'send') return 'rig send'
    if (name === 'rig' && verb.word === 'queue' && rest[1]) {
      if (rest[1].computed) return 'a rig queue command with a computed verb'
      if (RIG_QUEUE_SENDS.has(rest[1].word)) return 'rig queue create/handoff'
    }
  }
  return null
}

/** The name of the direct send in a shell command, or null. Words with spaces are read again. */
export function directSend(command, depth = 0) {
  const tokens = shellTokens(command)
  const decoded = tokens.map((token) => token.word ?? token.sep ?? token.redirect).join(' ')
  const mention = MENTIONS.find((item) => item.pattern.test(decoded))
  if (mention) return mention.name
  for (const words of simpleCommands(tokens)) {
    const hit = structuralHit(words)
    if (hit) return hit
    if (depth < 4) {
      for (const word of words) {
        if (/[\s;&|()]/.test(word.word)) {
          const inner = directSend(word.word, depth + 1)
          if (inner) return inner
        }
      }
    }
  }
  return null
}

export function isProductSeat(session) {
  return typeof session === 'string' && PRODUCT_SEAT.test(session)
}

/** Decide one shell command. Only product seats are checked; every other session passes. */
export function guardDecision({ session, command }) {
  if (!isProductSeat(session)) return { block: false }
  const hit = directSend(command)
  if (!hit) return { block: false }
  return {
    block: true,
    reason:
      `Blocked for product seat ${session}: ${hit} is not a send path for this seat. ` +
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
