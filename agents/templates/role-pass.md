## Role Pass

**Issue:** #<number> — <title>
**Branch:** <branch>
**Phase:** <number>
**Role:** <product-manager | analyst | architect | implementation-planner | developer | tester | reviewer | technical-writer | pr-readiness>
**Status:** <pass | blocked | returned | skipped>
**Workflow profile:** <bounded | standard | high-assurance | exploratory>
**Action boundary:** <observe | propose | mutate-worktree | open-pr | external-action>
**Planned owner:** <registered platform slug from roleAlternationPlan; use "not-applicable:single-agent" only when Mode is single-agent and this pass will not feed a multi-agent role attribution matrix>
**Executed by:** <registered platform slug; see manifests/runtime-platforms.json>
**Launcher:** <registered platform slug; see manifests/runtime-platforms.json>
**Executor:** <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | grok-cli | xai-api | human>
**Transport:** <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
**Delegation boundary:** <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
**Context boundary:** <current-session | fresh-session | forked-context | local-cli-child-process | provider-api-call | human-handoff | worktree | intercom-session> <!-- derived from Transport + Delegation boundary; see lib/role-attribution.mjs#deriveContextBoundary -->
**Independence boundary:** <independent | self-review | not-applicable> <!-- only meaningful for the reviewer role: "independent" when the reviewer's roleIntelligence differs from the developer pass, "self-review" when it matches and is explicitly disclosed, otherwise "not-applicable" -->
**Reviewed authors:** <comma-separated registered platform slugs, or "not-applicable:single-agent"> <!-- actor identities that authored the reviewed subject; Independence boundary is derived from these against Executed by, never accepted as a bare claim — see lib/role-attribution.mjs#deriveIndependenceBoundary -->
**Model / runtime:** <freeform identifier or "not recorded">

### Inputs read

- <issue, spec, ADR, prior pass, diff, test output>

### Artifact references

```json
[]
```

Use portable `ArtifactRef` objects from `schemas/artifact-ref.schema.json`. A reference identifies
the authoritative source; it does not copy raw source content into workflow evidence.

### Verification observation

```json
{
  "candidateDigest": "<sha256 of the candidate under review in this phase>",
  "definitionDigest": "<sha256 of the check definition that produced the observation>",
  "observationRef": "<path or URI to where the sealed verification-observation record is durably stored>",
  "record": {}
}
```

Required for `developer` and `tester` roles; optional, but still validated when present, for every
other role. `record` MUST be a sealed `verification-observation` record that passes
`validateObservation` from `lib/core/verification-observation.mjs` — never hand-construct it. Build it
with the real collector helpers in `lib/core/` and `lib/verification/` (see
`lib/__tests__/verification-observation.test.mjs` for the pattern). For `developer`/`tester` roles,
`record.origin` must be one of the config's `deliveryPolicy.deterministicOrigins` and `record.outcome`
must be `pass`. In every case, `record.candidateDigest`/`record.definitionDigest` must match the
`candidateDigest`/`definitionDigest` declared above, or the observation is treated as belonging to a
stale candidate or a stale check definition.

### Decisions / findings

- <decision or finding>

### Capability evidence

```json
{
  "executionIntentsUsed": []
}
```

Record portable execution intents from `docs/capabilities.md` when a pass requests planning,
delegation, bounded loops, isolation, or structured results. Include implementation, fidelity,
evidence source, required/optional status, limits, and fallback.

### Collaboration evidence

```json
{
  "collaborationMode": "single-agent",
  "reason": "single-agent path was sufficient",
  "helpers": [],
  "synthesis": "not-applicable:single-agent"
}
```

Record intelligent collaboration evidence from `docs/intelligent-collaboration.md` whenever helpers, councils, bounded loops, spikes, or human-gated collaboration are used. Single-agent passes may record the compact default above.

### Open questions

- none

### Next-phase contract

- <what the next role must do>

### Transition envelope

```json
{
  "version": 1,
  "subject": "issue:<number>",
  "fromRole": "<canonical role slug>",
  "toRole": "<canonical role slug>",
  "decision": "pass",
  "nextContract": "<what the next role must do>",
  "timestamp": "YYYY-MM-DDTHH:MM:SSZ",
  "profile": "<bounded | standard | high-assurance | exploratory>",
  "actionBoundary": {
    "version": 1,
    "profile": "<bounded | standard | high-assurance | exploratory>",
    "requested": "<boundary>",
    "effective": "<boundary>",
    "parent": "<boundary or omit>",
    "enforcementRefs": []
  },
  "inputRefs": [],
  "outputRefs": [],
  "validationRefs": [],
  "openQuestions": [],
  "extensionPlays": [],
  "provenance": {
    "platform": "<platform>",
    "executor": "<execution target>",
    "transport": "<transport>",
    "delegationBoundary": "<boundary>"
  }
}
```

### Known limitations

`scripts/validate-sdlc-role-pass.mjs` proves internal consistency of a declared verification
observation against the real working tree; it does NOT prove (and never claims to prove) the
following. Do not read a passing gate as evidence against these:

- **Forgery.** `scripts/validate-sdlc-role-pass.mjs` resolves every observation through the same
  shared function `scripts/run-delivery.mjs` uses
  (`lib/verification/observation-resolver.mjs`): the definition must match a check the target's own
  `agent-workflow.config.json` configures, required assertions come from that configured check (never
  the record's own `assertions`), and the record must be found — matching byte-for-byte — in the
  collector's own storage (`.agent-runs/verification/<id>/observation.json`), independently of
  whatever `observationRef` the role pass declares. A record can no longer define its own proof:
  synthetic definitions, records absent from collector storage, and records that differ from their
  stored copy are all refused. What remains: `sealDeliveryRecord` is keyless — its `digest` is a
  checksum over the author's own payload, not a signature — and local `.agent-runs/verification/` is
  ordinary, author-writable worktree scratch. A forger with the same write access as the role pass's
  author can place a file directly at the path the resolver trusts, and nothing here distinguishes it
  from one the real collector produced. Closing this needs observations anchored in a durable store
  the author cannot write to directly — the append-only run store
  (`lib/sources/github-run-store.mjs` / `lib/sources/run-store.mjs`), not local
  `.agent-runs/verification/` scratch — a later workstream.
- **Replay across runs.** Nothing binds an observation to the issue, branch, or run it is presented
  against, so a genuine observation captured for one context can be resubmitted for another.
- **Honest role mislabeling.** Role is self-declared. A developer who declares `Role: reviewer` and
  performs developer work escapes the developer/tester observation requirement. Binding the declared
  role to VCS evidence is a later workstream.

---

<!-- <platform> = registered runtime platform actually executing THIS pass right now — never copied from a prior pass or template example. Register built-in or project-specific slugs through manifests/runtime-platforms.json and agent-workflow.config.json; see docs/runtime-platforms.md. Executor/Transport/Delegation boundary remain distinct and come from docs/execution-targets.md. Planned owner/Context boundary/Independence boundary are role-alternation concepts from docs/agent-workflow.md §4a and lib/role-attribution.mjs; they feed roleAttributionMatrix in workflow-status comment and PR manifest. Execution-intent evidence comes from docs/capabilities.md and can be checked with scripts/validate-execution-intent-evidence.mjs. -->

<!-- Signature uses same registered platform slug as Executed by. -->

Signed-off-by: `<platform>` (`<role>`)
Timestamp: `YYYY-MM-DDTHH:MM:SSZ`
