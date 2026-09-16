#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createFileRunStore } from '../lib/sources/run-store.mjs'
import { createGitHubRunStore, planGitHubCoordination } from '../lib/sources/github-run-store.mjs'
import { createGitHubApiCli } from '../lib/sources/github-api-cli.mjs'
import { createRunService } from '../lib/application/run-service.mjs'
import {
  planProjection,
  publishProjection,
  reconcileProjection,
} from '../lib/application/publication-service.mjs'
import {
  collectProcessObservation,
  inspectProcessRuntime,
} from '../lib/verification/process-collector.mjs'
import { fingerprintCandidate, containedPath } from '../lib/verification/workspace.mjs'
import { recordDigest } from '../lib/core/record-digest.mjs'
import { validateDeliveryContract } from '../lib/core/delivery-policy.mjs'
import { RUN_ROLES, projectRunContext } from '../lib/core/run-state.mjs'
import { observeLocalWriter } from '../lib/providers/writer-status.mjs'

export const RUN_EXIT_CODES = {
  success: 0,
  invalid: 2,
  blocked: 3,
  conflict: 4,
  unavailable: 5,
  unknown: 6,
}
const help =
  'Usage: agentflow-sdlc run <source-plan|start|status|context|next|freeze|verify|advance|checkpoint|pause|resume|publish> <id> [--target <dir>] [--writer <id> --generation <n> --execute] [--plan <file> --confirm <digest>] [--json]'

export async function resolveDeliveryContract({ value, state, source, client }) {
  const validation = validateDeliveryContract(value)
  if (!validation.ok) return { verified: false }
  if (source.kind === 'local-preview')
    return { verified: true, value, sourceRevision: recordDigest(value) }
  if (!/^[\w.-]+\/[\w.-]+$/.test(source.repo)) throw new Error('Exact goal repository required')
  const reference = /^issue:([1-9]\d*)$/.exec(state.goalRef)
  const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/.exec(state.goalRef)
  const number = reference?.[1] ?? (url?.[1] === source.repo ? url[2] : null)
  if (!number) throw new Error('Goal must identify an issue in the configured repository')
  const issue = await client.request(`/repos/${source.repo}/issues/${number}`)
  if (
    issue.pull_request ||
    issue.number !== Number(number) ||
    !issue.updated_at ||
    typeof issue.body !== 'string'
  )
    throw new Error('Authoritative goal issue unavailable')
  const goalRevision = recordDigest({
    repo: source.repo,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    updatedAt: issue.updated_at,
  })
  return {
    verified: value.goalRevision === goalRevision,
    value,
    goalRevision,
    sourceRevision: recordDigest({ goalRevision, contractDigest: recordDigest(value) }),
  }
}

export async function runDelivery(
  args,
  { emit = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`) } = {},
) {
  const flag = (name, fallback) => {
    const i = args.indexOf(name)
    return i < 0 ? fallback : args[i + 1]
  }
  const [command, id] = args
  if (!command || args.includes('--help')) {
    emit({ version: 1, usage: help })
    return 0
  }
  const root = resolve(flag('--target', process.cwd()))
  const readJson = (path) => JSON.parse(readFileSync(containedPath(root, path), 'utf8'))
  const config = readJson('agent-workflow.config.json').delivery
  if (!config?.source || !config.candidate)
    throw new Error('Configure delivery.source and delivery.candidate first')
  const external = config.source.kind === 'github'
  if (!external && config.source.kind !== 'local-preview') throw new Error('Unsupported run source')
  const execute = args.includes('--execute')
  const boundary = flag('--boundary', external ? 'external-action' : 'mutate-worktree')
  const authority = {
    owner: flag('--writer'),
    generation: Number(flag('--generation', '0')),
    execute,
    boundary,
  }
  const client = external ? createGitHubApiCli() : null
  const store = external
    ? createGitHubRunStore({
        ...config.source,
        runId: id,
        client,
        boundary: execute ? boundary : 'observe',
        setupConfirm: flag('--setup-confirm'),
      })
    : createFileRunStore({ root, runId: id })
  const phaseContract = (state) => config.contracts?.[RUN_ROLES[state.phase]]
  const domainPath = ['sdlc.config.json', 'defaults/sdlc.config.json'].find((path) =>
    existsSync(containedPath(root, path, { allowMissing: true })),
  )
  const service = createRunService({
    store,
    policy: domainPath ? readJson(domainPath).deliveryPolicy : {},
    budget: config.budget ?? null,
    authorize: async ({ kind }) =>
      execute &&
      Boolean(authority.owner) &&
      kind !== 'human-acceptance' &&
      (!external || boundary === 'external-action'),
    resolveContract: async (state) => {
      const path = phaseContract(state)
      if (!path) return null
      return resolveDeliveryContract({
        value: readJson(path),
        state,
        source: config.source,
        client,
      })
    },
    resolveCollaboration: async (state) => {
      const path = config.collaboration?.[RUN_ROLES[state.phase]]
      return path ? { verified: true, sources: readJson(path) } : null
    },
    resolveObservation: async (observation) => {
      if (observation.origin !== 'collector-observed' || !/^[a-f0-9-]{36}$/.test(observation.id))
        return { verified: false, observation }
      const path = `.agent-runs/verification/${observation.id}/observation.json`
      const current = readJson(path)
      const candidate = fingerprintCandidate(root, config.candidate)
      const check = Object.values(config.checks ?? {}).find(
        (check) =>
          check.criterionId === observation.criterionId &&
          recordDigest({ ...check, ...config.candidate }) === observation.definitionDigest,
      )
      const runtime = check ? inspectProcessRuntime(root, check).identity : null
      return {
        verified:
          current.digest === observation.digest &&
          candidate.digest === observation.candidateDigest &&
          runtime !== null &&
          runtime.digest === observation.executionContextDigest,
        observation: current,
      }
    },
    observeWriter: async (state) => observeLocalWriter(state.writer),
    observeWorkspace: async () => ({
      verified: true,
      candidateDigest: fingerprintCandidate(root, config.candidate).digest,
    }),
    reconcileOperation: async (operation) =>
      operation.kind === 'issue-projection' && client
        ? reconcileProjection({ client, plan: operation.plan })
        : { state: 'unknown' },
  })
  let result
  if (command === 'source-plan') {
    if (!client) throw new Error('Source setup planning requires a GitHub binding')
    result = await planGitHubCoordination({ ...config.source, client })
  } else if (command === 'start') {
    result = await service.start({
      runId: id,
      goalRef: flag('--goal'),
      owner: authority.owner,
      profile: flag('--profile', 'standard'),
      boundary,
      writer: {
        host: hostname(),
        pid: Number(flag('--writer-pid', String(process.ppid))),
        instance: randomUUID(),
      },
      authority,
    })
  } else if (command === 'status') result = await service.status()
  else if (command === 'context') result = projectRunContext((await service.read()).state)
  else if (command === 'next') {
    const { state } = await service.read()
    result = { status: await service.status() }
    if (state?.contract && state.candidateDigest) {
      const plan = {
        candidateDigest: state.candidateDigest,
        runRevision: state.revision,
        criteria: state.contract.criteria.map((criterion) => ({
          ...criterion,
          observationDigest:
            state.observations.findLast(
              (o) =>
                o.criterionId === criterion.id && o.definitionDigest === criterion.definitionDigest,
            )?.digest ?? null,
        })),
      }
      result.advancePlan = plan
      result.confirm = recordDigest(plan)
    }
  } else if (command === 'freeze')
    result = await service.freezeContract({
      expectedRevision: (await service.read()).revision,
      authority,
    })
  else if (command === 'verify') {
    const check = config.checks?.[flag('--check')]
    if (!check) throw new Error('Configured --check required')
    let { state } = await service.read()
    if (!state?.contract) throw new Error('Freeze criteria before execution')
    if (state.status !== 'active') throw new Error('Active run required before provider execution')
    const boundaries = ['observe', 'propose', 'mutate-worktree', 'open-pr', 'external-action']
    if (
      boundaries.indexOf(state.boundary) < 2 ||
      boundaries.indexOf(boundary) > boundaries.indexOf(state.boundary)
    )
      throw new Error('Requested execution exceeds run action authority')
    if (!execute || authority.owner !== state.owner || authority.generation !== state.generation)
      throw new Error('Current writer execution authority required')
    if (
      !(await service.admitAttempt({ estimatedNext: config.budget?.estimatedNext, authority }))
        .admitted
    )
      throw new Error('Budget admission blocked; checkpoint preserved')
    state = (await service.read()).state
    const definition = { ...check, ...config.candidate }
    if (
      !state.contract.criteria.some(
        (c) => c.id === check.criterionId && c.definitionDigest === recordDigest(definition),
      )
    )
      throw new Error('Check differs from frozen criterion definition')
    const collected = collectProcessObservation({ root, definition, boundary })
    if (state.candidateDigest !== collected.candidate.digest) {
      await service.record(
        'candidate',
        { digest: collected.candidate.digest },
        { expectedRevision: state.revision, authority },
      )
      state = (await service.read()).state
    }
    result = await service.record(
      'observation',
      { observation: collected.observation },
      { expectedRevision: state.revision, authority },
    )
    result.verification = {
      outcome: collected.observation.outcome,
      observationDigest: collected.observation.digest,
    }
  } else if (command === 'advance') {
    const { state } = await service.read()
    const contract = readJson(flag('--plan'))
    if (flag('--confirm') !== recordDigest(contract))
      throw new Error('Advance plan confirmation mismatch')
    if (contract.runRevision !== state.revision) throw new Error('Advance plan is stale')
    result = await service.advance({ contract, authority })
  } else if (command === 'checkpoint' || command === 'pause') {
    result = await service.record(
      command === 'pause' ? 'paused' : 'checkpoint',
      { reason: flag('--reason', 'Requested operator checkpoint') },
      { expectedRevision: (await service.read()).revision, authority },
    )
  } else if (command === 'resume') {
    if (!flag('--confirm'))
      result = await service.recoveryPlan({
        owner: authority.owner,
        boundary,
        writer: {
          host: hostname(),
          pid: Number(flag('--writer-pid', String(process.ppid))),
          instance: randomUUID(),
        },
      })
    else {
      const plan = readJson(flag('--plan'))
      if (plan.digest !== flag('--confirm')) throw new Error('Recovery confirmation mismatch')
      result = await service.resume({ plan, authority })
    }
  } else if (command === 'publish') {
    if (!client) throw new Error('Publishing requires a durable GitHub source')
    if (!flag('--confirm'))
      result = planProjection({
        status: await service.status(),
        repo: config.source.repo,
        issueNumber: Number(flag('--issue')),
      })
    else
      result = await publishProjection({
        service,
        client,
        plan: readJson(flag('--plan')),
        confirm: flag('--confirm'),
        authority,
      })
  } else throw new Error(help)
  emit({ version: 1, result })
  return result?.state === 'unknown'
    ? 6
    : result?.blocked || result?.verification?.outcome === 'fail'
      ? 3
      : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runDelivery(process.argv.slice(2))
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ version: 1, error: error.message })}\n`)
    process.exitCode = /stale|changed|conflict|Obsolete/.test(error.message)
      ? 4
      : /unavailable|ENOENT/.test(error.message)
        ? 5
        : /required|blocked|authorized/.test(error.message)
          ? 3
          : 2
  }
}
