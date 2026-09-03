import { randomUUID } from 'node:crypto'
import { createRunEvent, reduceRun, projectRunStatus, RUN_ROLES } from '../core/run-state.mjs'
import { sealDeliveryRecord, requireDeliveryRecord } from '../core/delivery-record.mjs'
import { verifyObservation } from '../core/verification-observation.mjs'
import { verifyRoleAdvance } from '../core/role-collaboration.mjs'
import { recordDigest } from '../core/record-digest.mjs'
import {
  validateDeliveryContract,
  journeyCoverage,
  budgetAdmission,
  resolveDeliveryPolicy,
} from '../core/delivery-policy.mjs'

// The host supplies authorization, resolvers and writer status. User-authored records do not grant authority.
export function createRunService({
  store,
  authorize,
  resolveContract,
  resolveCollaboration,
  resolveObservation,
  observeWriter,
  observeWorkspace,
  reconcileOperation,
  budget = null,
  policy = {},
  observeUsage,
  requestSafeStop,
  clock = () => new Date().toISOString(),
}) {
  if (typeof authorize !== 'function') throw new Error('Host authorization callback required')
  const deliveryPolicy = resolveDeliveryPolicy(policy, budget)
  const read = async () => {
    const snapshot = await store.read()
    return { ...snapshot, state: reduceRun(snapshot.events) }
  }
  const append = async (kind, payload, expected, authority, identity = {}) => {
    const snapshot = await read()
    if (snapshot.revision !== expected) throw new Error('Run changed; replan')
    const expectedOwner =
      identity.recoveryOwner ?? (kind === 'resumed' ? payload.owner : snapshot.state?.owner)
    if (
      snapshot.state &&
      (authority?.generation !== snapshot.state.generation || authority?.owner !== expectedOwner)
    )
      throw new Error('Obsolete writer identity or generation')
    if (
      (await authorize({
        kind: identity.authorizationKind ?? kind,
        payload,
        state: snapshot.state,
        authority,
      })) !== true
    )
      throw new Error('Action is not authorized')
    const event = createRunEvent({
      runId: snapshot.state?.runId ?? identity.runId,
      id: randomUUID(),
      previousDigest: expected,
      generation: snapshot.state?.generation ?? 0,
      kind,
      payload,
      timestamp: clock(),
    })
    await store.append(event, expected)
    return projectRunStatus(reduceRun([...snapshot.events, event]), { durable: store.durable })
  }
  return {
    read,
    async status() {
      return projectRunStatus((await read()).state, { durable: store.durable, observedAt: clock() })
    },
    async admitAttempt({ estimatedNext, authority }) {
      const { state } = await read()
      if (!state || authority?.owner !== state.owner || authority?.generation !== state.generation)
        throw new Error('Current writer identity and generation required for admission')
      if (state.status !== 'active') throw new Error('Active run required for admission')
      if ((await authorize({ kind: 'attempt', state, authority })) !== true)
        throw new Error('Attempt is not authorized')
      if (recordDigest(state.budget ?? null) !== recordDigest(budget))
        throw new Error('Run budget configuration changed; start a new reviewed run')
      if (!budget) return { admitted: true, level: 'unconfigured', known: false }
      const usage = typeof observeUsage === 'function' ? await observeUsage(state) : null
      const result = budgetAdmission({
        budget,
        used:
          usage?.verified === true && (!budget.unit || usage.unit === budget.unit)
            ? usage.used
            : null,
        estimatedNext,
        providerCanStop: typeof requestSafeStop === 'function',
      })
      const usageValue =
        usage?.verified === true &&
        (!budget.unit || usage.unit === budget.unit) &&
        Number.isFinite(usage.used) &&
        usage.used >= 0
          ? usage.used
          : null
      const admission = await append(
        'budget-admission',
        {
          result,
          used: usageValue,
          usageKnown: usageValue !== null,
          estimateKnown: Number.isFinite(estimatedNext) && estimatedNext >= 0,
          estimatedNext: Number.isFinite(estimatedNext) ? estimatedNext : null,
          unit: budget.unit ?? null,
        },
        state.revision,
        authority,
      )
      if (!result.admitted) {
        const checkpoint = await append(
          'paused',
          { reason: result.reason },
          admission.revision,
          authority,
        )
        result.safeStop = 'unavailable'
        let revision = checkpoint.revision,
          intent = null
        if (typeof requestSafeStop === 'function') {
          const pausedState = (await read()).state
          if (pausedState.revision !== revision)
            throw new Error('Run changed before stop authorization')
          if ((await authorize({ kind: 'safe-stop', state: pausedState, authority })) !== true) {
            result.safeStop = 'not-authorized'
            return result
          }
          const request = {
            runId: state.runId,
            generation: state.generation,
            owner: state.owner,
            reason: result.reason,
            runRevision: revision,
          }
          intent = {
            id: randomUUID(),
            kind: 'provider-safe-stop',
            payloadDigest: recordDigest(request),
            request,
            state: 'planned',
          }
          revision = (await append('operation', intent, revision, authority)).revision
          revision = (
            await append('operation', { ...intent, state: 'submitted' }, revision, authority)
          ).revision
        }
        // Persist the resumable boundary before asking an external provider to stop.
        // The provider must fence its own action against this writer generation.
        const stopState = (await read()).state
        if (stopState.revision !== revision) throw new Error('Run changed before safe stop')
        if (intent) {
          let stopped
          try {
            stopped = await requestSafeStop(stopState, {
              authority,
              revision,
              operationId: intent.id,
            })
            result.safeStop =
              stopped?.verified === true && stopped.stopped === true ? 'confirmed' : 'unknown'
          } catch {
            result.safeStop = 'unknown'
          }
          const reconciliation = {
            verified: result.safeStop === 'confirmed',
            state: result.safeStop,
            stopped: result.safeStop === 'confirmed',
          }
          await append(
            'operation',
            { ...intent, state: result.safeStop, reconciliation, result: reconciliation },
            revision,
            authority,
          )
        }
      }
      return result
    },
    async start({
      runId,
      goalRef,
      owner,
      profile = 'standard',
      boundary = 'observe',
      writer = null,
      authority,
    }) {
      return append(
        'started',
        { goalRef, owner, profile, boundary, writer, budget },
        null,
        authority,
        {
          runId,
        },
      )
    },
    async record(kind, payload, { expectedRevision, authority }) {
      if (
        ![
          'candidate',
          'observation',
          'returned',
          'checkpoint',
          'operation',
          'blocked',
          'paused',
        ].includes(kind)
      )
        throw new Error('Use governed service for this transition')
      if (kind === 'operation' && !['planned', 'submitted', 'unknown'].includes(payload.state))
        throw new Error('Operation outcomes require source reconciliation')
      return append(kind, payload, expectedRevision, authority)
    },
    async freezeContract({ expectedRevision, authority }) {
      const { state } = await read()
      if (state?.revision !== expectedRevision || typeof resolveContract !== 'function')
        throw new Error('Current authoritative contract resolver required')
      const contract = await resolveContract(state)
      if (
        contract?.verified !== true ||
        !validateDeliveryContract(contract.value).ok ||
        !contract.sourceRevision
      )
        throw new Error('Authoritative acceptance criteria unavailable')
      if (deliveryPolicy.requiredJourneyCoverage && !contract.value.journeys?.length)
        throw new Error('Journey coverage required by domain policy')
      return append(
        'contract-frozen',
        { contract: contract.value, sourceRevision: contract.sourceRevision },
        expectedRevision,
        authority,
      )
    },
    async verifyCriteria(contract) {
      const { state } = await read()
      if (
        !state ||
        contract.candidateDigest !== state.candidateDigest ||
        contract.runRevision !== state.revision
      )
        throw new Error('Acceptance contract is stale')
      const current = typeof resolveContract === 'function' ? await resolveContract(state) : null
      if (
        !state.contract ||
        current?.verified !== true ||
        current.sourceRevision !== state.contractSourceRevision ||
        recordDigest(current.value) !== recordDigest(state.contract)
      )
        throw new Error('Frozen contract is missing or changed')
      if (
        recordDigest(contract.criteria.map(({ observationDigest, ...criterion }) => criterion)) !==
        recordDigest(state.contract.criteria)
      )
        throw new Error('Acceptance criteria cannot be changed at verification')
      if (!Array.isArray(contract.criteria) || !contract.criteria.length)
        throw new Error('Explicit acceptance criteria required')
      const results = []
      for (const criterion of contract.criteria) {
        const observation = state.observations.find(
          (item) =>
            item.digest === criterion.observationDigest && item.criterionId === criterion.id,
        )
        const resolved =
          typeof resolveObservation === 'function' && observation
            ? await resolveObservation(observation)
            : null
        results.push(
          verifyObservation({
            observation: resolved?.observation ?? observation,
            candidateDigest: state.candidateDigest,
            definitionDigest: criterion.definitionDigest,
            requiredAssertions: criterion.assertions,
            allowedOrigins: (
              criterion.allowedOrigins ?? deliveryPolicy.deterministicOrigins
            ).filter((origin) => deliveryPolicy.deterministicOrigins.includes(origin)),
            requireImmutable: criterion.requireImmutable,
            maxAgeMs: criterion.maxAgeMs ?? null,
            now: clock(),
            sourceVerified:
              resolved?.verified === true && resolved.observation?.digest === observation?.digest,
          }),
        )
      }
      const coverage = journeyCoverage({
        journeys: state.contract.journeys ?? [],
        criteria: state.contract.criteria,
        candidateDigest: state.candidateDigest,
        observations: contract.criteria.map((c, i) => ({
          criterionId: c.id,
          candidateDigest: state.candidateDigest,
          resolution: results[i],
        })),
      })
      return sealDeliveryRecord('run-acceptance', {
        candidateDigest: state.candidateDigest,
        runRevision: state.revision,
        results,
        coverage,
        status:
          results.every((r) => r.status === 'pass') && coverage.status === 'pass'
            ? 'pass'
            : 'blocked',
      })
    },
    async advance({ contract, authority }) {
      const { state } = await read()
      if (
        state?.profile === 'high-assurance' &&
        state.phase >= 6 &&
        (await authorize({ kind: 'human-acceptance', state, authority, contract })) !== true
      )
        throw new Error('Human acceptance is unresolved')
      const collaboration =
        typeof resolveCollaboration === 'function' ? await resolveCollaboration(state) : null
      if (
        collaboration?.verified !== true ||
        !verifyRoleAdvance({
          ...collaboration.sources,
          openReworkRequests: Object.values(state.openRework),
        }).ok
      )
        throw new Error('Current bilateral role acceptance is required')
      const sources = collaboration.sources,
        frozen = state.contract
      if (
        !frozen ||
        sources.handoff?.subject !== state.goalRef ||
        sources.contract?.candidateDigest !== state.candidateDigest ||
        sources.contract?.digest !== frozen.collaborationContractDigest ||
        sources.contract?.ownerRole !== frozen.ownerRole ||
        sources.contract?.deliveryRole !== `agentflow:${RUN_ROLES[state.phase]}`
      )
        throw new Error('Bilateral acceptance belongs to another run, candidate or phase')
      const acceptance = await this.verifyCriteria(contract)
      if (acceptance.status !== 'pass')
        throw new Error('Acceptance blocked by unresolved verification')
      return append(
        state.phase === 8 ? 'completed' : 'advanced',
        {
          from: state.phase,
          to: state.phase + 1,
          candidateDigest: state.candidateDigest,
          acceptanceDigest: acceptance.digest,
        },
        acceptance.runRevision,
        authority,
      )
    },
    async resolveRework({ id, contract, authority }) {
      const acceptance = await this.verifyCriteria(contract)
      const { state } = await read()
      const finding = state.openRework[id]
      if (
        !finding ||
        acceptance.status !== 'pass' ||
        !finding.criteria?.length ||
        finding.criteria.some((id) => !contract.criteria.some((criterion) => criterion.id === id))
      )
        throw new Error('Rework requires verified evidence for every finding criterion')
      return append(
        'rework-resolved',
        {
          id,
          observationDigests: contract.criteria
            .filter((c) => finding.criteria.includes(c.id))
            .map((c) => c.observationDigest),
        },
        acceptance.runRevision,
        authority,
      )
    },
    async reconcile(id, { expectedRevision, authority }) {
      const { state } = await read()
      if (
        state.revision !== expectedRevision ||
        !state.operations[id] ||
        typeof reconcileOperation !== 'function'
      )
        throw new Error('Current operation resolver required')
      const result = await reconcileOperation(state.operations[id])
      if (result?.verified !== true || !['confirmed', 'failed'].includes(result.state))
        throw new Error('External operation outcome remains unknown')
      return append(
        'operation',
        { ...state.operations[id], state: result.state, reconciliation: result, result },
        expectedRevision,
        authority,
      )
    },
    async recoveryPlan({ owner, boundary, writer }) {
      const { state } = await read()
      if (!state) throw new Error('Run does not exist')
      const priorWriter =
        typeof observeWriter === 'function' ? await observeWriter(state) : { stopped: null }
      const workspace =
        typeof observeWorkspace === 'function' ? await observeWorkspace(state) : null
      const pending = Object.values(state.operations).filter(
        (op) => !['confirmed', 'failed'].includes(op.state),
      )
      const operations = []
      for (const operation of pending)
        operations.push({
          id: operation.id,
          result:
            typeof reconcileOperation === 'function'
              ? await reconcileOperation(operation)
              : { state: 'unknown' },
        })
      return sealDeliveryRecord('recovery-plan', {
        runId: state.runId,
        runRevision: state.revision,
        owner,
        boundary,
        writer: writer ?? null,
        priorWriter,
        workspace,
        operations,
        candidateChanged: workspace?.candidateDigest !== state.candidateDigest,
        blocked:
          priorWriter?.stopped !== true ||
          !writer?.instance ||
          !writer?.host ||
          !Number.isInteger(writer?.pid) ||
          writer.pid < 1 ||
          !workspace ||
          workspace.verified !== true ||
          operations.some(
            (op) =>
              op.result?.verified !== true || !['confirmed', 'failed'].includes(op.result?.state),
          ),
      })
    },
    async resume({ plan, authority }) {
      requireDeliveryRecord(plan, 'recovery-plan')
      const current = await this.recoveryPlan({
        owner: plan.owner,
        boundary: plan.boundary,
        writer: plan.writer,
      })
      if (current.digest !== plan.digest || current.blocked)
        throw new Error('Recovery changed or remains blocked')
      let { state } = await read()
      if (state.revision !== plan.runRevision)
        throw new Error('Run changed during recovery inspection')
      let expectedRevision = plan.runRevision
      for (const op of current.operations) {
        const old = state.operations[op.id]
        const own = await append(
          'operation',
          { ...old, state: op.result.state, reconciliation: op.result },
          expectedRevision,
          authority,
          { recoveryOwner: plan.owner, authorizationKind: 'takeover-reconciliation' },
        )
        expectedRevision = own.revision
      }
      const finalWriter = typeof observeWriter === 'function' ? await observeWriter(state) : null
      const finalWorkspace =
        typeof observeWorkspace === 'function' ? await observeWorkspace(state) : null
      if (
        finalWriter?.stopped !== true ||
        recordDigest(finalWorkspace) !== recordDigest(current.workspace)
      )
        throw new Error('Recovery context changed before writer transfer')
      return append(
        'resumed',
        {
          owner: plan.owner,
          writer: plan.writer,
          boundary: plan.boundary,
          previousOwnerStopped: true,
          invalidateCandidate: current.candidateChanged,
        },
        expectedRevision,
        authority,
      )
    },
  }
}
