# OpenRig execution contracts

Preview the desired execution configuration before provisioning a team:

```sh
agentflow-sdlc adapters squads plan openrig --kind all --preset all-codex example /path/to/project --json
```

Planning reads project configuration and base specifications. It does not install bases, create
state bridges, read credentials, contact the daemon or start seats. The report names each seat's
runtime, execution target, provider route, model family, model, effort, profile and capability tier,
with field-level provenance. `effects: []` describes this read-only operation.

The report describes desired configuration. `support: unknown` means no matching inventory evidence
was supplied. A supported model is not proof of authentication, quota, live readiness or current
occupant identity. Those observations require operational preflight.

## Configuration precedence

The resolver uses explicit invocation fields, project seat policy, the selected preset, compatible
existing rig pins, and the selected route's capability-tier defaults. A more specific explicit field
overrides a less specific field, but the complete resulting tuple must be compatible. Changing runtime
also selects that runtime's registered seat profile. An incompatible old model is replaced through
resolution rather than copied to the new runtime. Existing compatible pins and loop effort remain
unless explicit policy changes them. Recommended model metadata never changes execution by itself.

The existing canonical configuration authority applies. A project can specify:

```json
{
  "adapters": {
    "openrig": {
      "executionPolicy": {
        "seats": {
          "dev.build": {
            "runtime": "pi",
            "providerRoute": "munito",
            "model": "qwen/qwen3.8-27b",
            "profile": "builder-pi",
            "effort": "medium"
          }
        }
      }
    }
  }
}
```

The gateway route is `munito`; the model family in this example is Qwen. They are separate facts.
The generated Pi runner locator is `munito/qwen/qwen3.8-27b`, preserving the model's own namespace.
Use an available model and supported effort from the installation's inventory; this example grants
no account access and does not verify availability.

Built-in route/tier defaults live in `lib/config/execution-defaults.mjs`. Optional bundle
`capability_tiers` and `fallback_chains`, and project `models.tiers.<tier>.models`, are deliberate
overrides. Configuration projection and runtime loading share their default definitions; a stale
generated intelligence file cannot override unified canonical configuration.

An OpenRig adapter object containing `executionPolicy` is a policy wrapper. If it also contains
`rig`, only that `rig` is projected to rig YAML. Legacy raw rig objects remain supported. Never
serialize an execution-policy object as an OpenRig rig.

## Provisioning and compatibility

Delivery, product and steering use the same resolver and materializer. A multi-squad provision
validates every desired rig before any installation or squad write. An invalid third squad therefore
prevents writes to the first two. Each project squad receives `execution-contracts.json` recording
the resolved canonical model, runner locator and provenance alongside its generated rig.

Duplicate YAML keys and alias expansion are refused. Unknown runtime/profile combinations and
contradictory explicit tuples are errors. Preset entries for seats absent from a particular rig are
reported; they do not silently create seats. Existing seats without a preset entry remain present.
An explicit project seat absent from the complete planned topology is an error.

Pi state bridges follow actual materialized Pi seats, rather than an obsolete fixed roster. Installing
or updating template source is distinct from updating a project copy, and neither proves that a live
seat has adopted the configuration. Preserve current sessions and inspect the consumer's actual effect
before reporting runtime recovery.

## Operational admission

```sh
agentflow-sdlc adapters squads preflight openrig --kind all example /path/to/project --json
```

Preflight compares desired contracts with the actual installed rig fields. It reads bounded compact
OpenRig inventory with `ps --nodes --no-cleanup`, a ten-second timeout and a one-MiB output limit.
A staging `--home` never contacts the live harness. It never starts a daemon, cleans stale state,
reads sign-in material, probes a provider or changes a seat. Exit code `3` means admission is held;
exit code `0` requires verified admission. Invalid configuration remains an error.

Configured, observed, usable and authorized are separate fields. A pinned model is configuration;
READY is process evidence. Verified admission also requires current source-authenticated execution,
matching session/generation and task bindings, fresh event evidence, successful history catch-up,
a running daemon and task-specific role authority. Collection time cannot refresh an old event.
Missing task scope, duplicated identities, incomplete inventory and unknown evidence never admit work.
Reports expose fixed reason codes and a named next owner/check interval, excluding raw runtime output.

OpenRig 0.6.10's supported compact inventory cannot supply all those attestations. The bundled
collector therefore reports inventory only and preserves unknown actual model, effort, restore,
occupant and authorization evidence. It does not infer daemon health from inventory or READY.
A stopped or unavailable daemon leaves admission held without a service start. Positive evaluator
fixtures specify a trusted host reader contract; they do not claim that such a reader is deployed.
The upstream Pi reader/catch-up integration remains tracked in #524.

## Oracle writer admission

Protected-oracle work requires a source-authorized independent test engineer. The delivery bundle registers optional `test-eng`, `test-eng-pi` and `test-eng-claude` profiles; registration does not create a member, provision a runtime, or grant permissions.

The standalone product handoff bridge resolves task scope through the trusted host callback `resolveOracleTask`. Its result must contain the current `task`, `sourceRef`, `sourceRevision` and `verified: true`. Missing or unreadable task scope holds delivery. A request's task file is a declaration to compare against that source, never its own authorization.

For protected targets, `resolveOracleAuthority` must resolve the exact assignment and task from current source authority and supply the canonical ownership manifest. It must verify issuer authority and current assignment; implementing this callback as a pass-through of caller records is unsafe. No production authority callback is provisioned automatically. Until a host supplies it, protected work remains held; positive tests use explicit fixture adapters, not live authorization.

Assignments record `id`, `mode` (`temporary` or `persistent`), `identity`, role `test-engineer`, policy seat `dev.test-eng`, target session, bounded `allowedPaths`, isolated `worktree`, `authorityRef`, expiry, and `scope` binding goal/run/epoch/fence/touch surface. Custody records the current oracle digest and writer identity, or an explicitly source-authorized uninitialized state. The source task identifies separate feature-builder and reviewer identities. Source ownership rules restrict all grants; caller booleans, names and profiles cannot substitute for source resolution.

`handoff deliver` accepts optional `--task-file` and `--oracle-assignment-file` JSON declarations. Initial delivery, held flush and person release recheck current task/assignment authority. A person release cannot bypass oracle permissions. Phase-step hosts must enforce the same oracle admission in their source-authorized append/dispatch boundary; task custody alone does not grant oracle write authority.

Two or more failed repair rounds require a revised bounded `repairScope` containing distinct `previousRevision` and `revision`, reason and accountable task owner. Existing oracle digests, workflow identity, fencing and publication holds remain intact.

## Authenticated steering

A named owner, a heartbeat and an authenticated endpoint are different evidence. A fresh heartbeat
without a trusted host verifier returns `SUPERVISOR_UNVERIFIED`; every unverified or unreachable
result holds new slice admission. Verified liveness requires the `observe` power, not a reusable
approval for another action. External authorities work without a local steering seat.

The host endpoint verifier binds authority, reply route, goal, task, challenge and deadline. Its
receipt must be fresh and expire within the issued binding. Decision powers additionally require
an explicit approved decision, a consumed nonce, source subject identity and exact subject/action
digests. The host owns authentication and nonce consumption. Callable test fixtures demonstrate
this boundary; arbitrary JSON, command flags and heartbeat files cannot provide it.

Applying a legacy ledger unfreeze requires an explicit actor and a trusted source resolver identifying
the actual ledger's goal/task/subject. The approved action binds resolution, rationale, human approval
reference, subject identity/digest and next token. Reusing approval for another decision or an identical
ledger belonging to another task is rejected. Missing provenance keeps the hold. Tokens must be safe
nonnegative integers and increase without overflow.

The standalone CLI currently has no authenticated host adapter: use `steer unfreeze --actor <identity>
--dry-run` for an explicitly unauthorized preview. A real application must supply trusted endpoint and
source adapters; identity flags cannot satisfy them. A human-approval reference is part of the decision,
not independent proof that a person approved a PR.

Legacy file application uses a cooperative lock, rechecks the digest and atomically renames the updated
file. Other writers must honor that lock. This is not source-store CAS or run-service fencing; native
run recovery continues through the existing source-backed service. A stale lock requires ownership
reconciliation and is never removed automatically.

## Native oracle assignment identity

Oracle writer assignments distinguish tagged `protocol: run-v1` source identity from legacy
positive epoch/fence bindings. Native assignments preserve the exact existing `runId`,
`runRevision`, `sourceRevision`, `owner`, `generation` and `revocationEpoch`; generation and
revocation epoch may legitimately be zero. The trusted authority resolver must return the
same source revision and exact task/assignment. No epoch or fence is derived from those native
counters. Mixed protocols and unknown protocol tags are held. Untagged legacy assignments
retain their positive epoch/fence contract for compatibility.

The native source fixture uses the actual run service and its existing source snapshot. It
proves identity compatibility, not a deployed authority resolver or permission to initialize
missing historical state. A missing source revision remains a source gap.

## Oracle admission at the phase handoff boundary

The synchronous `handoff step` host boundary resolves its source task and required oracle-writer
capability before any phase append. A valid workflow binding alone cannot bypass task admission.
It records the exact source task identity and assignment digest in the existing handoff outbox,
then re-resolves both after phase append and before queue dispatch. Revocation, missing writer,
unknown scope or changed task surface holds dispatch. A phase already appended remains preserved
for reconciliation rather than being rolled back or appended twice.

Known nonprotected tasks still require a source-resolved bounded surface; they do not acquire
protected oracle capability through a generic success boolean. Legacy outbox entries lacking
source task admission require explicit reconciliation. Installed bundles need normal deployment
before this source change affects their behavior; no standalone caller flag supplies the trusted
resolver or grants authority.

This synchronous compatibility path retains its explicit legacy epoch/fence protocol. Native
`run-v1` oracle assignment support does not translate native zero-valued generation/revocation
counters into legacy epochs. A future native handoff host must use the existing run service's
`advance` and operation journal with trusted source custody and typed grants, rather than adding
a parallel phase medium. Until that adapter is supported, missing native source history remains
an honest recovery hold.
