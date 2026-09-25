import { describe, it, expect } from 'vitest'
import { BoundedTraceProcessor } from '../observability/bounded-trace-processor.mjs'

const span = (name = 'session') => ({
  name,
  attributes: {},
  startTime: [0, 0],
  endTime: [0, 1],
  spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
})

describe('bounded trace queue', () => {
  it('counts in-flight payloads against admission limits', async () => {
    let acknowledge
    const processor = new BoundedTraceProcessor(
      {
        export: (_items, callback) => {
          acknowledge = callback
        },
        shutdown: async () => {},
      },
      { maxQueueSize: 1 },
    )
    processor.onEnd(span())
    const bytes = processor.bytes
    const draining = processor.forceFlush()
    processor.onEnd(span())
    expect(processor.count).toBe(1)
    expect(processor.bytes).toBe(bytes)
    expect(processor.drops).toBe(1)
    acknowledge({ code: 0 })
    await draining
    expect(processor.count).toBe(0)
    expect(processor.bytes).toBe(0)
    await processor.shutdown()
  })

  it('rejects an oversized serialized payload before enqueue', async () => {
    const processor = new BoundedTraceProcessor({ shutdown: async () => {} }, { maxBytes: 1 })
    processor.onEnd(span())
    expect(processor.bytes).toBe(0)
    expect(processor.drops).toBe(1)
    await processor.shutdown()
  })

  it('bounds shutdown work and accounts for timed-out and discarded spans', async () => {
    let calls = 0
    const processor = new BoundedTraceProcessor(
      {
        export: () => {
          calls++
        },
        shutdown: async () => {},
      },
      { timeoutMs: 10 },
    )
    for (let i = 0; i < 300; i++) processor.onEnd(span())
    await processor.shutdown()
    expect(calls).toBe(1)
    expect(processor.drops).toBe(300)
    expect(processor.bytes).toBe(0)
    processor.onEnd(span())
    expect(processor.drops).toBe(301)
  })

  it('contains synchronous exporter failure', async () => {
    const processor = new BoundedTraceProcessor({
      export: () => {
        throw new Error('private transport detail')
      },
      shutdown: async () => {},
    })
    processor.onEnd(span())
    await processor.forceFlush()
    expect(processor.drops).toBe(1)
    expect(processor.count).toBe(0)
    await processor.shutdown()
  })
})
