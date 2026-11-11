// Reusable SourceAdapter contract suite (#580). Not a test file itself: an adapter's test calls
//
//   describeSourceContract('my source', async () => ({
//     adapter,                 // writes as a trusted writer A; claim trust is the shared trusted list
//     adapterAs(writer),       // same store, another writer identity; must trust SECOND_WRITER
//     makeItem(fields),        // seeds { title, body, labels, lifecycle, status } → reference text
//     setMirror(refText, { holder }), // tampers with the native claim mirror directly
//     untrustedAdapter,        // same store, a writer not in trustedWriters
//     cleanup,                 // optional
//   }))
//
// Each case gets a fresh fixture. Cases for an optional capability the adapter does not declare are
// skipped, and the capability-absent probe is checked instead.
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordDigest } from '../core/record-digest.mjs'
import { evaluateReadyPredicate } from '../core/ready-predicate.mjs'
import {
  CAPABILITY_METHODS,
  READY_PREDICATE_KINDS,
  SOURCE_ADAPTER_VERSION,
  callSourceCapability,
  describeSourceLimits,
  isCapabilityAbsent,
  validateSourceAdapter,
} from '../core/source-adapter.mjs'
import { claimOrYield } from '../core/source-claim.mjs'
import { parseSourceRef } from '../core/source-ref.mjs'

export const SECOND_WRITER = 'contract-writer-b'
export const OPTIONAL_CAPABILITIES = ['claim', 'ready-predicates', 'watch', 'resolve-humans']

const schema = (name) =>
  JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'))
const ajv = new Ajv2020({ strict: false })
const validWorkItem = ajv.compile(schema('work-item.schema.json'))
const validDescriptor = ajv.compile(schema('source-adapter.schema.json'))

const rigA = { kind: 'rig', rig: 'contract-rig-a', host: 'local' }
const rigB = { kind: 'rig', rig: 'contract-rig-b', host: 'local' }
const person = { kind: 'person', id: 'contract-person' }

const ITEM = {
  title: 'Contract item',
  body: 'What the item asks for.',
  labels: ['kind:capability', 'agentflow:ready'],
  lifecycle: 'open',
  status: 'todo',
}

export function describeSourceContract(name, factory) {
  describe(`source contract: ${name}`, () => {
    let fx
    beforeEach(async () => {
      fx = await factory()
    })
    afterEach(async () => {
      await fx?.cleanup?.()
    })

    const declares = (capability) => fx.adapter.capabilities.includes(capability)
    const kinds = () => fx.adapter.readyPredicateKinds ?? []
    const nativeRef = (refText, adapter = fx.adapter) =>
      adapter.toReference(parseSourceRef(refText))
    const seed = (fields = {}) => {
      const item = { ...ITEM, ...fields }
      if (!kinds().includes('status')) delete item.status
      return fx.makeItem(item)
    }

    it('validates as a version 1 source adapter with a valid descriptor', () => {
      expect(validateSourceAdapter(fx.adapter)).toEqual({ ok: true, errors: [] })
      expect(fx.adapter.version).toBe(SOURCE_ADAPTER_VERSION)
      const descriptor = { version: fx.adapter.version, id: fx.adapter.id }
      descriptor.capabilities = fx.adapter.capabilities
      for (const key of ['readyPredicateKinds', 'claimMirror']) {
        if (fx.adapter[key] !== undefined) descriptor[key] = fx.adapter[key]
      }
      expect(validDescriptor(descriptor), JSON.stringify(validDescriptor.errors)).toBe(true)
    })

    it('reports a missing optional capability as absent, never as a failure', async () => {
      const hidden = {
        ...fx.adapter,
        capabilities: fx.adapter.capabilities.filter((cap) => !OPTIONAL_CAPABILITIES.includes(cap)),
      }
      for (const capability of OPTIONAL_CAPABILITIES) {
        const target = declares(capability) ? hidden : fx.adapter
        const result = await callSourceCapability(
          target,
          capability,
          CAPABILITY_METHODS[capability][0],
        )
        expect(isCapabilityAbsent(result)).toBe(true)
        expect(result).toEqual({
          available: false,
          status: 'capability-absent',
          capability,
          adapter: fx.adapter.id,
        })
      }
      expect(describeSourceLimits(hidden)).toEqual({
        maxDeliveryRigs: 1,
        reasons: [`source adapter ${fx.adapter.id} does not declare claim`],
      })
      expect(describeSourceLimits(fx.adapter).maxDeliveryRigs).toBe(declares('claim') ? null : 1)
    })

    it('propagates a real failure of a declared capability', async (ctx) => {
      if (!declares('ready-predicates')) return ctx.skip()
      const { system, scope } = parseSourceRef(await seed())
      const missing = fx.adapter.toReference({ system, scope, id: 'contract-missing-item' })
      await expect(
        callSourceCapability(fx.adapter, 'ready-predicates', 'readWorkItem', missing),
      ).rejects.toThrow()
      expect(() => fx.adapter.toReference({ system: 'elsewhere', scope, id: '1' })).toThrow()
    })

    it('returns a WorkItem whose revision is a content digest', async (ctx) => {
      if (!declares('ready-predicates')) return ctx.skip()
      const refText = await seed()
      const item = await fx.adapter.readWorkItem(nativeRef(refText))
      expect(validWorkItem(item), JSON.stringify(validWorkItem.errors)).toBe(true)
      const parsed = parseSourceRef(refText)
      expect(item).toMatchObject({ version: 1, ref: refText, ...parsed, lifecycle: 'open' })
      expect(item.labels).toEqual(expect.arrayContaining(ITEM.labels))
      const status = kinds().includes('status') ? ITEM.status : item.status
      expect(item.revision).toBe(
        recordDigest({
          title: ITEM.title,
          body: ITEM.body,
          lifecycle: 'open',
          labels: [...ITEM.labels].sort(),
          status,
        }),
      )
      const twin = await fx.adapter.readWorkItem(nativeRef(await seed()))
      expect(twin.revision).toBe(item.revision)
      const changed = await fx.adapter.readWorkItem(nativeRef(await seed({ body: 'Other.' })))
      expect(changed.revision).not.toBe(item.revision)
    })

    it('lists open work items by default and closed ones on request', async (ctx) => {
      if (!declares('ready-predicates')) return ctx.skip()
      const open = await seed()
      const closed = await seed({ lifecycle: 'closed' })
      const openRefs = (await fx.adapter.listWorkItems()).map((item) => item.ref)
      expect(openRefs).toContain(open)
      expect(openRefs).not.toContain(closed)
      const closedRefs = (await fx.adapter.listWorkItems({ lifecycle: 'closed' })).map(
        (item) => item.ref,
      )
      expect(closedRefs).toContain(closed)
      expect(closedRefs).not.toContain(open)
    })

    it('answers each declared predicate kind and a combination', async (ctx) => {
      if (!declares('ready-predicates')) return ctx.skip()
      const item = await fx.adapter.readWorkItem(nativeRef(await seed()))
      const options = { supportedKinds: kinds() }
      const cases = {
        label: [
          { kind: 'label', has: 'agentflow:ready' },
          { kind: 'label', lacks: 'agentflow:ready' },
        ],
        status: [
          { kind: 'status', in: ['todo'] },
          { kind: 'status', in: ['done'] },
        ],
        lifecycle: [
          { kind: 'lifecycle', state: 'open' },
          { kind: 'lifecycle', state: 'closed' },
        ],
      }
      for (const kind of kinds()) {
        const [pass, fail] = cases[kind]
        expect(evaluateReadyPredicate(pass, item, options)).toEqual({ status: 'ready' })
        expect(evaluateReadyPredicate(fail, item, options).status).toBe('not-ready')
      }
      const leaves = kinds().map((kind) => cases[kind])
      const all = { all: leaves.map(([pass]) => pass) }
      const any = { any: leaves.map(([, fail]) => fail).concat([leaves[0][0]]) }
      expect(evaluateReadyPredicate(all, item, options)).toEqual({ status: 'ready' })
      expect(evaluateReadyPredicate(any, item, options)).toEqual({ status: 'ready' })
      const none = evaluateReadyPredicate({ all: leaves.map(([, fail]) => fail) }, item, options)
      expect(none.status).toBe('not-ready')
      expect(none.reasons).toHaveLength(leaves.length)
    })

    it('reports a predicate kind the adapter does not declare as unsupported', async (ctx) => {
      if (!declares('ready-predicates')) return ctx.skip()
      const item = await fx.adapter.readWorkItem(nativeRef(await seed()))
      const leaf = {
        label: { kind: 'label', has: 'x' },
        status: { kind: 'status', in: ['x'] },
        lifecycle: { kind: 'lifecycle', state: 'open' },
      }
      for (const kind of READY_PREDICATE_KINDS.filter((k) => !kinds().includes(k))) {
        expect(evaluateReadyPredicate(leaf[kind], item, { supportedKinds: kinds() })).toEqual({
          status: 'unsupported',
          unsupportedKinds: [kind],
        })
      }
      // An adapter answering fewer kinds gets no partial evaluation either.
      const [first, ...rest] = kinds()
      const predicate = { all: kinds().map((kind) => leaf[kind]) }
      expect(evaluateReadyPredicate(predicate, item, { supportedKinds: rest })).toEqual({
        status: 'unsupported',
        unsupportedKinds: [first],
      })
    })

    describe('claim', () => {
      const claimed = async () => {
        const refText = await seed()
        return { refText, reference: nativeRef(refText) }
      }

      it('starts free and the earliest trusted claim wins', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { reference } = await claimed()
        expect(await fx.adapter.readClaim(reference)).toMatchObject({
          status: 'free',
          holder: null,
        })
        const first = await fx.adapter.claim(reference, rigA)
        expect(first).toMatchObject({ status: 'held', holder: rigA })
        const second = await fx.adapterAs(SECOND_WRITER).claim(reference, rigB)
        expect(second).toMatchObject({ status: 'held', holder: rigA })
        expect(await fx.adapter.readClaim(reference)).toMatchObject({ holder: rigA })
      })

      it('re-claiming by the holder appends nothing and keeps the content revision', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { reference } = await claimed()
        const before = declares('ready-predicates')
          ? (await fx.adapter.readWorkItem(reference)).revision
          : null
        const first = await fx.adapter.claim(reference, rigA)
        const again = await fx.adapter.claim(reference, rigA)
        expect(again.entry).toEqual(first.entry)
        expect(again.uri).toBe(first.uri)
        expect(again.ignored).toEqual(first.ignored)
        if (before) expect((await fx.adapter.readWorkItem(reference)).revision).toBe(before)
      })

      it('the holder release frees the item for the next claim', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { reference } = await claimed()
        await fx.adapter.claim(reference, rigA)
        expect(await fx.adapter.release(reference, rigA)).toMatchObject({ status: 'free' })
        const next = await fx.adapterAs(SECOND_WRITER).claim(reference, rigB)
        expect(next).toMatchObject({ status: 'held', holder: rigB })
      })

      it('a loser release and a non-holder release are ignored', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { reference } = await claimed()
        await fx.adapter.claim(reference, rigA)
        const b = fx.adapterAs(SECOND_WRITER)
        await b.claim(reference, rigB)
        expect(await b.release(reference, rigB)).toMatchObject({ holder: rigA })
        expect(await fx.adapter.release(reference, person)).toMatchObject({ holder: rigA })
        const state = await fx.adapter.readClaim(reference)
        expect(state).toMatchObject({ status: 'held', holder: rigA })
        expect(state.ignored.map((item) => item.reason)).toEqual(
          expect.arrayContaining(['held-by-another-owner', 'release-by-non-holder']),
        )
      })

      it('a loser that never yielded wins once the item is free', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { reference } = await claimed()
        await fx.adapter.claim(reference, rigA)
        const b = fx.adapterAs(SECOND_WRITER)
        expect(await b.claim(reference, rigB)).toMatchObject({ holder: rigA })
        await fx.adapter.release(reference, rigA)
        expect(await b.claim(reference, rigB)).toMatchObject({ status: 'held', holder: rigB })
        expect(await claimOrYield({ adapter: b, reference, owner: rigB })).toEqual({
          won: true,
          holder: rigB,
        })
      })

      it('claimOrYield releases a losing claim and yields', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { reference } = await claimed()
        expect(await claimOrYield({ adapter: fx.adapter, reference, owner: rigA })).toEqual({
          won: true,
          holder: rigA,
        })
        const b = fx.adapterAs(SECOND_WRITER)
        expect(await claimOrYield({ adapter: b, reference, owner: rigB })).toEqual({
          won: false,
          holder: rigA,
        })
        await fx.adapter.release(reference, rigA)
        expect(await fx.adapter.readClaim(reference)).toMatchObject({ status: 'free' })
      })

      it('ignores a claim written by an untrusted writer', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { refText, reference } = await claimed()
        await fx.untrustedAdapter.claim(nativeRef(refText, fx.untrustedAdapter), rigB)
        expect(await fx.adapter.readClaim(reference)).toMatchObject({ status: 'free' })
        await fx.untrustedAdapter.claim(nativeRef(refText, fx.untrustedAdapter), rigA)
        const state = await fx.adapter.claim(reference, rigA)
        expect(state).toMatchObject({ status: 'held', holder: rigA })
        expect(state.ignored.filter((item) => item.reason === 'untrusted-writer')).toHaveLength(2)
      })

      it('writes the mirror and never reads it back as truth', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { refText, reference } = await claimed()
        const held = await fx.adapter.claim(reference, rigA)
        expect(held.mirror.value).not.toBeNull()
        expect(held.mirror.diverged).toBe(false)
        await fx.setMirror(refText, { holder: rigB })
        const tampered = await fx.adapter.readClaim(reference)
        expect(tampered).toMatchObject({ status: 'held', holder: rigA, entry: held.entry })
        expect(tampered.mirror.diverged).toBe(true)
        await fx.setMirror(refText, { holder: null })
        expect(await fx.adapter.readClaim(reference)).toMatchObject({ holder: rigA })
        const freed = await fx.adapter.release(reference, rigA)
        expect(freed).toMatchObject({ status: 'free', mirror: { diverged: false } })
      })

      // Interleaved at await points inside one process. A real multi-process race belongs in the
      // adapter's own tests (see filesystem-source-contract.test.mjs).
      it('lets exactly one of two interleaved claimers hold the item', async (ctx) => {
        if (!declares('claim')) return ctx.skip()
        const { refText } = await claimed()
        const b = fx.adapterAs(SECOND_WRITER)
        const results = await Promise.all([
          claimOrYield({ adapter: fx.adapter, reference: nativeRef(refText), owner: rigA }),
          claimOrYield({ adapter: b, reference: nativeRef(refText, b), owner: rigB }),
        ])
        expect(results.filter((result) => result.won)).toHaveLength(1)
        const holder = results.find((result) => result.won).holder
        expect(results.every((result) => result.holder.rig === holder.rig)).toBe(true)
        expect((await b.readClaim(nativeRef(refText, b))).holder).toEqual(holder)
      })
    })

    it('reports changed items through watch', async (ctx) => {
      if (!declares('watch')) return ctx.skip()
      const start = await fx.adapter.watch(null)
      expect(typeof start.cursor).toBe('string')
      const refText = await seed()
      const next = await fx.adapter.watch(start.cursor)
      expect(next.refs).toContain(refText)
      expect((await fx.adapter.watch(next.cursor)).refs).toEqual([])
    })

    it('resolves writers to human handles', async (ctx) => {
      if (!declares('resolve-humans')) return ctx.skip()
      const humans = await fx.adapter.resolveHumans([SECOND_WRITER])
      expect(humans).toHaveLength(1)
      expect(humans[0]).toMatchObject({ writer: SECOND_WRITER })
      expect(humans[0].handle).toEqual({ system: expect.any(String), login: expect.any(String) })
    })
  })
}
