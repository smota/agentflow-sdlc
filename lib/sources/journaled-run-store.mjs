import { createPendingAuditJournal } from './pending-audit-journal.mjs'
import { reduceRun } from '../core/run-state.mjs'

// Write-ahead evidence is local recovery data, never a replacement for the source.
export function createJournaledRunStore({ store, directory, observeWriter }) {
  const fresh = () => store.read({ cache: false })
  const journal = createPendingAuditJournal({
    directory,
    verifyAcknowledgment: async ({ event }) => {
      const snapshot = await fresh()
      const found = snapshot.events.find((item) => item.id === event.id)
      return {
        acknowledged: found?.digest === event.digest,
        eventId: event.id,
        eventDigest: event.digest,
        sourceRevision: snapshot.revision,
      }
    },
    verifyNonCommitment: async ({ event }) => {
      const snapshot = await fresh()
      return {
        notCommitted:
          snapshot.revision !== event.previousDigest &&
          !snapshot.events.some((item) => item.id === event.id),
        sourceRevision: snapshot.sourceRevision ?? snapshot.revision,
      }
    },
  })
  async function reconcile({ replay = false, authority } = {}) {
    const pending = await journal.list()
    if (pending.recoveryRequired) throw new Error('Pending audit stage requires recovery')
    let snapshot = await fresh()
    for (const ack of pending.acknowledgments) {
      if (
        !snapshot.events.some(
          (event) => event.id === ack.eventId && event.digest === ack.eventDigest,
        )
      )
        throw new Error('Authoritative source no longer contains acknowledged journal history')
    }
    for (const retired of pending.retirements) {
      if (snapshot.events.some((event) => event.id === retired.eventId))
        throw new Error('Authoritative source contradicts non-committed journal retirement')
    }
    for (const entry of pending.entries.filter((entry) => entry.acknowledged)) {
      if (
        !snapshot.events.some(
          (event) => event.id === entry.event.id && event.digest === entry.event.digest,
        )
      )
        throw new Error('Authoritative source no longer contains acknowledged safety history')
    }
    for (const entry of pending.entries.filter((entry) => !entry.acknowledged)) {
      const event = entry.event
      let found = snapshot.events.find((item) => item.id === event.id)
      if (found && found.digest !== event.digest) throw new Error('Conflicting pending event')
      if (!found && replay) {
        const state = reduceRun(snapshot.events)
        if (
          !state ||
          authority?.execute !== true ||
          authority.owner !== state.owner ||
          authority.generation !== state.generation ||
          event.generation !== state.generation ||
          event.previousDigest !== snapshot.revision
        )
          throw new Error(
            'Pending event replay requires unchanged source and recorded writer identity',
          )
        if (typeof observeWriter !== 'function')
          throw new Error('Pending event replay requires a writer liveness observer')
        const writer = await observeWriter(state)
        if (writer?.stopped !== true)
          throw new Error('Pending event replay requires the recorded writer to be stopped')
        await store.append(event, snapshot.revision)
        snapshot = await fresh()
        found = snapshot.events.find((item) => item.id === event.id)
      }
      if (!found) return { state: 'unknown', pendingEventId: event.id }
      await journal.ack(event.id, event.digest, {}, { runId: event.runId })
    }
    return { state: 'acknowledged' }
  }
  return {
    ...store,
    journal,
    reconcileJournal: reconcile,
    async append(event, expectedRevision) {
      if ((await reconcile()).state !== 'acknowledged')
        throw new Error('Pending audit event requires reconciliation before new work')
      const snapshot = await fresh()
      if (snapshot.revision !== expectedRevision)
        throw Object.assign(new Error('Source revision conflict before journal stage'), {
          admissionOutcome: 'not-committed',
        })
      const safety = ['paused', 'blocked', 'delegation-safety'].includes(event.kind)
      const operationId =
        event.kind === 'operation'
          ? event.payload.id
          : event.payload?.kind === 'engineering-result'
            ? event.payload.operationId
            : null
      const admitted = operationId
        ? snapshot.events.find(
            (item) =>
              item.kind === 'operation-admitted' && item.payload.operation.id === operationId,
          )
        : null
      await journal.put(event, {
        kind: safety ? 'safety' : 'business',
        reservedBytes: event.kind === 'operation-admitted' ? 64 * 1024 : 0,
        ...(admitted ? { reservationId: admitted.id } : {}),
      })
      try {
        const result = await store.append(event, expectedRevision)
        await journal.ack(event.id, event.digest, {}, { runId: event.runId })
        return result
      } catch (error) {
        if (!safety) {
          if (error.admissionOutcome === 'not-committed') {
            try {
              await journal.retire(event.id, event.digest, {
                runId: event.runId,
                outcome: 'not-committed',
              })
            } catch {
              await journal.put(event, { state: 'unknown' })
            }
          } else await journal.put(event, { state: 'unknown' })
        }
        error.pendingEvent = event
        throw error
      }
    },
  }
}
