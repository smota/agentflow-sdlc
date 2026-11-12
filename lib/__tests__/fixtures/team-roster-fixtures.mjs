// Shared team roster fixtures (#585). No committed file carries a channel address: test addresses
// are built at runtime by addressFor, so the address-leak scan of fixtures stays meaningful.
import { randomBytes } from 'node:crypto'

export function addressFor(entity) {
  return [entity, 'external'].join('@')
}

// A unique, unguessable address per call, for property tests over overlay values.
export function privateAddress(prefix = 'p') {
  return addressFor(`${prefix}-${randomBytes(6).toString('hex')}`)
}

export function sampleRoster() {
  return {
    version: 1,
    people: [
      {
        id: 'sam',
        handles: { github: 'smota', filesystem: 'sam-writer' },
        scopes: [
          {
            gates: ['security-review', 'acceptance-review', 'release-of-candidate'],
            paths: ['lib/**', 'scripts/**'],
            tiers: ['standard', 'high-assurance'],
          },
        ],
        backup: 'ana',
        timeoutMinutes: 240,
        capacity: 3,
      },
      {
        id: 'ana',
        handles: { github: 'ana-dev' },
        scopes: [{ gates: ['security-review', 'release-of-candidate'], tiers: ['standard'] }],
      },
    ],
  }
}

export function overlayFor(roster, prefix = 'p') {
  return {
    version: 1,
    channels: Object.fromEntries(
      roster.people.map((person) => [
        person.id,
        { openrig: privateAddress(`${prefix}${person.id}`) },
      ]),
    ),
  }
}
