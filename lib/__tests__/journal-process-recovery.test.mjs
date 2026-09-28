import { it, expect } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createJournaledRunStore } from '../sources/journaled-run-store.mjs'
import { createFileRunStore } from '../sources/run-store.mjs'
import { createPendingAuditJournal } from '../sources/pending-audit-journal.mjs'

it('a new OS process resolves a source commit after the writer exits before journal ACK', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'af-process-journal-'))
  try {
    const journalUrl = new URL('../sources/journaled-run-store.mjs', import.meta.url).href
    const storeUrl = new URL('../sources/run-store.mjs', import.meta.url).href
    const eventUrl = new URL('../core/run-state.mjs', import.meta.url).href
    const worker = join(root, 'worker.mjs')
    writeFileSync(
      worker,
      `import {createJournaledRunStore} from ${JSON.stringify(journalUrl)};
import {createFileRunStore} from ${JSON.stringify(storeUrl)};
import {createRunEvent} from ${JSON.stringify(eventUrl)};
const root=process.argv[2]; const source=createFileRunStore({root,runId:'demo'});
const original=source.append.bind(source);
source.append=async(...args)=>{await original(...args);process.exit(17)};
const store=createJournaledRunStore({store:source,directory:root+'/audit'});
await store.append(createRunEvent({runId:'demo',id:'start',generation:0,previousDigest:null,
kind:'started',timestamp:new Date().toISOString(),payload:{owner:'writer',goalRef:'issue:1',profile:'standard',boundary:'mutate-worktree'}}),null);`,
    )
    const child = spawnSync(process.execPath, [worker, root], { encoding: 'utf8', timeout: 10000 })
    expect(child.status, child.stderr).toBe(17)
    const source = createFileRunStore({ root, runId: 'demo' })
    const recovered = createJournaledRunStore({ store: source, directory: join(root, 'audit') })
    expect((await recovered.journal.list()).entries).toHaveLength(1)
    expect(await recovered.reconcileJournal()).toEqual({ state: 'acknowledged' })
    expect((await source.read()).events).toHaveLength(1)
    expect((await recovered.journal.list()).entries).toHaveLength(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it.each(['business-uncommitted', 'business-committed', 'business-ack', 'safety-uncommitted'])(
  'explicitly recovers killed %s stage without redispatch',
  async (scenario) => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'af-stage-recovery-'))
    try {
      const journalUrl = new URL('../sources/pending-audit-journal.mjs', import.meta.url).href
      const storeUrl = new URL('../sources/run-store.mjs', import.meta.url).href
      const eventUrl = new URL('../core/run-state.mjs', import.meta.url).href
      const worker = join(root, 'worker.mjs')
      writeFileSync(
        worker,
        `import {createPendingAuditJournal} from ${JSON.stringify(journalUrl)};
import {createFileRunStore} from ${JSON.stringify(storeUrl)};
import {createRunEvent} from ${JSON.stringify(eventUrl)};
import {hostname} from 'node:os';
const root=process.argv[2], scenario=process.argv[3];
const source=createFileRunStore({root,runId:'demo'});
const start=createRunEvent({runId:'demo',id:'start',generation:0,previousDigest:null,kind:'started',
  payload:{owner:'writer',goalRef:'issue:1',profile:'standard',boundary:'mutate-worktree',
    writer:{host:hostname(),pid:process.pid,instance:'killed-worker'}}});
let businessWrites=0;
const journal=createPendingAuditJournal({directory:root+'/audit',
  verifyAcknowledgment:async({event})=>({acknowledged:(await source.read()).events.some(e=>e.id===event.id&&e.digest===event.digest),
    eventId:event.id,eventDigest:event.digest,sourceRevision:(await source.read()).revision}),
  fault:point=>{if(point==='business.after-fsync')businessWrites++;
    if((scenario==='business-ack'&&businessWrites===2&&point==='business.after-fsync')||
      (scenario!=='business-ack'&&point===(scenario==='safety-uncommitted'?'safety.after-payload-fsync':'business.after-fsync')))process.exit(71)}});
if(scenario==='business-ack'){
  await journal.put(start);
  await source.append(start,null);
  await journal.ack(start.id,start.digest,{}, {runId:'demo'});
}else if(scenario==='safety-uncommitted'){
  await source.append(start,null);
  const stop=createRunEvent({runId:'demo',id:'stop',generation:0,previousDigest:start.digest,
    kind:'checkpoint',payload:{reason:'stopped'}});
  await journal.put(stop,{kind:'safety'});
}else {
  if(scenario==='business-committed')await source.append(start,null);
  await journal.put(start);
}`,
      )
      const child = spawnSync(process.execPath, [worker, root, scenario], {
        encoding: 'utf8',
        timeout: 10000,
      })
      expect(child.status, child.stderr).toBe(71)
      const directory = join(root, 'audit')
      const owner = JSON.parse(readFileSync(join(directory, 'writer.lock'), 'utf8'))
      const source = createFileRunStore({ root, runId: 'demo' })
      const wrapped = createJournaledRunStore({
        store: source,
        directory,
        observeWriter: async (state) => ({
          stopped: state.writer?.pid === child.pid && state.writer?.host === hostname(),
        }),
      })
      await expect(
        wrapped.reconcileJournal({
          recoverStages: true,
          authority: { owner: 'writer', generation: 0, execute: true },
        }),
      ).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' })
      await wrapped.journal.recoverLock(owner)
      const result = await wrapped.reconcileJournal({
        recoverStages: true,
        authority: { owner: 'writer', generation: 0, execute: true },
      })
      expect(result.physicalRecovery?.recovered).toBe(true)
      expect(result.state).toBe(
        scenario === 'business-uncommitted' || scenario === 'safety-uncommitted'
          ? 'unknown'
          : 'acknowledged',
      )
      expect((await source.read()).events).toHaveLength(scenario === 'business-uncommitted' ? 0 : 1)
      expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
