# Neutral engineering boundary v1

`schemas/engineering-request.schema.json`, `engineering-capability.schema.json`,
`engineering-lifecycle.schema.json` and `engineering-result.schema.json` define the
version-1 process boundary. They are technical evidence; an engineering `pass` never
grants AgentFlow review, source or delivery acceptance.

The caller MUST bind a stable AgentFlow operation ID and exact candidate SHA-256 to
each governed request. The provider MUST return both in its terminal payload and
receipt metadata. The dispatcher rejects a mismatch and verifies each returned
artifact against SHA-256 of its original bytes. Text uses UTF-8 bytes; binary
artifacts use canonical base64. `recordDigest` is a structured-record digest and
MUST NOT be used for artifact integrity. Unknown, running, pending, empty,
negative and malformed output cannot become `pass`. Timeouts with uncertain
effects remain `unknown` and require reconciliation before retry.

Capability negotiation requires an available inspected target, an explicitly
qualified capability list and `full` intent support evidenced as `probed` or
`contract-tested`. Self-declared support does not
authorize a required capability. Requested model selection requires a qualified
model and an actual invocation binding, such as the Codex CLI `--model` argument.
When the provider cannot enforce a model, preflight fails. Permission and deadline
checks precede dispatch. The profile is optional.

Example neutral request:

```json
{
  "version": 1,
  "operationId": "run-42-edit-1",
  "candidateDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "executionTarget": "codex-cli",
  "requestedModel": null,
  "permissionBoundary": "mutate-worktree",
  "timeoutMs": 60000,
  "requiredCapabilities": ["file-edit"],
  "expectedArtifacts": ["lib/change.mjs"]
}
```

Example terminal result:

```json
{
  "version": 1,
  "provider": "codex-cli",
  "executionTarget": "codex-cli",
  "operationId": "run-42-edit-1",
  "candidateDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "status": "pass",
  "observedModel": null,
  "artifacts": [
    {
      "path": "lib/change.mjs",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "byteLength": 0
    }
  ]
}
```

Example capability inspection and nonterminal observation:

```json
{
  "version": 1,
  "provider": "codex-cli",
  "executionTarget": "codex-cli",
  "availability": "available",
  "qualifiedCapabilities": [],
  "qualifiedModels": [],
  "liveBinaryQualified": false,
  "binarySha256": null
}
```

```json
{
  "version": 1,
  "operationId": "run-42-edit-1",
  "status": "unknown",
  "observedAt": "2026-09-28T08:00:00.000Z",
  "providerOperationId": null,
  "reason": "timeout; termination unconfirmed"
}
```

The example illustrates the wire shape only. It is not a claimed execution receipt.

`createGovernedEngineeringAdapter` maps a journaled `edit` operation's ID and
candidate digest into this boundary. Its `dispatch` return is local technical
evidence. Its `reconcile` method requires a host-supplied resolver that independently
retrieves a durable provider receipt, terminal output and source revision. It then
rechecks identity and artifact bytes before reporting `confirmed` or `failed` to
the run service. Missing receipts, uncertain deadlines and unresolved terminations
stay unverified. `resolveConfiguredEngineeringProvider` in the provider registry
selects only an explicitly configured provider; absent configuration leaves the
direct flow unchanged.

For a durable source journal, `createSourceEngineeringReceiptResolver({store})`
reads the event chain anew. The host records exactly one `checkpoint` with payload
`{kind:"engineering-result",operationId,receipt,output}` for the admitted edit.
`output` is the dispatch result's `verifiedOutput` envelope, including stdout,
stderr and potentially inline artifact bytes, bounded to 32 KiB. This can publish
private workspace content to the configured GitHub coordination branch. Durable
engineering dispatch therefore fails closed unless the configured engineering
provider explicitly sets `sourceEvidenceDisclosure` to
`bounded-output-and-artifacts` for that source. Expected and returned artifact
paths must remain within the admitted operation paths. Known secrets, absolute
private paths and private artifact paths are rejected in raw strings and decoded
artifact bytes; this cooperative scan cannot prove that output is secret-free.
Inspect and narrow the configured scope before opting in. The resolver validates
the event and canonical provider receipt digests, output digest, identity and
bytes. A local dispatch result alone cannot make reconciliation `verified:true`.

## Optional Codex CLI engineering provider

Set `delivery.engineeringProvider` to the explicit ID `codex-engineering-cli`, target
`codex-cli`, and an explicit `requestedModel`. The host supplies the repository `cwd`.
The provider uses a native executable on Windows, probes the installed CLI's
version and required flags, and invokes `codex exec` with the configured model,
`--sandbox workspace-write` for edit or `read-only` for observation, `--ephemeral`,
`--ignore-user-config`, `--output-schema` and `--output-last-message`. It reads the
final structured file; it does not interpret JSONL progress as a terminal result.
The schema/result files live under ignored `.agent-runs/engineering` and are removed
after invocation. Returned artifact paths are contained within the selected
workspace and the adapter independently reads and hashes their bytes. The bounded
neutral result enters the same source checkpoint path. The model name in the receipt
is the invocation selection; server-observed model identity remains `null`.

On September 28, 2026, the installed Windows native Codex CLI reported version
`0.154.0`. In a disposable read-only Git directory, an explicit `gpt-5.6-luna`
structured-result probe returned a valid terminal `pass` with zero artifacts and
exit code 0. An explicit `gpt-6-luna` probe failed with the account's HTTP 400
unsupported-model response. This qualifies only CLI availability, selected-model
invocation and structured final output on that host. A later benign file-creation
probe with `gpt-5.6-luna` failed: although `--sandbox workspace-write` was passed,
the CLI reported effective `read-only` and rejected the write. Therefore
`file-edit` is absent from the provider's qualified capabilities by default.
Cancellation, continuation, other models and other hosts remain live-unqualified.
No source file was edited by these probes.

The edit adapter requires exact operation paths, compares bounded file-byte
snapshots before and after the subprocess, and checks that every actual changed
path matches both the admitted path set and the structured result. Out-of-scope,
deleted, renamed or omitted changes leave the operation `unknown` for source
reconciliation. The snapshot bound is enforced before dispatch. This is a
cooperative detection boundary, not an OS-level per-file sandbox. `.git` and
`.agent-runs` are included in the snapshot; only the exact temporary
schema/result directory created for this invocation is excluded. Linked
worktrees with a `.git` pointer file and workspace symlinks cannot qualify for
writes under this snapshot strategy. A host may enable `writeQualified` only
after separate live write qualification under its effective Codex sandbox policy.

Source publication of bounded engineering output and artifact bytes requires the
exact configured `sourceEvidenceDisclosure` value `bounded-output-and-artifacts`.
The governed adapter sets receipt disclosure to
`{authorized:true,scope:"configured-source:bounded-output-and-artifacts"}` before
planning and hashing the request. Without that opt-in, or with any other value,
the receipt declares `{authorized:false,scope:"local-only"}`. Caller-supplied
disclosure fields cannot override this configuration.
