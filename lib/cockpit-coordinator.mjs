import { execFile } from 'node:child_process'
import { hasExecutionControl } from './cockpit-actions.mjs'

// Coordinator events (#421). When a project's own record names OpenRig and a DEV coordinator, the
// cockpit sends that coordinator two things: a start or resume naming the project and the goal,
// and the person's gate answer naming the answer, the gate, and the subject. It addresses no other
// seat. What the coordinator returns is shown as coordinator status, apart from the phase and the
// gate status. Nothing here reads or writes a gate: the person's line is filed before any send, so
// a coordinator that cannot be reached loses no answer, and a coordinator's reply moves no gate.

export const COORDINATOR_STATUS_LABEL = 'coordinator status'
export const COORDINATOR_UNREACHABLE = 'coordinator unreachable'

// A session address the execution layer can be handed as one argument. A leading `-` would read as
// an option, so it is not an address.
const ADDRESS = /^[^\s<>-][^\s<>]{0,199}$/u

/**
 * The DEV coordinator this project sends to, or null when it sends nothing. Only the project's own
 * binding counts: OpenRig as its execution layer and a DEV coordinator on its record.
 */
export function devCoordinatorFor(binding) {
  if (!binding?.supported || !hasExecutionControl(binding.executionLayer)) return null
  return binding.record?.coordinators?.dev ?? null
}

/** The start or resume request: the project and the goal, nothing else. */
export function startOrResumeEvent({ project, goal } = {}) {
  return { type: 'start-or-resume', project: required(project, 'project'), goal: goalOf(goal) }
}

/** The person's gate answer: the answer, the gate, and the subject, for one goal of one project. */
export function gateAnswerEvent({ project, goal, answer, gate, subject } = {}) {
  return {
    type: 'gate-answer',
    project: required(project, 'project'),
    goal: goalOf(goal),
    answer: required(answer, 'answer'),
    gate: digest(gate, 'gate'),
    subject: digest(subject, 'subject'),
  }
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`A coordinator event names the ${name}`)
  return value
}

function goalOf(goal) {
  const number = Number(goal)
  if (!Number.isInteger(number) || number < 1) throw new Error('A coordinator event names the goal')
  return number
}

function digest(value, name) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new Error(`A coordinator event names the ${name}`)
  return value
}

/** The one line the coordinator reads. It is the event, so nothing else rides along. */
export function coordinatorMessage(event) {
  return `agentflow-cockpit ${JSON.stringify(event)}`
}

/**
 * Sends one event to the project's DEV coordinator. Returns null when the project has no
 * coordinator, so nothing was sent. Otherwise returns the coordinator status: what the transport
 * returned, or `coordinator unreachable` when the event could not be built or sent. `event` may be
 * a function, so an event that cannot be built is reported rather than thrown.
 */
export async function sendCoordinatorEvent({ binding, event, transport = rigTransport } = {}) {
  const address = devCoordinatorFor(binding)
  if (!address) return null
  const shown = (status) => ({ label: COORDINATOR_STATUS_LABEL, to: address, status })
  if (!ADDRESS.test(address)) return shown(COORDINATOR_UNREACHABLE)
  try {
    const built = typeof event === 'function' ? event() : event
    const reply = await transport.send(address, coordinatorMessage(built))
    const status = typeof reply?.status === 'string' ? reply.status.trim() : ''
    return shown(status || COORDINATOR_UNREACHABLE)
  } catch {
    return shown(COORDINATOR_UNREACHABLE)
  }
}

/**
 * The cockpit answer box with a coordinator. The person's line is filed first, through `file`. Only
 * a filed answer is sent, and whatever the send returns, the filed answer stands.
 */
export async function answerThenTell({ binding, project, goal, file, transport } = {}) {
  const filed = await file()
  const coordinator = await sendCoordinatorEvent({
    binding,
    transport,
    event: () =>
      gateAnswerEvent({
        project,
        goal,
        answer: filed.attestation.decision,
        gate: filed.gateDigest,
        subject: filed.attestation.reviewedDigest,
      }),
  })
  return { filed, coordinator }
}

/** Start or resume: the cockpit's own write first, then one event when that write succeeded. */
export async function startThenTell({ binding, project, goal, write, transport } = {}) {
  const written = await write()
  if (!written?.ok) return { written, coordinator: null }
  const coordinator = await sendCoordinatorEvent({
    binding,
    transport,
    event: () => startOrResumeEvent({ project, goal }),
  })
  return { written, coordinator }
}

// OpenRig's own verb for reaching a session. The address and the message are separate arguments,
// with no shell, and a send that fails or hangs is reported as unreachable by the caller.
export const rigTransport = Object.freeze({
  send(address, message) {
    return new Promise((resolve, reject) => {
      execFile('rig', ['send', address, message], { timeout: 15000 }, (error) => {
        if (error) reject(error)
        else resolve({ status: 'delivered' })
      })
    })
  },
})
