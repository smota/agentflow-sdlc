import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const SPAWN = resolve('adapters/openrig/scripts/spawn-squad.sh')
const INSTALL = resolve('adapters/openrig/scripts/install-rig.sh')

const dirs = []
const NODE_BIN = mkdtempSync(join(tmpdir(), 'agentflow-node-bin-'))
symlinkSync(process.execPath, join(NODE_BIN, 'node'))

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function run(script, args, home) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { HOME: home, PATH: `${NODE_BIN}:/usr/bin:/bin` },
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(NODE_BIN, { recursive: true, force: true })
})

describe('spawn-squad.sh product copy', () => {
  it('copies the product base and records only the named sibling', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const other = tempDir('agentflow-other-')

    const installed = run(INSTALL, ['--preset', 'all-claude'], home)
    expect(installed.status, installed.stderr).toBe(0)

    const product = run(
      SPAWN,
      ['--kind', 'product', '--sibling', 'agentflow-dev', '--preset', 'all-claude', 'pm', project],
      home,
    )
    expect(product.status, product.stderr).toBe(0)

    const rig = readFileSync(join(home, '.openrig/specs/agentflow-pm/rig.yaml'), 'utf8')
    expect(rig).toContain('name: agentflow-pm')
    expect(rig).toContain('id: manager')
    expect(rig).toContain('id: analyst')
    expect(rig).not.toContain('id: build')
    expect(rig).toContain('runtime: claude-code')
    expect(rig).not.toContain('runtime: pi')
    expect(rig).toContain('path: sibling.md')

    const sibling = readFileSync(join(home, '.openrig/specs/agentflow-pm/sibling.md'), 'utf8')
    expect(sibling).toContain('orch-arch@agentflow-dev')
    expect(sibling).not.toContain(other)

    const delivery = run(
      SPAWN,
      ['--kind', 'delivery', '--sibling', 'agentflow-pm', 'dev', project],
      home,
    )
    expect(delivery.status, delivery.stderr).toBe(0)
    const deliveryRig = readFileSync(join(home, '.openrig/specs/agentflow-dev/rig.yaml'), 'utf8')
    expect(deliveryRig).toContain('id: arch')
    expect(deliveryRig).not.toContain('id: manager')
    const deliverySibling = readFileSync(join(home, '.openrig/specs/agentflow-dev/sibling.md'), 'utf8')
    expect(deliverySibling).toContain('pm-analyst@agentflow-pm')
  })

  it('rejects an unknown product preset before writing the copy', () => {
    const home = tempDir('agentflow-home-')
    const project = tempDir('agentflow-project-')
    const installed = run(INSTALL, [], home)
    expect(installed.status, installed.stderr).toBe(0)

    const product = run(SPAWN, ['--kind', 'product', '--preset', 'no-such', 'pm', project], home)
    expect(product.status).toBe(1)
    expect(product.stderr).toContain('Unknown preset "no-such"')
    expect(existsSync(join(home, '.openrig/specs/agentflow-pm'))).toBe(false)
  })
})
