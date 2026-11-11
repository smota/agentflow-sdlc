// The rig CLI queue port (#582) runs `rig` only through the injected exec function; these tests
// record argv with a fake and never start a process.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  QUEUE_PORT_METHODS,
  createRigCliQueuePort,
  queuePortProblems,
} from '../bridge/queue-port.mjs'
import { createMemoryQueuePort } from '../bridge/memory-queue.mjs'

function fakeExec(responder) {
  const calls = []
  const exec = async (file, args, options) => {
    const bodyIndex = args.indexOf('--body-file')
    const body = bodyIndex === -1 ? null : readFileSync(args[bodyIndex + 1], 'utf8')
    calls.push({
      file,
      args,
      options,
      body,
      bodyPath: bodyIndex === -1 ? null : args[bodyIndex + 1],
    })
    return responder(args)
  }
  return { exec, calls }
}

function failure(stdout, code = 1) {
  return Object.assign(new Error('Command failed'), { code, stdout, stderr: '' })
}

const ROW = {
  qitemId: 'af-x',
  state: 'pending',
  destinationSession: 'pm-analyst@r',
  sourceSession: 'agentflow-bridge@r',
  tags: ['af:af-x'],
  blockedOn: null,
  body: 'agentflow-intake/v1\nref=a:b#1\nstable_id=af-x\n',
}

describe('rig CLI queue port (#582)', () => {
  it('implements every QueuePort method, as does the memory port', () => {
    const port = createRigCliQueuePort({ exec: async () => ({ stdout: '' }) })
    expect(queuePortProblems(port)).toEqual([])
    expect(queuePortProblems(createMemoryQueuePort())).toEqual([])
    expect(queuePortProblems({})).toHaveLength(QUEUE_PORT_METHODS.length)
    expect(() => createRigCliQueuePort({})).toThrow('exec')
  })

  it('reports ENOENT as rig not found on PATH', async () => {
    const exec = async () => {
      throw Object.assign(new Error('spawn rig ENOENT'), { code: 'ENOENT' })
    }
    const port = createRigCliQueuePort({ exec })
    expect(await port.available()).toEqual({ ok: false, reason: 'rig not found on PATH' })
    await expect(port.list()).rejects.toMatchObject({ code: 'rig-unavailable' })
  })

  it('creates with --id, --json and a temporary body file, never a shell', async () => {
    const { exec, calls } = fakeExec((args) => {
      if (args[1] === 'show')
        throw failure(JSON.stringify({ error: 'not_found', message: 'qitem not found' }))
      return { stdout: JSON.stringify(ROW) }
    })
    const port = createRigCliQueuePort({ exec, cwd: '/project' })
    const result = await port.create({
      id: 'af-x',
      destination: 'pm-analyst@r',
      source: 'agentflow-bridge@r',
      summary: 'AgentFlow intake a:b#1',
      body: ROW.body,
      tags: ['af:af-x'],
      tier: 'routine',
      mission: '578',
      slice: 'a-1',
    })
    expect(result).toEqual({ qitemId: 'af-x', state: 'pending', created: true })
    const create = calls.find((call) => call.args[1] === 'create')
    expect(create.file).toBe('rig')
    expect(create.options).toMatchObject({ shell: false, cwd: '/project' })
    expect(create.args).toEqual(
      expect.arrayContaining(['--id', 'af-x', '--json', '--tags', 'af:af-x', '--mission', '578']),
    )
    expect(create.args.at(-1)).toBe('--json')
    expect(create.body).toBe(ROW.body)
    expect(existsSync(create.bodyPath)).toBe(false)
  })

  it('reports an existing row as created:false and refuses id reuse on another route', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: JSON.stringify(ROW) }))
    const port = createRigCliQueuePort({ exec })
    const input = {
      id: 'af-x',
      destination: 'pm-analyst@r',
      source: 'agentflow-bridge@r',
      body: '',
    }
    expect(await port.create(input)).toEqual({ qitemId: 'af-x', state: 'pending', created: false })
    expect(calls.some((call) => call.args[1] === 'create')).toBe(false)
    await expect(port.create({ ...input, destination: 'other@r' })).rejects.toMatchObject({
      code: 'qitem_id_reuse',
    })
  })

  it('lists every rig and state as JSON and filters by tag client-side', async () => {
    const other = { ...ROW, qitemId: 'other', tags: ['af:other'] }
    const { exec, calls } = fakeExec(() => ({ stdout: JSON.stringify({ items: [ROW, other] }) }))
    const port = createRigCliQueuePort({ exec })
    const rows = await port.list({ tag: 'af:af-x' })
    expect(rows.map((row) => row.qitemId)).toEqual(['af-x'])
    expect(rows[0]).toMatchObject({ destination: 'pm-analyst@r', source: 'agentflow-bridge@r' })
    expect(calls[0].args).toEqual(['queue', 'list', '-a', '-A', '--full', '-o', 'json'])
  })

  it('maps block, resolve, update and workflow calls to rig arguments', async () => {
    const { exec, calls } = fakeExec((args) => {
      if (args[1] === 'instantiate')
        return { stdout: JSON.stringify({ instance: { instanceId: 'wf-1' }, entryQitemId: 'p1' }) }
      if (args[1] === 'project')
        return { stdout: JSON.stringify({ instance: { currentFrontier: ['p2'] } }) }
      if (args[0] === 'workflow' && args[1] === 'list')
        return {
          stdout: JSON.stringify({
            instances: [
              {
                instanceId: 'wf-1',
                status: 'active',
                scope: { tags: ['af:af-x'] },
                currentFrontier: ['p2'],
              },
            ],
          }),
        }
      return { stdout: JSON.stringify(ROW) }
    })
    const port = createRigCliQueuePort({ exec })
    await port.block('af-x', { on: 'external:review:af-x', wakeAfter: '2h' })
    await port.resolve('af-x', { decision: 'uri' })
    await port.update('af-x', {
      state: 'done',
      closureReason: 'handed_off_to',
      closureTarget: 'p1',
    })
    expect(
      await port.instantiateWorkflow({
        specPath: 'spec.yaml',
        rig: 'r',
        slice: 'a-1',
        tags: ['af:af-x'],
        entryOwner: 'pm-analyst@r',
        createdBy: 'pm-analyst@r',
        rootObjective: 'deliver',
      }),
    ).toEqual({ instanceId: 'wf-1', entryQitemId: 'p1' })
    expect(
      await port.projectWorkflow({
        instanceId: 'wf-1',
        packetId: 'p1',
        exit: 'handoff',
        note: 'n',
      }),
    ).toEqual({ nextQitemId: 'p2' })
    expect(await port.listWorkflows({ tag: 'af:af-x' })).toEqual([
      { instanceId: 'wf-1', status: 'active', tags: ['af:af-x'], frontier: ['p2'] },
    ])
    await port.abortWorkflow('wf-1', { reason: 'closed' })
    const argv = calls.map((call) => call.args)
    expect(argv).toEqual([
      ['queue', 'block', 'af-x', '--on', 'external:review:af-x', '--wake-after', '2h', '--json'],
      ['queue', 'resolve', 'af-x', '--decision', 'uri', '--json'],
      [
        'queue',
        'update',
        'af-x',
        '--state',
        'done',
        '--closure-reason',
        'handed_off_to',
        '--closure-target',
        'p1',
        '--json',
      ],
      expect.arrayContaining([
        'workflow',
        'instantiate',
        'spec.yaml',
        '--entry-owner',
        'pm-analyst@r',
        '--json',
      ]),
      [
        'workflow',
        'project',
        '--instance',
        'wf-1',
        '--current-packet',
        'p1',
        '--exit',
        'handoff',
        '--result-note',
        'n',
        '--json',
      ],
      ['workflow', 'list', '--json'],
      ['workflow', 'abort', 'wf-1', '--reason', 'closed', '--json'],
    ])
  })

  it('returns null for a missing row and surfaces other failures', async () => {
    const port = createRigCliQueuePort({
      exec: async (file, args) => {
        if (args[2] === 'missing')
          throw failure(JSON.stringify({ error: 'not_found', message: 'qitem missing not found' }))
        throw failure(JSON.stringify({ error: 'daemon_down', message: 'daemon unreachable' }), 2)
      },
    })
    expect(await port.show('missing')).toBeNull()
    await expect(port.show('other')).rejects.toMatchObject({ code: 'daemon_down' })
  })
})
