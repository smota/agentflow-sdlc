import fs from 'node:fs'
import path from 'node:path'

const ASSERTION_TYPES = new Set(['contains', 'not-contains', 'regex', 'json-valid'])

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

export function validateEvalManifest(manifest = {}) {
  const errors = []
  if (manifest.version !== 1) errors.push('manifest.version must be 1')
  for (const field of ['id', 'owner']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
      errors.push(`manifest.${field} is required`)
    }
  }
  if (!manifest.subject || typeof manifest.subject !== 'object') {
    errors.push('manifest.subject is required')
  } else {
    for (const field of ['kind', 'path']) {
      if (typeof manifest.subject[field] !== 'string' || !manifest.subject[field].trim()) {
        errors.push(`manifest.subject.${field} is required`)
      }
    }
  }
  if (
    manifest.threshold !== undefined &&
    (typeof manifest.threshold !== 'number' || manifest.threshold < 0 || manifest.threshold > 1)
  ) {
    errors.push('manifest.threshold must be between 0 and 1')
  }
  if (!Array.isArray(manifest.cases) || !manifest.cases.length) {
    errors.push('manifest.cases must be a non-empty array')
  }
  const ids = new Set()
  for (const [index, testCase] of (manifest.cases ?? []).entries()) {
    const prefix = `manifest.cases[${index}]`
    if (!testCase || typeof testCase !== 'object') {
      errors.push(`${prefix} must be an object`)
      continue
    }
    if (typeof testCase.id !== 'string' || !testCase.id.trim())
      errors.push(`${prefix}.id is required`)
    else if (ids.has(testCase.id)) errors.push(`${prefix}.id must be unique: ${testCase.id}`)
    else ids.add(testCase.id)
    if (typeof testCase.actual !== 'string' || !testCase.actual.trim())
      errors.push(`${prefix}.actual is required`)
    if (!Array.isArray(testCase.assertions) || !testCase.assertions.length) {
      errors.push(`${prefix}.assertions must be a non-empty array`)
      continue
    }
    for (const [assertionIndex, assertion] of testCase.assertions.entries()) {
      const assertionPrefix = `${prefix}.assertions[${assertionIndex}]`
      if (!ASSERTION_TYPES.has(assertion?.type)) {
        errors.push(`${assertionPrefix}.type is unsupported: ${assertion?.type ?? ''}`)
      }
      if (assertion?.type !== 'json-valid' && typeof assertion?.value !== 'string') {
        errors.push(`${assertionPrefix}.value must be a string`)
      }
      if (assertion?.type === 'regex' && typeof assertion.value === 'string') {
        try {
          new RegExp(assertion.value, assertion.flags ?? '')
        } catch {
          errors.push(`${assertionPrefix} contains an invalid regular expression`)
        }
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function evaluateAssertion(text, assertion) {
  if (assertion.type === 'contains') return text.includes(assertion.value)
  if (assertion.type === 'not-contains') return !text.includes(assertion.value)
  if (assertion.type === 'regex')
    return new RegExp(assertion.value, assertion.flags ?? '').test(text)
  if (assertion.type === 'json-valid') {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }
  return false
}

export function runEvalManifest(
  manifest,
  { manifestPath = process.cwd(), actualDir, rootDir } = {},
) {
  const validation = validateEvalManifest(manifest)
  if (!validation.ok) return { ok: false, status: 'invalid', errors: validation.errors, cases: [] }
  const base = path.dirname(path.resolve(manifestPath))
  const allowedRoot = path.resolve(rootDir ?? path.dirname(base))
  const results = manifest.cases.map((testCase) => {
    const actualPath = actualDir
      ? path.resolve(actualDir, `${testCase.id}.txt`)
      : path.resolve(base, testCase.actual)
    if (!isInside(allowedRoot, actualPath)) {
      return {
        id: testCase.id,
        ok: false,
        failures: ['actual output escapes eval root'],
        actualPath,
      }
    }
    if (!fs.existsSync(actualPath))
      return { id: testCase.id, ok: false, failures: ['actual output missing'], actualPath }
    const text = fs.readFileSync(actualPath, 'utf8')
    const failures = (testCase.assertions ?? [])
      .filter((assertion) => !evaluateAssertion(text, assertion))
      .map((assertion) => assertion.id ?? assertion.type)
    return { id: testCase.id, ok: failures.length === 0, failures, actualPath }
  })
  const passed = results.filter((item) => item.ok).length
  const threshold = manifest.threshold ?? 1
  const score = results.length ? passed / results.length : 0
  return {
    ok: score >= threshold,
    status: score >= threshold ? 'pass' : 'fail',
    score,
    threshold,
    passed,
    total: results.length,
    errors: [],
    cases: results,
  }
}
