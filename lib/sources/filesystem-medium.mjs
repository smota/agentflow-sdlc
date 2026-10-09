import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { phaseSpec, validateTransition } from '../core/phase-graph.mjs'

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

  function revision(state) {
    return digest({
      title: state.goal.title,
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
      transitions: state.transitions,
    }
  }

  return {
    id: 'filesystem',
    async createGoal({ title, body = '' }) {
      if (existsSync(goalPath)) throw new Error('A goal already exists in this medium')
      if (!title || !String(title).trim()) throw new Error('A goal title is required')
      mkdirSync(transitionDir, { recursive: true })
      const goal = { version: 1, title, body, createdAt: new Date().toISOString() }
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
  }
}
