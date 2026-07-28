import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function createCsrfToken({
  sessionId,
  secret,
  nonce = randomBytes(12).toString('hex'),
} = {}) {
  if (!sessionId || !secret) throw new Error('sessionId and secret required')
  const payload = `${sessionId}:${nonce}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return `${nonce}.${signature}`
}

export function verifyCsrfToken({ token, sessionId, secret } = {}) {
  if (!token || !sessionId || !secret) return false
  const [nonce, signature] = String(token).split('.')
  if (!nonce || !signature) return false
  const expected = createCsrfToken({ sessionId, secret, nonce }).split('.')[1]
  return safeEqual(signature, expected)
}

export function securityHeaders({ publicUrl } = {}) {
  const origin = publicUrl ? new URL(publicUrl).origin : "'self'"
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      `frame-ancestors ${origin}`,
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}

export function createRateLimiter({ limit = 60, windowMs = 60_000 } = {}) {
  const buckets = new Map()
  return function check(key, now = Date.now()) {
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs }
    if (now > bucket.resetAt) {
      bucket.count = 0
      bucket.resetAt = now + windowMs
    }
    bucket.count += 1
    buckets.set(key, bucket)
    return {
      ok: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    }
  }
}

export function secureSessionCookie({ id, remote = false, maxAgeSeconds = 8 * 60 * 60 } = {}) {
  const parts = [
    `cockpit_session=${id}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (remote) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie({ remote = false } = {}) {
  return secureSessionCookie({ id: '', remote, maxAgeSeconds: 0 })
}

export function rejectForbiddenTelemetryFields(payload = {}) {
  const forbidden = []
  walk(payload, [], forbidden)
  return forbidden
}

function walk(value, path, forbidden) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key]
    if (
      /prompt|transcript|tool.?input|tool.?output|secret|token|password|raw.?log|command/i.test(key)
    ) {
      forbidden.push(nextPath.join('.'))
    }
    walk(child, nextPath, forbidden)
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && timingSafeEqual(a, b)
}
