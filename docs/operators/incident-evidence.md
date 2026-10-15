# Source-backed incident evidence

`adapters/openrig/incident-evidence.mjs` reports existing run-source evidence without
executing recovery, changing custody, creating grants, or starting another state ledger.
This capability is read-only. Its output is cooperative evidence, including for a GitHub
source shared by agents; a checksum or an ArtifactRef marked `authoritative` does not
establish an authenticated human decision.

## Host integration

```js
import { summarizeConfiguredIncidents } from './adapters/openrig/incident-evidence.mjs'

const incidents = await summarizeConfiguredIncidents({
  root,
  runId,
  client, // existing injected configured-source client; no credential discovery
  resolveEvidence, // optional trusted host reader, described below
  timeoutMs: 1000,
})
```

The public `run incidents` command reads the configured source through this module.
A status command can also attach this result; no runtime observation reader is installed. Without an
independently bound evidence reader, claims remain unknown. `summarizeIncidentEvidence`
also accepts a trusted `resolveSource()` returning `{source, revision, sourceRevision,
events}`. Canonical run reduction checks event seals, parent links, run identity, and
current revision before resolving evidence. Duplicate immutable event identities are
ignored; repeated references to the same execution receipt revision/digest count once; changing the observed chain head does not create another incident identity.

## Checkpoint reference convention, version 1

Existing checkpoint payloads may reference evidence with this optional envelope:

```js
{
  incidentEvidence: {
    version: 1,
    configuredIntent: { runtime: 'pi', providerRoute: 'munito', model: 'qwen/qwen3.8-27b' },
    executionRef: artifactRef,
    oracle: [{
      stage: 'produced',
      artifactDigest,
      candidateDigest,
      evidenceRef: observationRef,
    }],
  },
}
```

References use canonical portable ArtifactRefs with both digest and revision. The
checkpoint supplies references and configured intent; it does not certify their claims.
This is a reporting convention, not a new run-event type or admission authority. Existing
runs without it remain valid and report no synthesized incidents. Unknown convention
versions are ignored.

The trusted host `resolveEvidence({ref, eventIdentity, source})` independently loads the
referenced immutable source record and returns `{eventId, eventDigest, revision, digest,
record, observedExecution?}`. Every returned binding must match the requested event and
reference exactly. A resolver must actually verify its source and producer before returning
this object; copying the caller's claims is not verification. Request data, JSON files,
checkpoint flags, and CLI arguments must never create a trusted resolver. Exceptions and
timeouts become unknown results without exposing raw error text. The timeout is an overall reader budget, bounded to 60 seconds. Sources are capped at
10,000 events, evidence reads at 500, oracle claims at 100 per checkpoint and 500 overall.
Exhaustion is explicit; this is not an execution or recovery deadline controller.
Timed-out reads are not cancellation guarantees; host readers must keep their own I/O bounded.

Execution records must pass the existing canonical execution-receipt validator. Only a
receipt with status `failed` and a recognized structured `metadata.structuredError` counts
as a classified failure. Usage metadata, repeated prose, string IDs containing `429` or
`502`, successful receipts, and unverified checkpoint errors do not count. Runtime, target,
transport and model come from the resolved receipt's `actual` fields. Provider route and
effort remain null unless the trusted reader independently observed an exact matching
runtime/model tuple in `observedExecution`. Configured intent remains separate.

## Oracle proof stages

The independent states are `produced`, `calibrated`, `independentlyAccepted`, and
`integrated`, grouped by exact artifact and candidate digests. One stage never proves
another. A produced package with a failed acceptance observation remains produced and
rejected, with calibration and integration unknown unless separately evidenced.

Each stage uses an existing sealed `verification-observation`, resolved independently:

- `criterionId` is `oracle.<stage>` and a matching assertion supplies its outcome.
- `subject` contains the exact `stage` and `artifactDigest`; `candidateDigest` also matches.
- Origin is `collector-observed` or `external-resolved`. Testimony remains unknown.
- Successful independent acceptance additionally requires an `external-resolved` review
  observation, distinct source-resolved
  `subject.authorIdentity` and `subject.reviewerIdentity`, and a passing
  `oracle.independent-review` assertion. These evidence requirements do not grant either
  identity production authority or replace human acceptance gates.

Conflicting resolved proof is reported as `conflicting`, never accepted by ordering.
Native custody remains the canonical source ledger's responsibility; artifact production,
a digest pin, successful command exit, and a queue acknowledgment do not establish custody.

## Rehearsal evidence and limits

On baseline `7f1d80f`, the existing preflight CLI, steering authority, merge policy,
handoff custody, runtime compatibility and mutation tests passed 104 checks:

```sh
pnpm exec vitest run scripts/__tests__/operational-preflight-cli.test.mjs scripts/__tests__/steering-authority-review.test.mjs lib/__tests__/steering-merge-policy.test.mjs lib/__tests__/handoff-custody.test.mjs adapters/openrig/__tests__/runtime-capabilities.test.mjs adapters/openrig/__tests__/mutation.test.mjs
```

New reporting checks run with:

```sh
pnpm exec vitest run adapters/openrig/__tests__/incident-evidence.test.mjs adapters/openrig/__tests__/incident-evidence-adversarial.test.mjs adapters/openrig/__tests__/incident-evidence-review.test.mjs
```

`recovery-rehearsal.test.mjs` exposed two genuine cross-capability defects on that baseline:
transfer invalidated active custody but still dispatched, and a crash before admission
allowed a retry to transfer ownership a second time. Its fixture exercises canonical native
custody, grants, source generation and recovery, using a cooperative memory source and
synthetic accepted phases solely for setup. It does not weaken the standard profile to
allow external effects. The recovery implementation owner receives these regression tests;
the reporting author does not change the audited recovery implementation. Those unchanged
regressions now pass after the #522 source-custody and atomic-continuation repairs; 41 focused
recovery checks pass. This establishes tested cooperative behavior, not a deployed recovery host.

This rehearsal work is self-review for modules previously authored by the same Codex
executor. It is not independent cognitive assurance, deployment evidence, proof of Dendro
oracle acceptance, or human security/acceptance approval. No live quota exhaustion,
credential access, installed profile modification, runtime dispatch or daemon fault
injection is part of these tests. Unsupported Pi observation remains unsupported; fixture
receipts do not attest a deployed reader.

An independent static advisory pass used actual `claude-haiku-5-5`, with tools and MCP
disabled ($0.00840649). It requested changes. Five concrete findings were reproduced as
RED tests before implementation: duplicate receipt counting, null reference crashes,
unsafe event identifiers, missing source size bounds, and success mislabelled as unavailable
failure evidence. All five now pass. Additional hardening bounds aggregate reads and claims,
normalizes output timestamps, and requires externally resolved acceptance observations.
Other findings depended on incorrect assumptions about existing validators or already-working
stage mapping; those validators check canonical seals, conflicting source event IDs, and
timestamps. No independent approval is inferred from fixing advisory findings.

The public read-only command is `agentflow-sdlc run incidents <run-id> --target <project> --json`. It reads the configured run source; it does not start or repair runs. Without a trusted evidence reader, proof remains unknown even when a source claim exists.
