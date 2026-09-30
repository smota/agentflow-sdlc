# Minimal optional Meshloop integration (#302)

This profile translates the public Meshloop CLI into AgentFlow's existing neutral
engineering receipt. AgentFlow owns operation authority and SDLC acceptance.
Meshloop owns its technical plan, worktrees, workers and technical acceptance.
There is no package dependency, private database reader or shared workflow engine.

## Qualified scope

On 2026-09-30, Meshloop source c2cc68c was built locally with
cargo build --locked -p meshloop-cli -p meshloop-adapters --bins.
The resulting meshloop 0.2.0 Windows debug binary had SHA-256
1bd4a4288b5d166c66df540fcd08743c69e65b50e0edcced205d7169d75e24fe.
The installed 0.1.0 binary was not upgraded or used as equivalent evidence.
No Meshloop source modifications were necessary.

A real CLI run in a disposable Git repository used a deterministic Node worker,
one concurrent worker, one attempt and a ten-second task deadline. The worker
changed result.txt in Meshloop's worktree. Technical acceptance was explicitly
recorded as codex-delegated-qualification, under the user's experiment delegation,
not as a human candidate review. AgentFlow did not automate that Meshloop gate.
After Meshloop resume completed its graph, the adapter verified the output commit,
branch, ancestry, permitted path and exact original bytes. The result had 18 bytes,
SHA-256 a0acbf3e3a628b004b3b2e4f7de57ec6b1c8074f9447a5481fe4122c783862a4.
The original checkout remained unchanged.

A separate Node process reconstructed the bound plan and observed the same pass
without dispatch. A separate slow-worker graph hit the one-second adapter deadline:
result unknown, then cancellation confirmed through Meshloop's public cancel CLI.
These are real process/Git/CLI boundary checks with controlled workers, not live
LLM capability, model quality or general platform qualification.

## Configuration and task preparation

Select delivery.engineeringProvider.id = meshloop-engineering-cli and
executionTarget = meshloop-cli. Set permissionBoundary = mutate-worktree.
The connection object requires explicit executable, binarySha256, configFile,
dbFile and worktreeBase paths. Use absolute paths for portable invocation behavior.
A changed executable digest fails preflight rather than silently requalifying it.
Model selection remains in the Meshloop config; requestedModel must be null.
Keep the configured database/worktree namespace stable across observation/cancel.

For source-backed engineering evidence, the existing
sourceEvidenceDisclosure = bounded-output-and-artifacts setting still requires
the project's explicit disclosure decision. This integration does not enable it.

Prepare the normal Meshloop nodes in a bounded JSON plan. Set graph_id using the
exported meshloopGraphId(identity, nodes, configSha256) helper from
lib/providers/meshloop-engineering.mjs, where identity is
{ version: 1, operationId, candidateDigest } and configSha256 hashes original
config bytes. This opaque ID binds the graph to the operation, candidate, nodes
and runtime configuration. Meshloop itself need not understand AgentFlow fields.

The admitted edit operation supplies arguments.requestPayload.planFile, explicit
operation.paths and arguments.expectedArtifacts. The initial supported output
profile is small regular-file additions/modifications with exact path allowlists.
Deletion, symlink outputs, arbitrary directory globs, and results larger than the
existing 32 KiB control budget are not supported. The adapter verifies committed
artifact bytes; it does not apply them to the caller's checkout.

Existing project setup, grants, frozen checks and operation admission remain
required. The adapter does not infer permission from a successful technical run.
Runtime worker permissions are cooperative and independently configured; output
scope checks are not an OS sandbox or a promise to contain hostile workers.

## Run, wait and reconcile

Use the existing governed run act operation. A graph awaiting Meshloop technical
acceptance returns blocked, never pass. Complete any required technical acceptance
through Meshloop's normal authorized interface, then use its normal resume.
This adapter never calls accept, resets a graph, or changes human gate policy.

For an already admitted operation, run the existing reconcile command with
--observe-provider in addition to --operation, the current --writer/--generation,
--execute and the normal target/run arguments. AgentFlow:

1. Resolves the operation from its acknowledged admission, checks current writer,
   candidate and disclosure policy.
2. Observes the bound existing graph without invoking run.
3. Verifies and persists a bounded result checkpoint when terminal success exists.
4. Uses the existing durable receipt resolver to reconcile the operation.

Existing result checkpoints are reused. Unknown/missing state never authorizes
redispatch. A normal first dispatch requires an explicit MissingGraph response;
transport or parsing failure cannot be interpreted as absence. All CLI calls are
bounded. Cancel is confirmed only by a matching session and cancelled response;
timeout alone does not prove worker termination.

Integrating the returned change into the delivery candidate and accepting the SDLC
phase remain separate existing policy-governed actions. A technical receipt is not
a merge, human approval or release.

## Validation and rollback

The meshloop-engineering suite covers registry routing, governed preflight,
read-only observation, durable receipt reconciliation, changed binary/plan/identity,
out-of-scope files, stale branch, ambiguous existence, and cancellation.
Existing Meshloop/provider suites retain parser, timeout, output-bound and byte
integrity regressions. Missing optional configuration preserves the direct path.

Run pnpm exec vitest run lib/**tests**/meshloop-engineering.test.mjs
lib/**tests**/meshloop-provider.test.mjs
lib/**tests**/engineering-neutral-conformance.test.mjs.
The tests use controlled envelopes and real Git; the pinned Windows CLI evidence
above is a separate qualification claim. Other binary/model/host combinations
need qualification before equivalent claims.

Rollback removes the optional engineeringProvider selection. Preserve existing
runs, database/worktrees and recorded evidence for explicit reconciliation.
No collector, installed skill, global installation or release is involved.
