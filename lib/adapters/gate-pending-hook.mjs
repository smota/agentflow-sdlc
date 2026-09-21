import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createGatePendingEvent } from '../core/gate.mjs'

// The SDLC authorises and records; it never executes. A gate opening states that a decision is
// owed and by whom (lib/core/gate.mjs). Whether the outside world hears about it — a chat message,
// an email, a dashboard badge, a pager — is the orchestrator's decision, never this product's. This
// module's entire job is: read a target's own configuration for where to deliver the sealed event,
// and deliver it there if, and only if, that configuration says to. An unconfigured hook is normal:
// gates still work, nothing is emitted, no error.
//
// This lives outside lib/core/ on purpose. lib/core/ has zero outbound calls today (proven by
// lib/__tests__/core-purity.test.mjs) and must keep having zero; the outbound call belongs here,
// in an edge adapter that depends on core, never the other way around.

export function resolveGatePendingHookUrl(config = {}) {
  const url = config?.gateNotifications?.hookUrl
  return typeof url === 'string' && url.trim() ? url.trim() : null
}

// Delivers the sealed gate-pending event to a single configured webhook URL via a plain HTTP(S)
// POST — a Node built-in, not a new runtime dependency. Any orchestrator willing to receive a POST
// can subscribe; this function does not know or care what happens on the other end.
function defaultDeliver(url, event) {
  return new Promise((resolvePromise, reject) => {
    let target
    try {
      target = new URL(url)
    } catch (error) {
      reject(error)
      return
    }
    const transport = target.protocol === 'http:' ? httpRequest : httpsRequest
    const body = JSON.stringify(event)
    const req = transport(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume()
        res.on('end', () => resolvePromise())
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Creates a hook bound to one target configuration. `emit` is idempotent per event digest: a gate
// re-evaluated (retried, re-checked, replayed) produces the identical sealed event and digest, and
// must not spam the outside world a second time for the same opening. That is what keeps
// "exactly once per gate opening" true even when a caller evaluates the same gate repeatedly.
export function createGatePendingHook(config = {}, { deliver } = {}) {
  const url = resolveGatePendingHookUrl(config)
  const transport = typeof deliver === 'function' ? deliver : defaultDeliver
  const delivered = new Set()
  return {
    configured: url !== null,
    async emit(gate, unitRef) {
      const event = createGatePendingEvent(gate, unitRef)
      if (!url) return { event, delivered: false }
      if (delivered.has(event.digest)) return { event, delivered: false, duplicate: true }
      delivered.add(event.digest)
      await transport(url, event)
      return { event, delivered: true }
    },
  }
}
