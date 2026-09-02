import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

function files(root, relative = '') {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const target = join(root, name)
      const path = relative ? `${relative}/${name}` : name
      return statSync(target).isDirectory() ? files(target, path) : [path]
    })
}

describe('adoption CLI', () => {
  let target
  let receipt

  beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'agentflow-adopt-cli-'))
    receipt = join(dirname(target), `${Date.now()}-agentflow-receipt.json`)
  })

  afterEach(() => {
    rmSync(target, { recursive: true, force: true })
    rmSync(receipt, { force: true })
  })

  it('lists composition profiles', () => {
    const output = execFileSync(process.execPath, [cli, 'adopt', 'profiles', '--json'], {
      encoding: 'utf8',
    })
    expect(JSON.parse(output)).toMatchObject({ defaultProfile: 'standard' })
    expect(Object.keys(JSON.parse(output).profiles)).toEqual([
      'minimal',
      'standard',
      'github',
      'cockpit',
    ])
  })

  it('plans without writes, applies by token, and rolls back by receipt token', () => {
    const before = files(target)
    const plan = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, 'adopt', 'plan', '--profile', 'standard', '--target', target, '--json'],
        { encoding: 'utf8' },
      ),
    )
    expect(files(target)).toEqual(before)

    const applied = JSON.parse(
      execFileSync(
        process.execPath,
        [
          cli,
          'adopt',
          'apply',
          '--profile',
          'standard',
          '--target',
          target,
          '--confirm',
          plan.token,
          '--receipt',
          receipt,
          '--json',
        ],
        { encoding: 'utf8' },
      ),
    )
    expect(
      JSON.parse(readFileSync(join(target, 'agent-framework-lock.json'), 'utf8')),
    ).toMatchObject({
      version: 2,
      profile: 'standard',
    })
    expect(existsSync(receipt)).toBe(true)

    const rolledBack = JSON.parse(
      execFileSync(
        process.execPath,
        [
          cli,
          'adopt',
          'rollback',
          '--target',
          target,
          '--confirm',
          applied.receiptToken,
          '--receipt',
          receipt,
          '--json',
        ],
        { encoding: 'utf8' },
      ),
    )
    expect(rolledBack.status).toBe('rolled-back')
    expect(files(target)).toEqual(before)
    expect(existsSync(receipt)).toBe(false)
  })

  it('rejects a receipt stored inside the target before mutation', () => {
    const plan = JSON.parse(
      execFileSync(process.execPath, [cli, 'adopt', 'plan', '--target', target, '--json'], {
        encoding: 'utf8',
      }),
    )
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'adopt',
        'apply',
        '--target',
        target,
        '--confirm',
        plan.token,
        '--receipt',
        join(target, 'receipt.json'),
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must remain outside')
    expect(files(target)).toEqual([])
  })
})
