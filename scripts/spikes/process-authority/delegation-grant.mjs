import { createHmac, randomBytes, randomUUID } from 'node:crypto'

// This prototype admits only these operations; effect classification is issuer-owned.
const ACTIONS = new Map([
  ['commit', false],
  ['push', true],
  ['pr:create', true],
])
const safePath = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !/[\\:*?\x00-\x1f]/.test(value) &&
  value
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part))

// ---------------------------------------------------------------------------
// Grant schema types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GrantRequest
 * @property {string} planDigest - SHA-256 hex of the approved plan
 * @property {string} repository - owner/repo
 * @property {string} base - target branch
 * @property {string[]} allowedPaths - glob patterns for permitted file changes
 * @property {string[]} allowedActions - action identifiers (e.g. 'commit', 'push', 'pr:create')
 * @property {number} maxAttempts - budget: maximum task attempts
 * @property {number} maxExternalEffects - budget: maximum external effects
 * @property {string} expiry - ISO 8601 timestamp
 * @property {string} issuerMode - 'local-cooperative' | 'trusted-host'
 */

/**
 * @typedef {Object} GrantEnvelope
 * @property {string} id - unique grant ID (UUIDv4)
 * @property {string} nonce - cryptographic nonce for replay prevention
 * @property {string} issuedAt - ISO 8601 timestamp
 * @property {string} expiry - ISO 8601 timestamp
 * @property {string} issuerMode - the declared assurance level
 * @property {string} issuerActor - self-declared actor label (NOT authenticated)
 * @property {GrantRequest} binding - the bound request fields
 * @property {string} hmac - HMAC-SHA256 of canonical grant content
 */

export class DelegationGrantIssuer {
  /** @type {Buffer} */ #key
  /** @type {Map<string, { envelope: GrantEnvelope, budgetUsed: { attempts: number, externalEffects: number }, status: string, revocationEpoch: number }>} */ #grants =
    new Map()
  /** @type {Map<string, boolean>} */ #seenOperations = new Map()
  /** @type {number} */ #revocationEpoch = 0

  constructor(key) {
    this.#key = key ?? randomBytes(32)
  }

  issue(request, actor = 'agent:local') {
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw new Error('Invalid grant request')
    if (request.issuerMode === 'trusted-host') {
      throw new Error(
        'UNSUPPORTED: trusted-host issuer mode requires a verifiable host binding ' +
          'that this local-cooperative spike cannot provide.',
      )
    }
    if (request.issuerMode !== 'local-cooperative') {
      throw new Error('UNSUPPORTED: unknown issuer mode. Only "local-cooperative" is supported.')
    }
    if ('hardCeiling' in request) {
      throw new Error(
        'UNSUPPORTED: This spike has no enforcing provider adapter. Cannot accept any hardCeiling assertion.',
      )
    }

    if (!/^[a-f0-9]{64}$/i.test(request.planDigest))
      throw new Error('planDigest must be SHA-256 hex')
    this.#requireNonEmpty(request.repository, 'repository')
    this.#requireNonEmpty(request.base, 'base')
    this.#requireNonEmpty(request.expiry, 'expiry')
    if (!Array.isArray(request.allowedPaths) || request.allowedPaths.length === 0) {
      throw new Error('Grant requires at least one allowed path')
    }
    if (!Array.isArray(request.allowedActions) || request.allowedActions.length === 0) {
      throw new Error('Grant requires at least one allowed action')
    }
    if (request.allowedActions.some((action) => !ACTIONS.has(action)))
      throw new Error('Unsupported action')
    if (
      request.allowedPaths.some(
        (pattern) =>
          typeof pattern !== 'string' ||
          !safePath(pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern),
      )
    ) {
      throw new Error('Invalid allowed path pattern')
    }
    if (!Number.isSafeInteger(request.maxAttempts) || request.maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer >= 1')
    }
    if (!Number.isSafeInteger(request.maxExternalEffects) || request.maxExternalEffects < 0) {
      throw new Error('maxExternalEffects must be a non-negative integer')
    }

    const expiryDate = new Date(request.expiry)
    if (isNaN(expiryDate.getTime())) throw new Error('Invalid expiry timestamp')
    if (expiryDate <= new Date()) throw new Error('Grant expiry must be in the future')

    const id = randomUUID()
    const nonce = randomBytes(16).toString('hex')

    /** @type {GrantEnvelope} */
    const envelope = {
      id,
      nonce,
      issuedAt: new Date().toISOString(),
      expiry: request.expiry,
      issuerMode: request.issuerMode,
      issuerActor: actor,
      binding: { ...request },
      hmac: '',
    }

    envelope.hmac = this.#computeHmac(envelope)
    this.#grants.set(id, {
      envelope: structuredClone(envelope),
      budgetUsed: { attempts: 0, externalEffects: 0 },
      status: 'active',
      revocationEpoch: 0,
    })

    return structuredClone(envelope)
  }

  resolve(presented, context) {
    if (!presented || typeof presented !== 'object' || !context || typeof context !== 'object') {
      return { admitted: false, reason: 'INVALID: grant and operation context required' }
    }
    const storedHmac = presented.hmac
    const recomputed = this.#computeHmac(presented)
    if (storedHmac !== recomputed) {
      return { admitted: false, reason: 'TAMPER: HMAC mismatch — grant content was modified' }
    }

    const state = this.#grants.get(presented.id)
    if (!state) {
      return { admitted: false, reason: 'UNKNOWN: grant ID not found in issuer store' }
    }

    if (!/^[a-f0-9]{64}$/i.test(context.operationDigest)) {
      return {
        admitted: false,
        reason: 'INVALID: missing or invalid operationDigest (must be SHA-256)',
      }
    }
    const opKey = `${presented.id}:${context.operationDigest}`
    if (this.#seenOperations.has(opKey)) {
      return { admitted: false, reason: 'REPLAY: operation digest already processed' }
    }

    if (state.status === 'revoked') {
      return {
        admitted: false,
        reason: `REVOKED: grant was revoked at epoch ${state.revocationEpoch}`,
      }
    }

    if (new Date(state.envelope.expiry) <= new Date()) {
      state.status = 'expired'
      return { admitted: false, reason: 'EXPIRED: grant expiry has passed' }
    }

    if (context.planDigest !== state.envelope.binding.planDigest) {
      return { admitted: false, reason: 'SCOPE: planDigest mismatch' }
    }
    if (context.repository !== state.envelope.binding.repository) {
      return { admitted: false, reason: 'SCOPE: repository mismatch' }
    }
    if (context.base !== state.envelope.binding.base) {
      return { admitted: false, reason: 'SCOPE: base mismatch' }
    }
    if (!state.envelope.binding.allowedActions.includes(context.action)) {
      return { admitted: false, reason: `SCOPE: action "${context.action}" not allowed` }
    }
    if (!this.#pathMatches(context.path, state.envelope.binding.allowedPaths)) {
      return { admitted: false, reason: `SCOPE: path "${context.path}" not allowed or invalid` }
    }

    if (state.budgetUsed.attempts >= state.envelope.binding.maxAttempts) {
      state.status = 'exhausted'
      return { admitted: false, reason: 'BUDGET: attempts exhausted' }
    }

    if (ACTIONS.get(context.action)) {
      if (state.budgetUsed.externalEffects >= state.envelope.binding.maxExternalEffects) {
        state.status = 'exhausted'
        return { admitted: false, reason: 'BUDGET: external effects exhausted' }
      }
      state.budgetUsed.externalEffects += 1
    }

    state.budgetUsed.attempts += 1
    this.#seenOperations.set(opKey, true)

    return { admitted: true }
  }

  revoke(grantId) {
    const state = this.#grants.get(grantId)
    if (!state) return { revoked: false, reason: 'Grant not found' }
    if (state.status === 'revoked') return { revoked: false, reason: 'Already revoked' }

    this.#revocationEpoch += 1
    state.status = 'revoked'
    state.revocationEpoch = this.#revocationEpoch

    return { revoked: true, epoch: this.#revocationEpoch }
  }

  issueChild() {
    throw new Error('UNSUPPORTED: Subdelegation is out of scope for this bounded issuer spike.')
  }

  #computeHmac(envelope) {
    const canonical = JSON.stringify({
      id: envelope.id,
      nonce: envelope.nonce,
      issuedAt: envelope.issuedAt,
      expiry: envelope.expiry,
      issuerMode: envelope.issuerMode,
      issuerActor: envelope.issuerActor,
      binding: envelope.binding,
    })
    return createHmac('sha256', this.#key).update(canonical).digest('hex')
  }

  #pathMatches(path, allowedPaths) {
    if (!safePath(path)) {
      return false
    }
    const normalized = path.replace(/\\/g, '/')
    for (const pattern of allowedPaths) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1)
        if (normalized.startsWith(prefix)) return true
      } else if (pattern === normalized) {
        return true
      }
    }
    return false
  }

  #requireNonEmpty(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Grant requires non-empty string for ${name}`)
    }
  }
}
