import { describe, expect, it } from 'vitest'
import { formatIntakeBody, parseIntakeBody } from '../bridge/intake-body.mjs'
import {
  generationId,
  offerQueueId,
  sessionForSeat,
  sliceIdFor,
  slug,
  stableQueueId,
  tierForChangeClass,
} from '../bridge/queue-id.mjs'
import { callerSeat } from '../core/seat-claim.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'

describe('bridge queue ids (#582)', () => {
  it('derives the same stable id from the same reference, and different ids otherwise', () => {
    const ref = { system: 'filesystem', scope: 'local', id: 'Item_7' }
    const id = stableQueueId(ref)
    expect(id).toMatch(/^af-filesystem-[0-9a-f]{8}-item-7$/)
    expect(stableQueueId({ ...ref })).toBe(id)
    expect(stableQueueId({ ...ref, scope: 'other' })).not.toBe(id)
    expect(stableQueueId({ ...ref, id: 'x'.repeat(200) })).toHaveLength(64)
    expect(() => stableQueueId({ system: 'filesystem', scope: 'local', id: '' })).toThrow()
  })

  it('derives slice, generation, offer ids and tiers', () => {
    expect(slug('  Hello, World!  ')).toBe('hello-world')
    expect(sliceIdFor({ system: 'filesystem', id: 'A.1' })).toBe('filesystem-a-1')
    expect(generationId('af-x', 2)).toBe('af-x-g2')
    expect(() => generationId('af-x', 1)).toThrow()
    expect(offerQueueId('af-x', 'rig-a')).toMatch(/^af-x-[0-9a-f]{6}$/)
    expect(offerQueueId('af-x', 'rig-a')).not.toBe(offerQueueId('af-x', 'rig-b'))
    expect(tierForChangeClass('bounded')).toBe('fast')
    expect(tierForChangeClass('standard')).toBe('routine')
    expect(tierForChangeClass('high-assurance')).toBe('critical')
    expect(tierForChangeClass(null)).toBe('routine')
  })

  it('maps a seat to the session callerSeat reads back', () => {
    for (const seat of ['pm.analyst', 'dev.build-jr', 'rev.review']) {
      expect(callerSeat(sessionForSeat(seat, 'rig-1'))).toMatchObject({ seat, rig: 'rig-1' })
    }
  })

  it('round-trips the intake body and rejects other bodies', () => {
    const fields = {
      ref: 'filesystem:local#a',
      stableId: 'af-x',
      slice: 's',
      resumePhase: 3,
      tier: 'fast',
      workflow: 'w.yaml',
    }
    expect(parseIntakeBody(formatIntakeBody(fields))).toEqual(fields)
    expect(parseIntakeBody('hello')).toBeNull()
    expect(() => formatIntakeBody({ ...fields, ref: 'a\nb' })).toThrow()
  })

  it('memory queue reproduces daemon id semantics', async () => {
    const queue = createMemoryQueuePort()
    const row = { id: 'q', destination: 'a@r', source: 'b@r', body: 'x' }
    expect(await queue.create(row)).toMatchObject({ created: true })
    await queue.update('q', { state: 'done', closureReason: 'canceled' })
    expect(await queue.create({ ...row, body: 'y' })).toMatchObject({
      created: false,
      state: 'done',
    })
    await expect(queue.create({ ...row, destination: 'c@r' })).rejects.toMatchObject({
      code: 'qitem_id_reuse',
    })
    await expect(queue.update('q', { state: 'done' })).rejects.toThrow('closure reason')
    await expect(queue.resolve('q', { decision: 'd' })).rejects.toThrow('typed gate')
  })
})
