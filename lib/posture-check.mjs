import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_POSTURE } from './core/posture.mjs'

// D3 — posture-check is advisory ONLY. It inspects a target repo and warns when its capability
// (a test suite, CI, observation fixtures) cannot sustain the posture an adopter has configured.
// It never blocks, never returns a pass/fail verdict, and never gates promotion to a higher
// posture: moving to a higher posture is a config change a human makes, not an algorithmic unlock
// earned by a "clean track record" — that pattern is exactly the gate-fudging and gamified
// approval failure mode this release exists to prevent, so no such mechanism exists here.

const TEST_FILE_PATTERN = /\.test\.mjs$/

function hasTestSuite(root) {
  for (const dir of ['lib/__tests__', 'scripts/__tests__']) {
    const testsDir = resolve(root, dir)
    if (existsSync(testsDir) && readdirSync(testsDir).some((name) => TEST_FILE_PATTERN.test(name)))
      return true
  }
  return false
}

function hasCiWorkflow(root) {
  const workflows = resolve(root, '.github/workflows')
  return existsSync(workflows) && readdirSync(workflows).length > 0
}

function hasObservationFixtures(root) {
  return ['test/fixtures', '__fixtures__', 'lib/__fixtures__'].some((rel) =>
    existsSync(resolve(root, rel)),
  )
}

// checkPostureCapability({ posture, root }) -> { posture, root, warnings, advisoryOnly: true }
//
// There is deliberately no `ok`, `blocked`, or `passed` field: nothing about this result can be
// mistaken for a gate outcome, wired into CI, or used to suppress a posture. It only ever informs.
export function checkPostureCapability({ posture = DEFAULT_POSTURE, root = process.cwd() } = {}) {
  const warnings = []
  if (!hasTestSuite(root)) {
    warnings.push({
      code: 'posture-check.no-tests',
      message: `Posture '${posture}' presumes verifiable evidence, but no test suite was found under ${root}.`,
    })
  }
  if (!hasCiWorkflow(root)) {
    warnings.push({
      code: 'posture-check.no-ci',
      message: `Posture '${posture}' presumes durable, repeatable evidence from CI, but no CI workflow was found under ${root}.`,
    })
  }
  if (!hasObservationFixtures(root)) {
    warnings.push({
      code: 'posture-check.no-observation-fixtures',
      message: `Posture '${posture}' presumes observation fixtures for the adequacy gate, but none were found under ${root}.`,
    })
  }
  return Object.freeze({ posture, root, warnings, advisoryOnly: true })
}
