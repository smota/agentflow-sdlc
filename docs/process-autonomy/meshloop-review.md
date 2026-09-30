# Meshloop interface review and optional provider adapter — S7

The adapter in `lib/providers/meshloop-provider.mjs` connects AgentFlow to Meshloop
through its public CLI. The implementation and qualification are separate: checkpoints
M1–M6 in the [execution plan](../maintainers/process-autonomy-execution-plan.md) remain
subject to live compatibility, recovery and cancellation evidence.

## Responsibilities

AgentFlow owns intent, delegation, workflow transitions and delivery acceptance.
Meshloop owns engineering execution and its technical graph. Neither product imports
the other's packages or reads the other's private database. An absent Meshloop provider
leaves direct AgentFlow execution available.

A successful technical receipt never grants SDLC acceptance. A running detached graph
is unfinished, and `AwaitingHumanAcceptance` describes Meshloop's wait state. AgentFlow
must evaluate its own run policy and delegated authority before integration or merge.

## Qualification checklist

Issue #296 requalifies the adapter after inspection of the #294 implementation found
negative envelopes accepted as success, incorrect artifact hashing, lost lifecycle
namespace and unbounded stream handling. Acceptance requires:

- Check JSON framing, `ok`, command and lifecycle state before producing receipts.
- Retrieve returned artifacts within the selected workspace, then compare original
  byte SHA-256 and declared byte length. Input content and foreign hashes alone are
  not verified output evidence.
- Preserve database, configuration and working-directory selection across execution,
  status and cancellation.
- Bound output while reading and settle timeouts without claiming an unobserved child
  or process tree has stopped.
- Bind advertised capabilities to qualified support. A version probe or mocked test
  does not qualify installed detached execution.

Commit inspection validates local commit metadata and its exported branch binding.
It is read-only: `integrated: false` means no checkout, import or merge occurred;
`artifactBytesVerified: false` means artifact integrity needs separate verification.
The retained `ingestWorktreeCommit` name is a legacy API name, not proof of integration.

## Live evidence still required

At the September 28 refresh, async `--detach` and `--session-id` behavior was present
in the inspected Meshloop working changes, but absent from its committed `efa4352`
revision. Those changes and the installed binary were not modified or qualified by
this review. Confirm the executable version and public command contract before a live
pilot; preserve technical receipts, cancellation observations and recovery evidence.

The adapter prohibits `--restart` and `--reset` as ordinary continuation because they
can erase execution history. Unsupported facets remain explicit until qualified.

## September 28, 2026 compatibility refresh (#302)

M1 inventory: Windows installed `meshloop.exe` from the user-local binary path reports
`meshloop 0.1.0` with SHA-256
`97781768f14e160481ef241d6a6d7daed3563f34b9ca2510c8380002f67dd573`.
Public `meshloop help` advertises `run --plan`, `resume --graph`, `status --graph`,
and `cancel`/`inspect` in its command list. It does not advertise the adapter's
`--detach` or `--session-id` options. The current binary is therefore **not
qualified** for detached lifecycle or integrated AgentFlow dispatch. Source/binary
equivalence has not been established in this refresh. The read-only source checkout
is at `efa4352a593eefdd2fdb7af9fb800d4e7abd6b65` with uncommitted CLI and engine
changes; its public argument parser includes `--detach` and `--session-id` in those
working changes. Those changes are not the installed binary. The earlier source and
fixture observations above retain their dated, narrower scope.

M2 neutral contract: the four version-1 engineering schemas and an example are in
[harness dispatch](harness-dispatch.md). The AgentFlow operation/candidate binding
and original-byte digest checks apply equally to direct, alternate and optional
Meshloop providers. A provider-specific envelope cannot substitute for these fields.

M3 ownership: AgentFlow #302 owns its dispatcher, translation and capability truth.
Meshloop public CLI envelope/version, digest naming, detached lifecycle behavior and
source/binary alignment require separately scoped Meshloop issues and owner approval.
No Meshloop source or private database was changed here.

M4-M6 qualification disposition:

| Surface                                                                                    | Current evidence                                                                                                 | Verdict                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AgentFlow direct and alternate fixture                                                     | Shared contract tests for negative status, bytes and identity                                                    | Contract-tested only; live model/effects unqualified                 |
| Meshloop standalone Windows fixture                                                        | September 25 public CLI fixture in this document, pinned binary hash above                                       | Standalone deterministic fixture qualified for that host/binary only |
| Meshloop optional integrated dispatch                                                      | Installed binary's public command options differ from adapter expectations; no governed operation/candidate echo | Unsupported                                                          |
| Detached execution, cancellation, timeout, crash, duplicate, fresh-instance reconciliation | No current live evidence for this binary and contract                                                            | Unsupported                                                          |
| Linux/macOS, Node 20/24, clean installation, model selection                               | No current live evidence                                                                                         | Unsupported                                                          |

The adapter continues to report `liveBinaryQualified:false`. Optional-provider
absence leaves the direct provider path available. A later M5/M6 claim needs an
actual terminal receipt and fault matrix pinned to source revision, binary hash,
host, candidate and operation, with no inferred human acceptance.
