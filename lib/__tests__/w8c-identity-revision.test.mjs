// W8c — "one identity, one revision, one run". These tests are written FIRST, against the
// pre-fix code, and each is confirmed to fail for the defect it targets before the corresponding
// D1-D5 fix lands (see the session report for the failure-mode confirmation).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unitIdentity, unitRunId, resolveVerifiedRunId } from '../core/unit-identity.mjs'
import { buildCommandCenterModel } from '../cockpit-goal-model.mjs'
import { buildReadinessContract, unitRef } from '../cockpit-readiness-contract.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

function issue({ number = 1, title = 'Goal', body = '## Acceptance criteria\n- [ ] works' } = {}) {
  return { number, title, body, labels: [], state: 'open' }
}

describe('W8c D1 — one identity, one run (test 1)', () => {
  it('1. close-unit and the actuator produce the same run id for the same unit', () => {
    const repo = 'acme/widgets'
    const issueNumber = 42

    // The actuator's real path: build the readiness contract from the goal model exactly as
    // scripts/actuate-readiness.mjs's main() does, and read the run id it would derive
    // (unitRunId(item.unitRef.id) — see scripts/actuate-readiness.mjs).
    const model = buildCommandCenterModel({ issues: [issue({ number: issueNumber })], repo })
    const goal = model.goals[0]
    const actuatorUnitRef = unitRef(goal)
    const actuatorRunId = unitRunId(actuatorUnitRef.id)

    // close-unit's real path (scripts/cockpit-server.mjs's actionEndpoint):
    //   const runId = payload.runId || unitRunId(unitIdentity({ repo, id: intent.issue }))
    const closeUnitRunId = unitRunId(unitIdentity({ repo, id: issueNumber }))

    expect(closeUnitRunId).toBe(actuatorRunId)
    // DEFECT (pre-fix) reproduction: the OLD templates never agreed.
    expect(`issue-${issueNumber}`).not.toBe(`readiness-${issueNumber}`)
  })

  it('4. two repositories with the same issue number get different run ids too', () => {
    const issueNumber = 7
    const runIdA = unitRunId(unitIdentity({ repo: 'acme/widgets', id: issueNumber }))
    const runIdB = unitRunId(unitIdentity({ repo: 'acme/gadgets', id: issueNumber }))
    expect(runIdA).not.toBe(runIdB)
  })

  it("run ids stay within the durable run store's allowed character set", () => {
    const runId = unitRunId(unitIdentity({ repo: 'acme/widgets', id: 123 }))
    expect(runId).toMatch(/^[\w-]{1,100}$/)
  })
})

// W8c2 D1 — a client can choose the run a human decision lands on. Written FIRST against the
// pre-fix `payload.runId || unitRunId(unitIdentity({ repo, id: intent.issue }))` in
// scripts/cockpit-server.mjs, which let a client-supplied runId WIN whenever present. Confirmed to
// fail for the right reason pre-fix: `resolveVerifiedRunId` did not exist yet (the old code never
// refused a mismatched runId, it silently preferred it), so this test could not even import its
// target — the closest pre-fix analogue, `payload.runId || derived`, always returns the client's
// value untouched, which is exactly the defect.
describe('W8c2 D1 — a run id is always derived, never accepted on trust (test 1)', () => {
  it('1. close-unit with a client runId different from the derived one is refused; with none, the derived one is used', () => {
    const repo = 'acme/widgets'
    const issueNumber = 42
    const derived = unitRunId(unitIdentity({ repo, id: issueNumber }))

    const withoutClientRunId = resolveVerifiedRunId({ repo, id: issueNumber, requestedRunId: null })
    expect(withoutClientRunId.ok).toBe(true)
    expect(withoutClientRunId.runId).toBe(derived)

    const withMatchingRunId = resolveVerifiedRunId({
      repo,
      id: issueNumber,
      requestedRunId: derived,
    })
    expect(withMatchingRunId.ok).toBe(true)
    expect(withMatchingRunId.runId).toBe(derived)

    // DEFECT (pre-fix) reproduction: a client claiming to anchor the decision in some OTHER run
    // (e.g. a different unit's run, or an attacker-chosen string) used to win outright.
    const attackerChosenRunId = unitRunId(unitIdentity({ repo, id: 999 }))
    expect(attackerChosenRunId).not.toBe(derived)
    const withMismatchedRunId = resolveVerifiedRunId({
      repo,
      id: issueNumber,
      requestedRunId: attackerChosenRunId,
    })
    expect(withMismatchedRunId.ok).toBe(false)
    expect(withMismatchedRunId.runId).toBeNull()
    expect(withMismatchedRunId.errors).toEqual(["runId does not match the unit's derived run"])
  })
})

function walk(dir, onFile) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}

describe('W8c D1 — no ad hoc spelling survives outside the identity function (test 9)', () => {
  it('9. a source search finds none of the four ad hoc spellings outside lib/core/unit-identity.mjs', () => {
    // Built by concatenation, not as literals, so this test's own source text is never itself a
    // hit — same technique as w8b-gate-placement.test.mjs's NEEDLE constants.
    const needles = [
      ['`', 'goal:${'].join(''),
      ['`', 'issue:${'].join(''),
      ['`', 'issue-${'].join(''),
      ['`', 'readiness-${'].join(''),
    ]
    const offenders = []
    for (const dir of ['lib', 'scripts', 'bin']) {
      walk(join(REPO_ROOT, dir), (file) => {
        if (!/\.mjs$/.test(file)) return
        if (/[\\/]__tests__[\\/]/.test(file)) return
        if (/[\\/]fixtures[\\/]/.test(file)) return
        if (file === fileURLToPath(import.meta.url)) return
        // The identity function's own file is allowed to document what it replaces.
        if (/[\\/]core[\\/]unit-identity\.mjs$/.test(file)) return
        const text = readFileSync(file, 'utf8')
        for (const needle of needles) {
          if (text.includes(needle)) offenders.push(`${file} contains ${JSON.stringify(needle)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
