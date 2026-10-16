import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, delimiter } from 'node:path'
import { resolveExecutable } from '../../lib/environment.mjs'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const roots = []
const bases = ['agentflow', 'agentflow-product', 'agentflow-steer']
function fixture({ installed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'execution-plan-cli-'))
  roots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'project')
  const bin = join(root, 'bin')
  mkdirSync(project)
  mkdirSync(bin)
  const nodePath = join(bin, process.platform === 'win32' ? 'node.exe' : 'node')
  try {
    symlinkSync(process.execPath, nodePath)
  } catch {
    copyFileSync(process.execPath, nodePath)
  }
  const git = resolveExecutable('git')
  if (!git) throw new Error('Fixture requires native Git')
  execFileSync(git, ['init', '--quiet', project], {
    env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
  })
  if (installed)
    for (const base of bases)
      cpSync(resolve('adapters/openrig', base), join(home, '.openrig/specs', base), {
        recursive: true,
      })
  return { root, home, project, bin, git }
}
function snapshot(root) {
  if (!existsSync(root)) return null
  return Object.fromEntries(
    readdirSync(root)
      .sort()
      .map((name) => {
        const path = join(root, name)
        return [
          name,
          statSync(path).isDirectory() ? snapshot(path) : readFileSync(path).toString('base64'),
        ]
      }),
  )
}
function cli(f, operation, ...args) {
  return spawnSync(
    process.execPath,
    [
      resolve('bin/cli.mjs'),
      'adapters',
      'squads',
      operation,
      'openrig',
      '--kind',
      'all',
      '--preset',
      'all-codex',
      '--home',
      f.home,
      ...args,
      'fixture',
      f.project,
    ],
    {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        PATH: [f.bin, dirname(f.git)].join(delimiter),
        ...(process.platform === 'win32'
          ? { SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT }
          : {}),
        HOME: join(f.root, 'user'),
        USERPROFILE: join(f.root, 'user'),
        GIT_CEILING_DIRECTORIES: tmpdir(),
      },
    },
  )
}
function success(result) {
  expect(result.status, result.stdout + result.stderr).toBe(0)
}
function override(f, seat) {
  writeFileSync(
    join(f.project, 'agentflow.config.json'),
    JSON.stringify({
      adapters: { openrig: { executionPolicy: { seats: { 'dev.build': seat } } } },
    }),
  )
}
function squads(f) {
  return ['dev', 'pm', 'steer'].map((kind) => {
    const directory = join(f.home, '.openrig/specs', `agentflow-fixture-${kind}`)
    return {
      rig: parse(readFileSync(join(directory, 'rig.yaml'), 'utf8')),
      evidence: JSON.parse(readFileSync(join(directory, 'execution-contracts.json'), 'utf8')),
    }
  })
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('execution contracts through the public squads CLI (#517)', () => {
  it('plans all squads from an absent home without any filesystem effects', () => {
    const f = fixture()
    const before = snapshot(f.root)
    const result = cli(f, 'plan', '--json')
    success(result)
    const plan = JSON.parse(result.stdout)
    expect(plan).toMatchObject({ ok: true, effects: [], observation: 'not-performed' })
    expect(plan.plans.map((item) => item.kind).sort()).toEqual(['delivery', 'product', 'steer'])
    for (const item of plan.plans) {
      expect(item.contracts.length).toBeGreaterThan(0)
      for (const contract of item.contracts) {
        for (const field of ['seat', 'runtime', 'providerRoute', 'model', 'profile', 'effort'])
          expect(contract[field], field).toBeTruthy()
        if (contract.seat !== 'eval.tester') expect(contract.runtime).toBe('codex')
      }
    }
    expect(existsSync(f.home)).toBe(false)
    expect(snapshot(f.root)).toEqual(before)
  })

  it('rejects a malformed third steering configuration before writing any squad or exclusions', () => {
    const f = fixture({ installed: true })
    const config = join(f.home, '.openrig/specs/agentflow-steer/configurations.yaml')
    writeFileSync(config, readFileSync(config, 'utf8') + '\nrecommended: duplicate\n')
    const before = snapshot(f.root)
    const result = cli(f, 'provision')
    expect(result.status).not.toBe(0)
    expect(snapshot(f.root)).toEqual(before)
    for (const kind of ['dev', 'pm', 'steer'])
      expect(existsSync(join(f.home, '.openrig/specs', `agentflow-fixture-${kind}`))).toBe(false)
  })

  it('rejects an incompatible explicit project tuple with zero writes', () => {
    const f = fixture({ installed: true })
    override(f, {
      runtime: 'codex',
      providerRoute: 'munito',
      model: 'qwen/qwen3.8-27b',
      profile: 'builder',
      effort: 'medium',
    })
    const before = snapshot(f.root)
    expect(cli(f, 'provision').status).not.toBe(0)
    expect(snapshot(f.root)).toEqual(before)
  })

  it('materializes matching runtime, model, profile and effort in all squad YAML and sidecars', () => {
    const f = fixture({ installed: true })
    success(cli(f, 'provision'))
    for (const { rig, evidence } of squads(f)) {
      let count = 0
      for (const pod of rig.pods)
        for (const member of pod.members) {
          const contract = evidence.contracts.find((item) => item.seat === `${pod.id}.${member.id}`)
          expect(contract).toBeTruthy()
          expect(member).toMatchObject({
            runtime: contract.runtime,
            model: contract.model,
            profile: contract.profile,
            effort: contract.effort,
          })
          if (contract.seat !== 'eval.tester') expect(member.runtime).toBe('codex')
          count++
        }
      expect(evidence.contracts).toHaveLength(count)
    }
  })

  it('materializes an explicit Munito provider locator while retaining canonical sidecar attribution', () => {
    const f = fixture({ installed: true })
    override(f, {
      runtime: 'pi',
      providerRoute: 'munito',
      model: 'qwen/qwen3.8-27b',
      profile: 'builder-pi',
      effort: 'medium',
    })
    success(cli(f, 'provision'))
    const { rig, evidence } = squads(f)[0]
    const member = rig.pods
      .find((item) => item.id === 'dev')
      .members.find((item) => item.id === 'build')
    expect(member).toMatchObject({
      runtime: 'pi',
      profile: 'builder-pi',
      effort: 'medium',
      model: 'munito/qwen/qwen3.8-27b',
    })
    expect(evidence.contracts.find((item) => item.seat === 'dev.build')).toMatchObject({
      runtime: 'pi',
      providerRoute: 'munito',
      model: 'qwen/qwen3.8-27b',
      profile: 'builder-pi',
      effort: 'medium',
    })
  })
})
