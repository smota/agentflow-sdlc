import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPEC_PATH, main } from '../validate-openrig-workflow.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dirs = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openrig-workflow-'))
  dirs.push(root)
  mkdirSync(join(root, 'manifests'))
  cpSync(join(repo, 'manifests/seats.json'), join(root, 'manifests/seats.json'))
  mkdirSync(dirname(join(root, SPEC_PATH)), { recursive: true })
  cpSync(join(repo, SPEC_PATH), join(root, SPEC_PATH))
  return root
}

async function run(args, execFile) {
  let out = ''
  const code = await main(args, { execFile, write: (t) => (out += t) })
  return { code, out }
}

describe('validate-openrig-workflow', () => {
  it('reports READY for the committed spec', async () => {
    const { code, out } = await run(['--root', repo])
    expect(code).toBe(0)
    expect(out).toBe('READY\n')
  })

  it('exits 1 when the spec drifts from the generator', async () => {
    const root = fixture()
    const file = join(root, SPEC_PATH)
    writeFileSync(file, readFileSync(file, 'utf8').replace('max_hops: 46', 'max_hops: 40'))
    const { code, out } = await run(['--root', root])
    expect(code).toBe(1)
    expect(out).toMatch(/max_hops is 40, expected 46/)
    expect(out).toMatch(/differs from the generator output/)
  })

  it('exits 1 when the spec file is missing and --write restores it', async () => {
    const root = fixture()
    rmSync(join(root, SPEC_PATH))
    expect((await run(['--root', root])).code).toBe(1)
    expect((await run(['--root', root, '--write'])).code).toBe(0)
    expect(readFileSync(join(root, SPEC_PATH), 'utf8')).toBe(
      readFileSync(join(repo, SPEC_PATH), 'utf8'),
    )
  })

  it('--rig reports ok with a fake rig and passes the validate arguments', async () => {
    const calls = []
    const { code, out } = await run(['--root', repo, '--rig'], async (cmd, args) => {
      calls.push([cmd, args])
      return { stdout: '{"ok":true}' }
    })
    expect(code).toBe(0)
    expect(calls[0][0]).toBe('rig')
    expect(calls[0][1].slice(0, 2)).toEqual(['workflow', 'validate'])
    expect(calls[0][1].at(-1)).toBe('--json')
    expect(out).toMatch(/rig workflow validate .* ok/)
  })

  it('--rig is skipped, not failed, when rig is missing or the daemon is down', async () => {
    const enoent = async () => {
      throw Object.assign(new Error('spawn rig ENOENT'), { code: 'ENOENT' })
    }
    const down = async () => {
      throw Object.assign(new Error('failed'), { stderr: 'connect ECONNREFUSED 127.0.0.1' })
    }
    const a = await run(['--root', repo, '--rig', '--json'], enoent)
    expect(a.code).toBe(0)
    expect(JSON.parse(a.out).rig).toEqual({ status: 'skipped', detail: 'rig not available' })
    const b = await run(['--root', repo, '--rig'], down)
    expect(b.code).toBe(0)
    expect(b.out).toMatch(/skipped: rig daemon not reachable/)
  })

  it('--rig exits 1 when rig rejects the spec', async () => {
    const { code, out } = await run(['--root', repo, '--rig'], async () => {
      throw Object.assign(new Error('exit 1'), { stdout: 'unknown step key "x"' })
    })
    expect(code).toBe(1)
    expect(out).toMatch(/BLOCKED[\s\S]*unknown step key "x"/)
  })
})
