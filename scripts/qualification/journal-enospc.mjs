#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statfsSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { createPendingAuditJournal } from '../../lib/sources/pending-audit-journal.mjs'
import { createRunEvent } from '../../lib/core/run-state.mjs'

// Opt-in OS qualification. Never fill a host volume or an unbounded mount.
assert.equal(process.platform, 'linux', 'Run in an isolated Linux mount namespace')
assert.ok(process.argv[2], 'An explicit private tmpfs root is required')
const root = realpathSync(process.argv[2])
assert.equal(dirname(root), '/tmp')
assert.match(basename(root), /^agentflow-journal-pressure-[A-Za-z0-9]+$/)
assert.ok(
  readFileSync('/proc/self/mountinfo', 'utf8')
    .split('\n')
    .some((line) => line.split(' ')[4] === root),
  'Target must be a dedicated mount point',
)
const filesystem = statfsSync(root)
assert.equal(filesystem.type, 0x1021994, 'Only tmpfs is permitted')
assert.ok(filesystem.blocks * filesystem.bsize > 0)
assert.ok(filesystem.blocks * filesystem.bsize <= 1024 * 1024, 'Mount must be at most 1 MiB')
assert.deepEqual(readdirSync(root), [], 'Qualification mount must be empty')

const directory = join(root, 'audit')
const journal = createPendingAuditJournal({ directory })
const event = (id, kind) =>
  createRunEvent({
    id,
    runId: 'disk-pressure-qualification',
    kind,
    payload: { reason: 'Bounded OS disk-pressure qualification' },
    timestamp: new Date().toISOString(),
  })
await journal.put(event('retained-checkpoint', 'checkpoint'))
const digest = (name) =>
  createHash('sha256')
    .update(readFileSync(join(directory, name)))
    .digest('hex')
const before = { business: digest('pending.json'), safety: digest('safety.reserve') }
const filler = join(root, 'filler')
const fd = openSync(filler, 'wx')
let filledBytes = 0
let fillError
try {
  for (;;) filledBytes += writeSync(fd, Buffer.alloc(4096, 1))
} catch (error) {
  fillError = error.code
} finally {
  closeSync(fd)
}
let pressureError
const stop = event('stop-after-pressure', 'paused')
try {
  assert.equal(fillError, 'ENOSPC', 'The operating system must report real ENOSPC')
  try {
    await journal.put(stop, { kind: 'safety' })
  } catch (error) {
    pressureError = error.code
  }
  assert.equal(pressureError, 'ENOSPC')
  assert.equal(digest('pending.json'), before.business)
  assert.equal(digest('safety.reserve'), before.safety)
  assert.equal(existsSync(join(directory, 'writer.lock')), false)
} finally {
  unlinkSync(filler)
}
const recovered = await journal.list()
assert.equal(recovered.recoveryRequired, false)
assert.equal(recovered.entries.length, 1)
await journal.put(stop, { kind: 'safety' })
assert.equal((await journal.list()).entries.length, 2)
console.log(
  JSON.stringify({
    case: 'actual-os-enospc-private-tmpfs',
    filledBytes,
    pressureError,
    priorEvidenceRetained: true,
    abandonedLock: false,
    safetyWriteAfterSpaceRestored: true,
    limits: 'No safety-write guarantee while full; no provider or power-loss qualification',
  }),
)
