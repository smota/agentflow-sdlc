// Test-only execution adapter. It proves a second adapter joins `agentflow-sdlc adapters` by
// declaring a lifecycle module in its own manifest, with no change to core.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const specs = (home) => join(home, '.fixture-rig', 'specs')

function refuse(message) {
  const error = new Error(message)
  error.exitCode = 1
  throw error
}

export function install({ adapterDir, home, out }) {
  cpSync(join(adapterDir, 'base'), join(specs(home), 'fixture-base'), { recursive: true })
  out('fixture-rig installed')
}

export function squadProvision({ home, operands, out }) {
  const dir = join(specs(home), `fixture-${operands[0]}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'rig.yaml'), `name: fixture-${operands[0]}\n`)
  out(`fixture-${operands[0]} provisioned`)
}

export function squadList({ home, out }) {
  const dir = specs(home)
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) out(name)
}

export function squadRemove({ home, operands, out }) {
  if (operands[0] === 'base') refuse('fixture base cannot be removed')
  rmSync(join(specs(home), `fixture-${operands[0]}`), { recursive: true, force: true })
  out(`fixture-${operands[0]} removed`)
}
