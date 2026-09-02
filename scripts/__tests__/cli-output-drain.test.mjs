import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))
const providerCli = fileURLToPath(new URL('../provider-status.mjs', import.meta.url))
const targets = []

afterEach(() => {
  for (const target of targets.splice(0)) rmSync(target, { recursive: true, force: true })
})

function delayedOutput(entry, args) {
  // Reproduce asynchronous pipe writes on every OS, including synchronous Windows stdout.
  const program = `
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream)
      stream.write = (...args) => {
        setTimeout(() => write(...args), 25)
        return false
      }
    }
    process.argv = ${JSON.stringify([process.execPath, entry, ...args])}
    await import(${JSON.stringify(pathToFileURL(entry).href)})
  `
  return spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  })
}

describe('CLI output drain', () => {
  it.each([
    ['role catalog', cli, ['roles', 'catalog', '--json']],
    ['provider list', providerCli, ['list', '--json']],
    ['delegated provider list', cli, ['providers', 'list', '--json']],
  ])('preserves complete large JSON for %s', (_name, entry, args) => {
    const result = delayedOutput(entry, args)
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(8192)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it('drains a read-only adoption plan without falling through to another command', () => {
    const target = mkdtempSync(join(tmpdir(), 'agentflow-output-drain-'))
    targets.push(target)
    const result = delayedOutput(cli, ['adopt', 'plan', '--target', target, '--json'])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(8192)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })

  it.each([
    [['unknown-command'], 2],
    [['roles', 'inspect', 'missing-role'], 1],
    [['providers', 'unknown-command'], 2],
  ])('preserves diagnostics and status for %j', (args, status) => {
    const result = delayedOutput(cli, args)
    expect(result.status).toBe(status)
    expect(result.stdout).toBe('')
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})
