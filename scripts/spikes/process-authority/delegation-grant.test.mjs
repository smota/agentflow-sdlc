import test from 'node:test'
import assert from 'node:assert'
import { DelegationGrantIssuer } from './delegation-grant.mjs'

test('issues and resolves grant', () => {
  const issuer = new DelegationGrantIssuer()
  const req = {
    planDigest: 'a'.repeat(64),
    repository: 'owner/repo',
    base: 'main',
    allowedPaths: ['src/*'],
    allowedActions: ['push'],
    maxAttempts: 3,
    maxExternalEffects: 1,
    expiry: new Date(Date.now() + 10000).toISOString(),
    issuerMode: 'local-cooperative',
  }
  const grant = issuer.issue(req)

  const res = issuer.resolve(grant, {
    operationDigest: 'b'.repeat(64),
    planDigest: 'a'.repeat(64),
    repository: 'owner/repo',
    base: 'main',
    action: 'push',
    path: 'src/main.js',
    isExternalEffect: true,
  })
  assert.strictEqual(res.admitted, true)

  const res2 = issuer.resolve(grant, {
    operationDigest: 'b'.repeat(64), // Replay
    planDigest: 'a'.repeat(64),
    repository: 'owner/repo',
    base: 'main',
    action: 'push',
    path: 'src/main.js',
    isExternalEffect: true,
  })
  assert.strictEqual(res2.admitted, false)
  assert.match(res2.reason, /REPLAY/)
})

test('rejects path traversal', () => {
  const issuer = new DelegationGrantIssuer()
  const grant = issuer.issue({
    planDigest: 'a'.repeat(64),
    repository: 'owner/repo',
    base: 'main',
    allowedPaths: ['src/*'],
    allowedActions: ['push'],
    maxAttempts: 3,
    maxExternalEffects: 1,
    expiry: new Date(Date.now() + 10000).toISOString(),
    issuerMode: 'local-cooperative',
  })

  const res = issuer.resolve(grant, {
    operationDigest: 'c'.repeat(64),
    planDigest: 'a'.repeat(64),
    repository: 'owner/repo',
    base: 'main',
    action: 'push',
    path: 'src/../outside.txt',
    isExternalEffect: true,
  })
  assert.strictEqual(res.admitted, false)
  assert.match(res.reason, /SCOPE: path/)
})

test('rejects unsupported subdelegation', () => {
  const issuer = new DelegationGrantIssuer()
  assert.throws(() => issuer.issueChild(), /UNSUPPORTED: Subdelegation is out of scope/)
})

test('rejects hard ceilings', () => {
  const issuer = new DelegationGrantIssuer()
  assert.throws(
    () =>
      issuer.issue({
        planDigest: 'a'.repeat(64),
        repository: 'owner/repo',
        base: 'main',
        allowedPaths: ['src/*'],
        allowedActions: ['push'],
        maxAttempts: 3,
        maxExternalEffects: 1,
        expiry: new Date(Date.now() + 10000).toISOString(),
        issuerMode: 'local-cooperative',
        hardCeiling: 100,
      }),
    /UNSUPPORTED: This spike has no enforcing provider adapter/,
  )
})

const requestFixture = (overrides = {}) => ({
  planDigest: 'a'.repeat(64),
  repository: 'owner/repo',
  base: 'main',
  allowedPaths: ['src/*'],
  allowedActions: ['push'],
  maxAttempts: 3,
  maxExternalEffects: 1,
  expiry: new Date(Date.now() + 60000).toISOString(),
  issuerMode: 'local-cooperative',
  ...overrides,
})
const operationFixture = (overrides = {}) => ({
  planDigest: 'a'.repeat(64),
  repository: 'owner/repo',
  base: 'main',
  operationDigest: 'b'.repeat(64),
  path: 'src/main.js',
  action: 'push',
  ...overrides,
})

test('caller cannot hide an external action from the budget', () => {
  for (const isExternalEffect of [false, undefined, null, 0]) {
    const issuer = new DelegationGrantIssuer()
    const grant = issuer.issue(requestFixture({ maxExternalEffects: 0 }))
    assert.match(
      issuer.resolve(grant, operationFixture({ isExternalEffect })).reason,
      /external effects exhausted/,
    )
  }
})

test('rejects noncanonical paths and malformed patterns before admission', () => {
  for (const path of [
    'src/./file',
    'src//file',
    'src/../file',
    '/src/file',
    'C:/src/file',
    'src/file.',
    'src/file ',
    'src/file\0',
    'src\\file',
  ]) {
    const issuer = new DelegationGrantIssuer()
    const grant = issuer.issue(requestFixture())
    assert.equal(issuer.resolve(grant, operationFixture({ path })).admitted, false, path)
  }
  for (const pattern of [null, 3, '', '../*', 'src/./*', 'src//*']) {
    assert.throws(
      () => new DelegationGrantIssuer().issue(requestFixture({ allowedPaths: [pattern] })),
      /Invalid allowed path/,
    )
  }
})

test('scope rejection does not consume the valid operation budget', () => {
  const issuer = new DelegationGrantIssuer()
  const grant = issuer.issue(requestFixture({ maxAttempts: 1 }))
  for (const overrides of [
    { planDigest: 'c'.repeat(64) },
    { repository: 'other/repo' },
    { base: 'other' },
    { action: 'delete' },
  ]) {
    assert.equal(issuer.resolve(grant, operationFixture(overrides)).admitted, false)
  }
  assert.equal(issuer.resolve(grant, operationFixture()).admitted, true)
  assert.equal(
    issuer.resolve(grant, operationFixture({ operationDigest: 'd'.repeat(64) })).admitted,
    false,
  )
})

test('revocation and tampering prevent admission', () => {
  const issuer = new DelegationGrantIssuer()
  const grant = issuer.issue(requestFixture())
  const tampered = structuredClone(grant)
  tampered.binding.maxExternalEffects = 99
  assert.match(issuer.resolve(tampered, operationFixture()).reason, /TAMPER/)
  assert.equal(issuer.revoke(grant.id).revoked, true)
  assert.match(issuer.resolve(grant, operationFixture()).reason, /REVOKED/)
})

test('unsupported authority and invalid budgets fail at issuance', () => {
  for (const overrides of [
    { issuerMode: 'trusted-host' },
    { hardCeiling: 0 },
    { hardCeiling: null },
    { maxAttempts: NaN },
    { maxExternalEffects: Infinity },
    { maxAttempts: 1.5 },
    { allowedActions: ['unknown'] },
  ]) {
    assert.throws(() => new DelegationGrantIssuer().issue(requestFixture(overrides)))
  }
})
