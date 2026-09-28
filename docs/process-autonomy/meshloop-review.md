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
