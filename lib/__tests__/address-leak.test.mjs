// No private address leaks (#585). Property test: for random rosters and overlays, every string the
// router, the authority check, the queue notifier, the validators and the roster CLI produce is free
// of every overlay value; the only place an address goes is the queue row's destination, which is
// the delivery itself. Scan: committed roster docs, schemas, code and fixtures carry no address.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'
import {
  admitGateDecision,
  formatGateDecision,
  formatGateId,
  gateDecisionState,
} from '../roster/authority.mjs'
import {
  createQueueNotifier,
  deliverGate,
  nextRecipient,
  routeGate,
} from '../roster/gate-router.mjs'
import {
  TEAM_ROSTER_OVERLAY_PATH,
  loadTeamRoster,
  overlayValues,
  validateRosterOverlay,
  validateTeamRoster,
} from '../roster/team-roster.mjs'
import { createFilesystemSourceAdapter } from '../sources/filesystem-source.mjs'
import { main as rosterMain } from '../../scripts/roster.mjs'
import { main as validateMain } from '../../scripts/validate-team-roster.mjs'
import { privateAddress, rosterProject } from './fixtures/team-roster-fixtures.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

const GATE_TYPES = ['release-of-candidate', 'security-review', 'acceptance-review', 'merge']

function randomRoster(size, seed) {
  const ids = Array.from({ length: size }, (_, index) => `p${seed}-${index}`)
  return {
    version: 1,
    highAssurance: { distinctReviewers: seed % 2 === 0, allowSelfDeclaredWriters: seed % 3 === 0 },
    people: ids.map((id, index) => ({
      id,
      handles: { filesystem: `w-${id}` },
      scopes: [
        {
          gates: GATE_TYPES.filter((_, g) => (g + index + seed) % 2 === 0 || g === 0),
          ...(index % 3 === 0 ? {} : { paths: ['lib/**', 'docs/**'] }),
          tiers: ['standard', 'high-assurance'],
        },
      ],
      ...(size > 1 ? { backup: ids[(index + 1) % size] } : {}),
      timeoutMinutes: 30 + index,
      capacity: 1 + (index % 2),
    })),
  }
}

function overlayOf(roster) {
  return {
    version: 1,
    channels: Object.fromEntries(
      roster.people.map((person) => [person.id, { openrig: privateAddress(person.id) }]),
    ),
  }
}

function sink() {
  let text = ''
  return { write: (chunk) => (text += chunk), text: () => text }
}

function expectClean(strings, secrets) {
  for (const text of strings) {
    for (const secret of secrets)
      expect(text.includes(secret), 'an overlay value leaked').toBe(false)
  }
}

describe('overlay values never leave the delivery destination', () => {
  it('holds for router, notifier, authority, validators and CLI over random rosters', async () => {
    let opened = 0
    for (let seed = 1; seed <= 12; seed += 1) {
      const roster = randomRoster(1 + (seed % 4), seed)
      const overlay = overlayOf(roster)
      const secrets = overlayValues(overlay, roster)
      expect(secrets).toHaveLength(roster.people.length)
      expect(validateTeamRoster(roster)).toEqual({ ok: true, errors: [] })
      const produced = []
      const queue = createMemoryQueuePort()
      const notifierCalls = []
      const queueNotifier = createQueueNotifier({ queue, source: `agentflow-bridge@rig-${seed}` })
      const notifier = {
        async deliver(input) {
          notifierCalls.push(input)
          return queueNotifier.deliver(input)
        },
      }
      const root = tempDir('agentflow-leak-src-')
      const source = createFilesystemSourceAdapter({
        root,
        writer: 'agentflow-bot',
        trustedWriters: ['agentflow-bot'],
      })
      const now = new Date('2026-11-12T10:00:00.000Z')

      for (const type of GATE_TYPES) {
        for (const tier of ['standard', 'high-assurance']) {
          const digest = `${seed}`.padStart(12, '0')
          const gate = {
            id: formatGateId({
              ref: `filesystem:local#i-${seed}`,
              name: `${type}-${tier}`,
              digest,
            }),
            digest,
            type,
            tier,
            paths: ['lib/x.mjs'],
          }
          const routing = routeGate({ gate, roster, now })
          produced.push(JSON.stringify(routing))
          for (const at of [now, new Date(now.getTime() + 10 * 3_600_000)]) {
            const personId = nextRecipient({ routing, now: at, decided: false })
            produced.push(String(personId))
            if (!personId) continue
            const delivered = await deliverGate({
              routing,
              personId,
              roster,
              overlay,
              notifier,
              summary: `Gate ${type} waits on filesystem:local#i-${seed}`,
              evidenceRef: `filesystem:local#i-${seed}`,
            })
            produced.push(JSON.stringify(delivered))
          }
          const entries = roster.people.map((person, index) => ({
            writer: `w-${person.id}`,
            uri: `filesystem:local#i-${seed}/log/${index}`,
            edited: false,
            body: formatGateDecision({
              gate: gate.id,
              decision: 'agree',
              ...(tier === 'high-assurance'
                ? { review: index % 2 ? 'acceptance-review' : 'security-review' }
                : {}),
            }),
          }))
          entries.push({ writer: 'stranger', uri: 'x/1', body: entries[0].body })
          for (const item of entries) {
            const admitted = await admitGateDecision({ entry: item, gate, roster, adapter: source })
            if (admitted.opensGate) opened += 1
            produced.push(JSON.stringify(admitted))
          }
          produced.push(
            JSON.stringify(await gateDecisionState({ entries, gate, roster, adapter: source })),
          )
        }
      }

      // Every queue field except the destination; every notifier field except the address.
      for (const row of queue.rows()) {
        const { destination, ...rest } = row
        expect(secrets).toContain(destination)
        produced.push(JSON.stringify(rest))
      }
      for (const { address, ...rest } of notifierCalls) {
        expect(secrets).toContain(address)
        produced.push(JSON.stringify(rest))
      }

      // Broken overlays: errors name ids and paths only.
      const broken = structuredClone(overlay)
      broken.channels.stranger = { openrig: privateAddress('stranger') }
      broken.channels[privateAddress('key')] = { openrig: privateAddress('v') }
      broken.channels[`Secret Key ${seed}`] = { openrig: 'not-an-address value' }
      broken.channels[roster.people[0].id].extra = privateAddress('extra')
      produced.push(...validateRosterOverlay(broken, roster).errors)
      secrets.push(...overlayValues(broken, roster))
      expect(secrets).toContain('stranger')
      expect(secrets).toContain(`Secret Key ${seed}`)

      // CLI and validator output, with the valid and with the broken overlay on disk.
      for (const onDisk of [overlay, broken]) {
        const fx = rosterProject(() => tempDir('agentflow-leak-cli-'), { roster, overlay: onDisk })
        for (const argv of [
          ['validate'],
          ['validate', '--json'],
          ['route', '--gate', 'merge', '--paths', 'lib/a.mjs'],
          ['route', '--gate', 'security-review', '--tier', 'high-assurance', '--json'],
        ]) {
          const stdout = sink()
          const stderr = sink()
          await rosterMain(argv, { stdout, stderr, cwd: fx.dir, env: fx.env })
          produced.push(stdout.text(), stderr.text())
        }
        const out = sink()
        validateMain(['--json'], { stdout: out, cwd: fx.dir, env: fx.env })
        produced.push(out.text())
        try {
          loadTeamRoster(fx.dir, { env: fx.env })
        } catch (error) {
          produced.push(error.message)
        }
      }
      expectClean(produced, secrets)
    }
    // The property ran through real authorizations, not only refusals.
    expect(opened).toBeGreaterThan(0)
  })
})

describe('committed roster files carry no address', () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
  const GATEWAY_ADDRESS = /[A-Za-z0-9._-]+@external\b/
  const FILES = [
    'docs/team-roster.md',
    'docs/person-gates.md',
    'schemas/team-roster.schema.json',
    'schemas/team-roster-overlay.schema.json',
    'lib/roster/team-roster.mjs',
    'lib/roster/gate-router.mjs',
    'lib/roster/authority.mjs',
    'scripts/roster.mjs',
    'scripts/validate-team-roster.mjs',
    'lib/__tests__/fixtures/team-roster-fixtures.mjs',
    'lib/__tests__/team-roster.test.mjs',
    'lib/__tests__/gate-router.test.mjs',
    'lib/__tests__/gate-authority.test.mjs',
    'lib/__tests__/address-leak.test.mjs',
    'scripts/__tests__/validate-team-roster.test.mjs',
  ]

  it('scans roster docs, schemas, code and fixtures for e-mail and gateway addresses', () => {
    for (const file of FILES) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true)
      const text = readFileSync(join(repoRoot, file), 'utf8')
      expect(EMAIL.test(text), `${file} has an e-mail address`).toBe(false)
      expect(GATEWAY_ADDRESS.test(text), `${file} has a gateway address`).toBe(false)
    }
  })

  it('tracks no roster overlay and no roster file carrying an address', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split(
      '\n',
    )
    expect(tracked.filter((file) => file.endsWith('team-roster.local.json'))).toEqual([])
    for (const file of tracked.filter((name) => /team-roster[^/]*\.json$/.test(name))) {
      const text = readFileSync(join(repoRoot, file), 'utf8')
      expect(EMAIL.test(text) || GATEWAY_ADDRESS.test(text), file).toBe(false)
    }
  })

  it('keeps the overlay gitignored in this repository and in the OpenRig git excludes', async () => {
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', TEAM_ROSTER_OVERLAY_PATH], { cwd: repoRoot }),
    ).not.toThrow()
    const { GIT_EXCLUDES } = await import('../../adapters/openrig/lifecycle.mjs')
    expect(GIT_EXCLUDES).toContain(TEAM_ROSTER_OVERLAY_PATH)
  })
})
