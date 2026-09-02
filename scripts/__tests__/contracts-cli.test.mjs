import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRoleHandoff } from '../../lib/role-catalog.mjs'
import { createAcceptanceContract } from '../../lib/core/role-collaboration.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cli = join(repoRoot, 'bin', 'cli.mjs')

function fixture() {
  const target = mkdtempSync(join(tmpdir(), 'agentflow-contract-cli-'))
  cpSync(join(repoRoot, 'defaults', 'sdlc.config.json'), join(target, 'sdlc.config.json'))
  return target
}

function run(target, args) {
  return JSON.parse(
    execFileSync(process.execPath, [cli, 'sdlc', ...args, '--target', target, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  )
}

describe('contract CLI surfaces', () => {
  it('validates portable evidence and lifecycle records relative to --target', () => {
    const target = fixture()
    const artifact = {
      kind: 'goal',
      system: 'github',
      uri: 'https://example.test/issues/1',
      authority: 'authoritative',
      relationship: 'input',
      revision: 'abc',
    }
    writeFileSync(join(target, 'artifact.json'), JSON.stringify(artifact))
    writeFileSync(
      join(target, 'boundary.json'),
      JSON.stringify({
        version: 1,
        profile: 'standard',
        requested: 'open-pr',
        effective: 'mutate-worktree',
      }),
    )
    expect(
      run(target, ['validate-evidence', '--type', 'artifact-ref', '--path', 'artifact.json']).ok,
    ).toBe(true)
    expect(
      run(target, ['validate-lifecycle', '--type', 'action-boundary', '--path', 'boundary.json'])
        .ok,
    ).toBe(true)
  })

  it('validates digest-bound role handoffs relative to --target', () => {
    const target = fixture()
    mkdirSync(join(target, 'manifests'), { recursive: true })
    cpSync(
      join(repoRoot, 'manifests', 'role-catalog.json'),
      join(target, 'manifests', 'role-catalog.json'),
    )
    const handoff = createRoleHandoff({
      id: 'handoff-1',
      subject: 'issue:188',
      state: 'issued',
      fromRole: 'agentflow:developer',
      toRole: 'agentflow:tester',
      rolePassId: 'phase-4',
      profile: 'standard',
      actionBoundary: 'observe',
      inputRefs: [],
      outputRefs: [
        {
          kind: 'implementation',
          system: 'git',
          uri: 'working-copy',
          authority: 'authoritative',
          relationship: 'implements',
        },
      ],
      validationRefs: [],
      expectedAction: 'run deterministic validation',
      acceptanceCriteria: ['implementation evidence is readable'],
      acceptanceContract: createAcceptanceContract({
        id: 'acceptance-1',
        subject: 'issue:188',
        ownerRole: 'agentflow:developer',
        deliveryRole: 'agentflow:tester',
        collaborationClass: 'bilateral',
        candidateDigest: 'a'.repeat(64),
        criteria: [
          {
            id: 'evidence-readable',
            description: 'implementation evidence is readable',
            verification: 'deterministic',
            required: true,
          },
        ],
        councilPolicy: { required: false, seats: [], decisionOwner: 'agentflow:developer' },
      }),
      openQuestions: [],
      methodPlays: [],
      provenance: {
        platform: 'codex',
        executor: 'codex-cli',
        transport: 'local-cli',
        delegationBoundary: 'current-session',
      },
    })
    writeFileSync(join(target, 'role-handoff.json'), JSON.stringify(handoff))
    expect(
      run(target, ['validate-evidence', '--type', 'role-handoff', '--path', 'role-handoff.json'])
        .ok,
    ).toBe(true)
  })

  it('runs evals and metrics relative to --target', () => {
    const target = fixture()
    const manifestDir = join(target, 'agents', 'evals', 'manifests')
    const fixtureDir = join(target, 'agents', 'evals', 'fixtures')
    mkdirSync(manifestDir, { recursive: true })
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(join(fixtureDir, 'output.txt'), 'Role: analyst\n')
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        version: 1,
        id: 'cli',
        owner: 'reviewer',
        subject: { kind: 'fixture', path: 'output.txt' },
        cases: [
          {
            id: 'output',
            actual: '../fixtures/output.txt',
            assertions: [{ type: 'contains', value: 'Role: analyst' }],
          },
        ],
      }),
    )
    writeFileSync(
      join(target, 'events.json'),
      JSON.stringify([
        { id: '1', subject: 'issue:1', type: 'work-started', timestamp: '2026-08-31T10:00:00Z' },
        { id: '2', subject: 'issue:1', type: 'pr-ready', timestamp: '2026-08-31T11:00:00Z' },
      ]),
    )
    expect(
      run(target, ['run-evals', '--manifest', 'agents/evals/manifests/manifest.json']).ok,
    ).toBe(true)
    expect(
      run(target, ['derive-metrics', '--path', 'events.json']).samples[0].cycleTimeSeconds,
    ).toBe(3600)
  })
})
