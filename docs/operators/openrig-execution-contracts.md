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
