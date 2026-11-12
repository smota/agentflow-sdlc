// Shared team roster fixtures (#585). No committed file carries a channel address: test addresses
// are built at runtime by addressFor, so the address-leak scan of fixtures stays meaningful.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  TEAM_ROSTER_OVERLAY_PATH,
  TEAM_ROSTER_PATH,
  overlayPathFor,
  primaryCheckout,
} from '../../roster/team-roster.mjs'

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

// A git project with the roster committed at HEAD and the overlay in a config home outside the
// repository. `tempDir` makes (and registers for cleanup) a fresh directory.
// Returns { dir, env, overlayPath, git }.
export function rosterProject(
  tempDir,
  { roster, overlay, extra = {}, commit = true, ignoreOverlay = true } = {},
) {
  const base = tempDir()
  const dir = join(base, 'repo')
  const config = join(base, 'config')
  mkdirSync(dir, { recursive: true })
  const email = ['tester', 'example.invalid'].join('@')
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Tester',
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: 'Tester',
    GIT_COMMITTER_EMAIL: email,
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: gitEnv })
  git('init', '-q')
  const files = {
    ...(ignoreOverlay ? { '.gitignore': `${TEAM_ROSTER_OVERLAY_PATH}\n` } : {}),
    ...(roster ? { [TEAM_ROSTER_PATH]: roster } : {}),
    ...extra,
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  if (commit) {
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', 'fixture')
  }
  const env = { XDG_CONFIG_HOME: config }
  const overlayPath = overlayPathFor(primaryCheckout(dir), { env })
  if (overlay !== undefined) {
    mkdirSync(dirname(overlayPath), { recursive: true })
    writeFileSync(overlayPath, typeof overlay === 'string' ? overlay : JSON.stringify(overlay))
  }
  return { dir, env, overlayPath, git }
}
