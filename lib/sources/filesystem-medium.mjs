import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { phaseSpec, validateTransition } from '../core/phase-graph.mjs'
import { admitGateEntry, gateView } from '../core/person-gates.mjs'
import { validateOpen } from '../core/work-altitude.mjs'

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function createFilesystemMedium({ root }) {
  if (!root) throw new Error('A filesystem medium requires a root directory')
  const goalPath = join(root, 'goal.json')
  const transitionDir = join(root, 'transitions')
  // Person gates sit beside the goal. They are not transitions and never move a phase.
  const gatesPath = join(root, 'gates.json')

  function readGateLog() {
    return existsSync(gatesPath) ? readJson(gatesPath).entries : []
  }

  function load() {
    if (!existsSync(goalPath)) return null
    const goal = readJson(goalPath)
    const names = existsSync(transitionDir)
      ? readdirSync(transitionDir)
          .filter((name) => name.endsWith('.json'))
          .sort()
      : []
    const transitions = names.map((name) => readJson(join(transitionDir, name)))
    return { goal, transitions }
  }

  // A gate binds to this revision, so it covers everything a person accepts, not only the title.
  function revision(state) {
    const { title, body, kind = null, parent = null, changeClass = null } = state.goal
    return digest({
      title,
      body,
      kind,
      parent,
      changeClass,
      keys: state.transitions.map((item) => item.idempotencyKey),
    })
  }

  function present(state) {
    return {
      system: 'filesystem',
      uri: root,
      revision: revision(state),
      title: state.goal.title,
      body: state.goal.body,
      kind: state.goal.kind ?? null,
      parent: state.goal.parent ?? null,
      changeClass: state.goal.changeClass ?? null,
      admission: state.goal.admission ?? null,
      transitions: state.transitions,
      gates: gateView(readGateLog()),
    }
  }

  return {
    id: 'filesystem',
    async createGoal({
      title,
      body = '',
      kind = null,
      parent = null,
      changeClass = null,
      consent = null,
    }) {
      if (existsSync(goalPath)) throw new Error('A goal already exists in this medium')
      if (!title || !String(title).trim()) throw new Error('A goal title is required')
      // No kind is a legacy record: it opens as before and is never checked as a goal.
      const opened = kind ? validateOpen({ record: { kind, changeClass }, parent, consent }) : {}
      mkdirSync(transitionDir, { recursive: true })
      const admission = opened.admission ?? null
      const work = kind ? { kind, parent: parent?.uri ?? null, changeClass, admission } : {}
      const goal = { version: 1, title, body, ...work, createdAt: new Date().toISOString() }
      writeFileSync(goalPath, `${JSON.stringify(goal, null, 2)}\n`)
      return present({ goal, transitions: [] })
    },
    async appendTransition({ phase, status, seat, reason = null, body = '', idempotencyKey }) {
      const state = load()
      if (!state) throw new Error('Create a goal before appending a transition')
      if (!idempotencyKey) throw new Error('A transition idempotency key is required')
      const existing = state.transitions.find((item) => item.idempotencyKey === idempotencyKey)
      if (existing) return { goal: present(state), transition: existing, duplicate: true }
      const checked = validateTransition({
        transitions: state.transitions,
        phase,
        status,
        seat,
        reason,
      })
      const record = {
        version: 1,
        ...checked,
        role: phaseSpec(checked.phase).role,
        body,
        idempotencyKey,
        uri: `transitions/${String(state.transitions.length + 1).padStart(4, '0')}.json`,
      }
      writeFileSync(join(root, record.uri), `${JSON.stringify(record, null, 2)}\n`)
      const next = { goal: state.goal, transitions: [...state.transitions, record] }
      return { goal: present(next), transition: record, duplicate: false }
    },
    async readGoal() {
      const state = load()
      if (!state) throw new Error('No goal exists in this medium')
      return present(state)
    },
    async readGateLog() {
      if (!load()) throw new Error('No goal exists in this medium')
      return readGateLog()
    },
    async appendGateEntry(entry) {
      const state = load()
      if (!state) throw new Error('Create a goal before opening a gate')
      const log = readGateLog()
      const admitted = admitGateEntry(log, entry)
      if (admitted) {
        writeFileSync(
          gatesPath,
          `${JSON.stringify({ version: 1, entries: [...log, admitted] }, null, 2)}\n`,
        )
      }
      return present(state)
    },
  }
}
