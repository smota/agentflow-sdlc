import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const script = join(repo, 'scripts/validate-seats.mjs')
const dirs = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'validate-seats-'))
  dirs.push(root)
  for (const file of [
    'manifests/seats.json',
    'schemas/seats.schema.json',
    'manifests/path-ownership.json',
    'AGENTS.md',
    'defaults/AGENTS.md',
    'docs/agent-workflow.md',
    'OPENRIG.md',
    'adapters/openrig/agentflow/CULTURE.md',
    'adapters/openrig/agentflow/README.md',
    'adapters/openrig/agentflow/rig.yaml',
    'adapters/openrig/agentflow/configurations.yaml',
    'manifests/execution-distributions/subscription-balanced-v1.json',
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    cpSync(join(repo, file), join(root, file))
  }
  return root
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [script, '--root', root, ...args], {
    encoding: 'utf8',
  })
  return { code: result.status, out: result.stdout }
}

function edit(root, file, change) {
  const path = join(root, file)
  writeFileSync(path, change(readFileSync(path, 'utf8')))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('validate-seats', () => {
  it('exits 0 on the repository as shipped', () => {
    const out = execFileSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' })
    expect(out).toBe('READY\n')
  })

  it('passes a clean fixture', () => {
    expect(run(fixture())).toEqual({ code: 0, out: 'READY\n' })
  })

  it('fails a rig spec that names an alias, naming file and seat', () => {
    const root = fixture()
    edit(root, 'adapters/openrig/agentflow/rig.yaml', (text) =>
      text.replace('- id: review\n', '- id: gate\n'),
    )
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain(
      'adapters/openrig/agentflow/rig.yaml: seat rev.gate is a legacy alias, use rev.review',
    )
  })

  it('fails configurations that name an alias in the registry or a preset', () => {
    const root = fixture()
    edit(root, 'adapters/openrig/agentflow/configurations.yaml', (text) =>
      text
        .replace('  rev.review:\n    runtimes', '  rev.gate:\n    runtimes')
        .replace('    rev.review: pi\n', '    rev.gate: pi\n'),
    )
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain('configurations.yaml: seat rev.gate is a legacy alias, use rev.review')
    expect(out).toContain('(preset balanced-grok-lead): seat rev.gate is a legacy alias')
  })

  it('fails a policy doc that names an unknown seat', () => {
    const root = fixture()
    edit(root, 'OPENRIG.md', (text) => `${text}\nAlso \`dev.ghost\` writes.\n`)
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toMatch(/OPENRIG\.md:\d+: seat dev\.ghost is not in manifests\/seats\.json/)
  })

  it('accepts an alias in a policy doc and a distribution key', () => {
    const root = fixture()
    edit(root, 'OPENRIG.md', (text) => `${text}\nLegacy \`rev.gate\`.\n`)
    expect(run(root).code).toBe(0)
  })

  it('fails a distribution key that is an unknown seat', () => {
    const root = fixture()
    edit(root, 'manifests/execution-distributions/subscription-balanced-v1.json', (text) =>
      text.replace('"eval.tester": {', '"eval.ghost": {'),
    )
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain('subscription-balanced-v1.json: seat eval.ghost is not in')
  })

  it('fails when path-ownership drifts from the table', () => {
    const root = fixture()
    edit(root, 'manifests/path-ownership.json', (text) =>
      text.replace('"allow": [".agentflow/intake/**"]', '"allow": ["**"]'),
    )
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain(
      'manifests/path-ownership.json: eval.tester: rule eval-write-guard allow differs',
    )
  })

  it('fails when the table itself is invalid', () => {
    const root = fixture()
    edit(root, 'manifests/seats.json', (text) =>
      text.replace('"canonical": "orch.arch"', '"canonical": "orch.none"'),
    )
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain(
      'manifests/seats.json: alias arch.lead names a canonical seat that does not exist',
    )
  })

  it('fails a seat table that violates the schema', () => {
    const root = fixture()
    edit(root, 'manifests/seats.json', (text) =>
      text.replace('"plane": "eval"', '"plane": "nowhere"'),
    )
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toMatch(/manifests\/seats\.json: schema \/seats\/\d+\/plane/)
  })

  it('reports malformed distribution JSON against that file', () => {
    const root = fixture()
    const file = 'manifests/execution-distributions/subscription-balanced-v1.json'
    edit(root, file, (text) => `${text.slice(0, -10)}`)
    const { code, out } = run(root)
    expect(code).toBe(1)
    expect(out).toContain(`${file}: invalid JSON`)
    expect(out).not.toContain('manifests/seats.json')
  })

  it('prints machine-readable output with --json', () => {
    const root = fixture()
    edit(root, 'OPENRIG.md', (text) => `${text}\nAlso \`dev.ghost\`.\n`)
    const { code, out } = run(root, '--json')
    const result = JSON.parse(out)
    expect(code).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/OPENRIG\.md/)
    expect(JSON.parse(run(fixture(), '--json').out)).toEqual({ ok: true, errors: [] })
  })
})
