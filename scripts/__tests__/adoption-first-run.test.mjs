import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../../bin/cli.mjs', import.meta.url))

describe('adoption unblocks the first run', () => {
  let target
  let receipt

  beforeEach(() => {
    target = mkdtempSync(join(realpathSync(tmpdir()), 'agentflow-first-run-'))
    receipt = join(dirname(target), `${Date.now()}-agentflow-first-run-receipt.json`)
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: target })
    execFileSync('git', ['config', 'user.email', 'agentflow-test@example.com'], { cwd: target })
    execFileSync('git', ['config', 'user.name', 'AgentFlow Test'], { cwd: target })
  })

  afterEach(() => {
    rmSync(target, { recursive: true, force: true })
    rmSync(receipt, { force: true })
  })

  it('adopt apply ships the execution adapter so validate and run stop failing', () => {
    const plan = JSON.parse(
      execFileSync(process.execPath, [cli, 'adopt', 'plan', '--target', target, '--json'], {
        encoding: 'utf8',
      }),
    )
    expect(plan.blocked).toBe(false)

    execFileSync(
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
        receipt,
        '--json',
      ],
      { encoding: 'utf8' },
    )

    expect(existsSync(join(target, 'agent-workflow.config.json'))).toBe(true)

    const validated = spawnSync(
      process.execPath,
      [cli, 'sdlc', 'validate', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(validated.status).toBe(0)
    expect(JSON.parse(validated.stdout).ok).toBe(true)

    const run = spawnSync(
      process.execPath,
      [cli, 'run', 'status', 'demo', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(run.status).not.toBe(5)
    expect(run.stdout).not.toContain('ENOENT')
    expect(run.stderr).not.toContain('ENOENT')

    unlinkSync(join(target, 'agent-workflow.config.json'))
    const revalidated = spawnSync(
      process.execPath,
      [cli, 'sdlc', 'validate', '--target', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(revalidated.status).not.toBe(0)
    const revalidatedReport = JSON.parse(revalidated.stdout)
    expect(revalidatedReport.ok).toBe(false)
    expect(
      revalidatedReport.findings.some((item) =>
        item.message.includes('agent-workflow.config.json'),
      ),
    ).toBe(true)
    expect(revalidated.stderr).toBe('')
  })
})
