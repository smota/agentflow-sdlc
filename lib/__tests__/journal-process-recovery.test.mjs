import { it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createJournaledRunStore } from '../sources/journaled-run-store.mjs'
import { createFileRunStore } from '../sources/run-store.mjs'

it('a new OS process resolves a source commit after the writer exits before journal ACK', async () => {
  const root = mkdtempSync(join(tmpdir(), 'af-process-journal-'))
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
