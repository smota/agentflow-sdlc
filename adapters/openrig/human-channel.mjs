// Resolve a registered OpenRig person for a human gate (Issue #555).
// The token `human` is not an address. A shared channel never approves a decision.
// This module has zero dependencies so gateway hooks can load it anywhere Node runs.

const NOT_READY = 'Human channel is not ready. Run `rig gateway participants --json`.'
const NO_PERSON =
  'No person is registered. Run `rig gateway human add <entityId>`. Do not post a queue row.'
const NO_DEFAULT =
  'Several people are registered and no default is set. Run `rig gateway default <id>`.'

function isPerson(participant) {
  return (
    participant !== null &&
    typeof participant === 'object' &&
    participant.kind === 'person' &&
    typeof participant.address === 'string' &&
    participant.address.endsWith('@external')
  )
}

function personDestination(person) {
  const entityId =
    typeof person.id === 'string' && person.id !== ''
      ? person.id
      : person.address.slice(0, person.address.length - '@external'.length)
  return { ok: true, address: person.address, entityId }
}

/**
 * @param {unknown} record Live `rig gateway participants --json` payload.
 * @returns {{ ok: true, address: string, entityId: string } | { ok: false, reason: string }}
 */
export function resolveHumanDestination(record) {
  if (!record || record.ok !== true) {
    return { ok: false, reason: NOT_READY }
  }

  const participants = Array.isArray(record.participants) ? record.participants : []
  const people = participants.filter(isPerson)
  if (people.length === 0) {
    return { ok: false, reason: NO_PERSON }
  }

  const defaultId =
    record.default && typeof record.default.id === 'string' ? record.default.id : ''
  if (defaultId !== '') {
    const person = people.find((candidate) => candidate.id === defaultId)
    if (!person) {
      return {
        ok: false,
        reason: `The default id '${defaultId}' is not a registered person. Run \`rig gateway participants --json\`.`,
      }
    }
    return personDestination(person)
  }

  if (people.length === 1) return personDestination(people[0])
  return { ok: false, reason: NO_DEFAULT }
}
