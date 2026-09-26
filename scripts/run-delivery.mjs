#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { hostname, userInfo } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createFileRunStore } from '../lib/sources/run-store.mjs'
import { createGitHubRunStore, planGitHubCoordination } from '../lib/sources/github-run-store.mjs'
import { createGitHubApiCli } from '../lib/sources/github-api-cli.mjs'
import { createRunService, GovernedBlockError } from '../lib/application/run-service.mjs'
import { loadSdlcConfig } from '../lib/sdlc-state.mjs'
import {
  planProjection,
  publishProjection,
  reconcileProjection,
} from '../lib/application/publication-service.mjs'
import { collectProcessObservation } from '../lib/verification/process-collector.mjs'
import { fingerprintCandidate, containedPath } from '../lib/verification/workspace.mjs'
import { resolveObservation as resolveVerifiedObservation } from '../lib/verification/observation-resolver.mjs'
import { recordDigest } from '../lib/core/record-digest.mjs'
import { goalRevision } from '../lib/core/goal-revision.mjs'
import { validateDeliveryContract } from '../lib/core/delivery-policy.mjs'
import { RUN_ROLES, projectRunContext } from '../lib/core/run-state.mjs'
import { observeLocalWriter } from '../lib/providers/writer-status.mjs'
import { emitObservation } from '../lib/observability/observer.mjs'

export const RUN_EXIT_CODES = {
  success: 0,
  invalid: 2,
  blocked: 3,
  conflict: 4,
  unavailable: 5,
  unknown: 6,
}
const help =
  'Usage: agentflow-sdlc run <source-plan|start|status|context|next|freeze|verify|advance|checkpoint|pause|resume|resolve-escalation|publish> <id> [--target <dir>] [--execute] [--plan <file> --confirm <digest>] [--json]'

// W8e / D3 — replaces message-regex classification. A GovernedBlockError carries its exit code as a
// fact about the error (RUN_EXIT_CODES.blocked, documented and distinct from a genuine error), so
// rewording its message can never change the code. Everything else still falls back to the existing
// message heuristic, which this change leaves in place rather than migrating every throw site in
// the codebase — see the session report.
export function classifyDeliveryError(error) {
  if (error?.governed) return RUN_EXIT_CODES.blocked
  const message = error?.message ?? ''
  if (/stale|changed|conflict|Obsolete/.test(message)) return RUN_EXIT_CODES.conflict
  if (/unavailable|ENOENT/.test(message)) return RUN_EXIT_CODES.unavailable
  if (/required|blocked|authorized/.test(message)) return RUN_EXIT_CODES.blocked
  return RUN_EXIT_CODES.invalid
}

// W8e / D6 — one readable line per run command, printed before the (unchanged) JSON block when
// `--json` was not requested. `command === 'next'` is the one shape whose run-state projection is
// nested under `.status` rather than at the top level (see the `next` branch of runDelivery below).
function summarizeRunResult(command, result) {
  if (!result || typeof result !== 'object') return 'Done.'
  const projection = command === 'next' ? result.status : result
  const nextAction = projection?.nextAction
    ? ` Next: ${String(projection.nextAction).replaceAll('-', ' ')}.`
    : ''
  if (command === 'verify' && result.verification) {
    return result.verification.outcome === 'pass'
      ? `Evidence recorded: your check passed.${nextAction}`
      : `Evidence recorded: your check did not pass.${nextAction}`
  }
  if (typeof projection?.status === 'string' && projection.status !== 'absent') {
    return `Run "${projection.runId ?? ''}" is ${projection.status}.${nextAction}`
  }
  if (result.blocked) return `Blocked: acceptance criteria are not yet satisfied.${nextAction}`
  if (typeof result.digest === 'string') return 'Plan ready; rerun with --confirm to apply it.'
  return `Done.${nextAction}`
}

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
  // W8c D2 — calls the ONE shared revision recipe (lib/core/goal-revision.mjs); this used to type
  // the same {repo, number, title, body, updatedAt} recipe out inline, a second definition that
  // could silently drift from lib/cockpit-goal-model.mjs's own copy.
  const revision = goalRevision({
    repo: source.repo,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    updatedAt: issue.updated_at,
  })
  return {
    verified: value.goalRevision === revision,
    value,
    goalRevision: revision,
    sourceRevision: recordDigest({ goalRevision: revision, contractDigest: recordDigest(value) }),
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
  let observer = null
  const sessionId = randomUUID()
  const sessionStarted = performance.now()
  const readJson = (path) => {
    const bytes = readFileSync(containedPath(root, path))
    emitObservation(observer, {
      kind: 'file_read',
      bytes: bytes.length,
      files: 1,
      purpose: 'configuration',
    })
    return JSON.parse(bytes.toString('utf8'))
  }
  const readExecutionAdapter = () => {
    try {
      return readJson('agent-workflow.config.json')
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error(
          'Execution adapter unavailable: agent-workflow.config.json not found at the project root. Run `agentflow-sdlc adopt apply` to create it.',
        )
      throw new Error(`Execution adapter agent-workflow.config.json is invalid: ${error.message}`)
    }
  }
  const executionAdapter = readExecutionAdapter()
  const config = executionAdapter.delivery
  if (!config?.source || !config.candidate)
    throw new Error('Configure delivery.source and delivery.candidate first')
  const external = config.source.kind === 'github'
  if (!external && config.source.kind !== 'local-preview') throw new Error('Unsupported run source')
  const execute = args.includes('--execute')
  const boundary = flag('--boundary', external ? 'external-action' : 'mutate-worktree')
  // W8e / D4 — `--writer` used to be required plumbing typed on three of the six entry-path
  // commands. It now defaults to the local operator identity (the OS user name); `--writer` stays
  // available to override it (a shared machine, CI, or a name that differs from the OS account).
  const authority = {
    owner: flag('--writer', userInfo().username),
    generation: Number(flag('--generation', '0')),
    execute,
    boundary,
  }
  let telemetry = { observer: () => {}, shutdown: async () => {} }
  try {
    const { createTelemetry } = await import('../lib/observability/otel.mjs')
    telemetry = createTelemetry(executionAdapter.observability)
    observer = (event) => telemetry.observer({ ...event, runId: id, sessionId })
  } catch (err) {
    // ignore init failure
  }

  try {
    emitObservation(observer, { kind: 'session', state: 'started' })
    const client = external ? createGitHubApiCli({ observer }) : null
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
      // The run must be governed by the TARGET project's own configuration and posture. Without these,
      // run-service loaded config from process.cwd() - the framework checkout on the documented entry
      // path - and always used the default posture, silently ignoring what the adopter chose.
      sdlcConfig: loadSdlcConfig(root),
      posture: executionAdapter.posture,
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
      // W8f D1 — the run and the role-pass gate (scripts/validate-sdlc-role-pass.mjs) both resolve
      // observation trust through the ONE shared function; no second copy of this decision lives here.
      resolveObservation: async (observation) =>
        resolveVerifiedObservation({ root, config, observation }),
      observeWriter: async (state) => observeLocalWriter(state.writer),
      observeWorkspace: async () => ({
        verified: true,
        candidateDigest: fingerprintCandidate(root, config.candidate, { observer }).digest,
      }),
      reconcileOperation: async (operation) =>
        operation.kind === 'issue-projection' && client
          ? reconcileProjection({ client, plan: operation.plan })
          : { state: 'unknown' },
      observer,
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
                  o.criterionId === criterion.id &&
                  o.definitionDigest === criterion.definitionDigest,
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
      if (state.status !== 'active')
        throw new Error('Active run required before provider execution')
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
    } else if (command === 'resolve-escalation') {
      // D5 (W8c) — the escalated gate's path to satisfaction, reachable from the product's own `run`
      // CLI (bin/cli.mjs -> scripts/run-delivery.mjs). `--attestation` is a review-attestation record
      // (lib/core/review-attestation.mjs); only a real human attestation resolves it
      // (service.resolveEscalation enforces this via satisfyGate).
      //
      // W8c2 D2/D3 — the gate now ranges over the specific drift, not the bare candidate, so
      // resolveEscalation needs the SAME plan (`--plan`, `--confirm`) `next`/`advance` already use to
      // rebuild that drift deterministically — exactly the same confirmation shape `advance` requires
      // just above, never trusted without its digest matching.
      //
      // Final review B1 — DEFECT FIXED. The attestation came from a file the caller writes, and
      // "human" is a declared field on it, so any agent with a shell could resolve a weakening
      // escalation by writing `platform: "human"`. The CLI cannot authenticate a human, exactly as
      // `authorize` above already refuses `human-acceptance`, so it fails closed: a human resolution
      // must arrive through an authenticated channel, never a self-supplied file.
      throw new GovernedBlockError(
        'Escalation resolution requires an authenticated human channel; the run CLI cannot accept a self-supplied attestation',
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
    // W8e / D6 — a plain-language line before the JSON when `--json` was not requested; `--json`
    // output itself is untouched (still exactly `emit({ version: 1, result })`, nothing prepended).
    if (!args.includes('--json')) process.stdout.write(`${summarizeRunResult(command, result)}\n`)
    emit({ version: 1, result })
    emitObservation(observer, {
      kind: 'session',
      state: 'completed',
      duration: performance.now() - sessionStarted,
    })
    if (command === 'verify')
      emitObservation(observer, {
        kind: 'verification',
        outcome: ['pass', 'fail'].includes(result?.verification?.outcome)
          ? result.verification.outcome
          : 'unknown',
        duration: performance.now() - sessionStarted,
      })
    if (command === 'resume')
      emitObservation(observer, {
        kind: 'recovery',
        outcome: flag('--confirm') && result?.status === 'active' ? 'resumed' : 'unknown',
        duration: performance.now() - sessionStarted,
      })
    return result?.state === 'unknown'
      ? 6
      : result?.blocked || result?.verification?.outcome === 'fail'
        ? 3
        : 0
  } catch (error) {
    emitObservation(observer, {
      kind: 'session',
      state: 'failed',
      duration: performance.now() - sessionStarted,
    })
    throw error
  } finally {
    try {
      await telemetry.shutdown()
      if (executionAdapter.observability?.enabled && telemetry.getReport) {
        process.stderr.write(`${JSON.stringify({ telemetry: telemetry.getReport() })}\n`)
      }
    } catch (e) {}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runDelivery(process.argv.slice(2))
  } catch (error) {
    if (!process.argv.includes('--json')) process.stdout.write(`Blocked: ${error.message}\n`)
    process.stdout.write(`${JSON.stringify({ version: 1, error: error.message })}\n`)
    process.exitCode = classifyDeliveryError(error)
  }
}
