# Packaged adoption qualification (#304)

This bounded qualification follows the maintainer's minimal scope amendment in
[#304](https://github.com/smota/agentflow-sdlc/issues/304), starting from development
`ba65ad00066f98ef666a81ffa427b3e915443fee` on 2026-09-30. It qualifies named entrypoints
and environments, not all agent runtimes or an autonomous coding model. No Meshloop
source, installed skill links, global installation, release or authority policy changed.

## Candidate and evidence levels

Initial locally packed version 1.2.0 had SHA-256
`50524d7e92ec851d06610a7f86ba4eccafcffe3afdd96a8a83e7ef4a5e899539`.
The documentation retry package had SHA-256
`95ff0065fce7e256e3ccbb6c846a3e2e850fb59b305ef9cd615110364784ceab`.
These are development tarballs, not published releases. The executable behavior was
unchanged between them; documentation changes are not silently treated as already
qualified by the first run. Final package parity and exact-candidate CI are separate
from the live experiments below.

Host: Windows x64, Node 26.10.0, Git and authenticated GitHub CLI. Runtime-owned
bootstrap installed the tarball into disposable local tool directories with lifecycle
scripts disabled. This isolates adoption from existing global installations; it is
not a fresh OS installation. Existing Node 20/24 cross-platform CI remains a separate
portability check.

## Five journeys and dispositions

| Journey               | Action and observed result                                                                                                                                                                                                                                                                                 | Recovery and next step                                                                                  | Evidence boundary                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh adoption        | Public `onboarding plan/apply/verify` on an empty target reports project ready; a repeat plan has no create/update/seed actions. Separately, a clean-context reader followed `init`, `sdlc validate`, `run start/freeze/verify` against a meaningful Node test and obtained a passing starter observation. | Preserve returned transaction receipt; configure a real goal/source before claiming durable delivery.   | Real package/process/filesystem. Project-only onboarding does not assert runtime or governed-change readiness. Starter observation is not phase acceptance. |
| Existing/partial      | Existing custom configuration and an authored sentinel survived. A real directory junction to a runtime-owned skill remained at the same target with identical skill bytes; only missing project assets were supplied. Repeated preview requested no managed mutation.                                     | Shared links remain runtime-owned; resolve conflicts explicitly.                                        | Real Windows filesystem/junction, synthetic shared library in sandbox; not a Skills Manager deployment claim.                                               |
| Old/unknown           | Recognized v1 lock required `migrateLegacy`; unknown v999 lock required `recoverUnknown` plus selective preserve. Public apply preserved authored guidance; public receipt-backed rollback restored original lock and authored bytes.                                                                      | Use the returned receipt path/token; never delete an unknown installation to reset it.                  | Synthetic legacy/unknown state exercised through real public CLI. An initially malformed legacy fixture was corrected before the recorded pass.             |
| Governed continuation | See the continuation result below.                                                                                                                                                                                                                                                                         | Preserve candidate branch, packet and writer evidence; unknown liveness or mismatched bytes must block. | Same-host fresh-process/root qualification, not universal cross-host takeover.                                                                              |
| Optional integration  | See the public optional result below. Direct starter execution used no Meshloop.                                                                                                                                                                                                                           | Reconcile admitted operations before removing optional configuration.                                   | Pinned deterministic worker; no LLM capability claim. Prior lifecycle and telemetry evidence reused only as specified below.                                |

The parent performed 20 public CLI invocations across fresh/partial/migration/rollback
and update scenarios in 3,522 ms, excluding package installation. This is a local
observation, not a performance target. Package/source checks require all catalogued
skills instead of silently skipping the obsolete coordinator filename.

Runtime update tests explicitly used synthetic component/release observations. Declared
but unverified available-version evidence produced no update proposal. An explicitly
observed synthetic update produced two separate update proposals; compatible deferral
produced deferred-update proposals and did not block project apply. No actual newer
published release or host discovery is inferred from that fixture.

## Documentation findings and interventions

The clean-context reader initially completed local adoption but could not derive a
GitHub acceptance revision from CLI/schema-only instructions. Run operations now gives
a standalone canonical-JSON recipe and distinguishes source-plan `result.digest` from
other plan envelopes. Public JSON input files must be inside the target; the guide now
states this explicitly. Candidate and coordination branches are distinct.

Fresh-root instructions now require a consistent checkout-filter/line-ending policy
before creating the original candidate. This avoids relying on the earlier experiment's
manual per-file LF/CRLF materialization. A clean Git tree is not proof of equal bytes.
Receipt rollback and interrupted-apply recovery use distinct tokens, now named directly
in assisted onboarding. Meshloop guidance includes explicit optional configuration and
the wire graph-ID recipe without requiring an internal module import.

The first package attempts are diagnostic runs, not zero-intervention adoption passes.
The clean-context reviewer also accidentally invoked npm init in the parent directory;
the parent verified and restored only that tool-generated manifest diff. No candidate
implementation change resulted. This operational intervention remains disclosed.

## Reused fault evidence

- [Public delivery qualification](live-delivery-qualification.md): actual GitHub actions,
  replay, revocation, source ACK/response interruption, contention and isolated ENOSPC.
  Those exact boundaries remain in force; no new full fault campaign is claimed.
- [Minimal Meshloop integration](meshloop-minimal-integration.md): pinned binary/Git byte
  verification, technical-acceptance wait, cancellation, timeout and fresh-process observation.
- [Process observability](observability.md): disabled/offline/export-failure decision parity,
  privacy and bounded-loss tests. Telemetry remains advisory and no efficiency threshold is
  reintroduced. Actual collection on this adoption is reported separately from those tests.
- Existing onboarding migration/drift tests and package rollback smoke retain negative
  ownership and transaction coverage. No broad OS/model cross-product is required here.

The supported outcome is adoption plus verified evidence and recoverable process state.
Technical receipts do not apply commits or satisfy human/security/release acceptance.
Proposed ADR statuses and high-assurance gates are unchanged.

## Public optional result

The public AgentFlow run `optional304-1790792362981` used the dedicated GitHub
coordination branch `qualification304-optional-1790792362981`. Its candidate commit
was `2da2ff556417f3e3b4dacd4019164b173480db27`, with candidate digest
`85991a4dd3a5c595b1ea55cd22690a5cf6efdd3bd57241f7886ec66a0fc3de45`.

Public start/freeze/verify established two exact-candidate deterministic checks.
A cooperative one-attempt edit grant admitted operation `optional304-edit` through
`run act`. The initial result was unknown while Meshloop awaited technical acceptance.
The parent inspected the single-file diff and explicitly accepted the technical task
as `codex-delegated-qualification`, under the maintainer's experiment authorization,
then used Meshloop resume. This was not automated by AgentFlow or labeled human review.

A separate AgentFlow process ran `run reconcile --observe-provider` for that same
operation. It confirmed the result at source event
`0840474c73480b173d4399c857eeb2d637657d61f9c3d316ee265423a7e6896b`;
the reconciliation bound payload digest
`9cbdf6a561da7f7c76191a8fa55ea96b1f4d367d89e5d202208341747b286ab8`.
No second dispatch occurred. Meshloop graph
`af-12964cc2527036b104bb705f6f93e8fcf037d7b6` produced the 18-byte
`integrated result` file plus newline in its own worktree. The caller kept `seed`
plus newline. Grant revocation completed before disconnecting the optional provider.

This is the public configured admission/receipt path with actual GitHub and Meshloop
processes, not the earlier adapter-only fixture. Wrong-binary-digest refusal remains
covered by the rerun Meshloop regression suite; timeout/cancel uses the pinned #302
live evidence. The same Meshloop 0.2.0 source/binary from that record was used unchanged.

A setup harness initially selected the wrong source-plan field and retained a pending
local start journal; no remote source ref or business effect was created for that
failed setup. A new isolated qualification namespace was used for the corrected pilot;
the old journal was retained and is not claimed reconciled. An initial request file
outside the target was rejected before grant issuance. Both setup interventions are
excluded from clean-reader success claims and drove explicit documentation corrections.

## Public continuation repair

The clean-context reader exposed a real defect in the top-level `handoff`/`resume`
aliases: they returned an asynchronous call to an undefined function into a synchronous
exit-code path. Node rejected the Promise before any continuation packet was emitted.
Public run status after failure confirmed the run remained paused with no pending
operations. The correction routes both aliases through the same existing subprocess
transport as `run`; it changes neither continuation state nor acceptance policy.
Subprocess regressions compare alias and direct-run error envelopes and missing-ID
handling. The repaired development tarball has SHA-256
`3b7c18d0ff708f9e47d7519d5012c95c01236d88eea27fe916d26f11f01c0099`.
The reader retried continuation from the preserved candidate without modifying packet
bytes or erasing the prior failure.

After confirmed reconciliation and grant revocation, removing the engineering provider
left the direct `starter` check passing for the same candidate. An offline telemetry
configuration also preserved the passing outcome (observation
`6913c4a917eb5e89a32dad371a6f59c2e0d5b01a389d519d81bb21b60b6490cb`).
The packaged analyzer accepted 128 spool records, rejected none, and reported one
observed run/session/attempt. The process report exposed 16 dropped spans; no zero-loss
claim is made. Missing delivery/checkpoint denominators remained null. This is an
observability/decision-boundary check, not a cost benchmark.

The first continuation repair retry correctly rejected an omitted writer identity with
`Obsolete writer identity or generation`. The help and examples now require the current
owner/generation for handoff and explicit replacement identity/PID for resume. This was
a documentation defect; the authority guard was preserved. The separate read-only
review also corrected the digest example to omit undefined object fields exactly as
its documented contract requires.

## Verified fresh-root continuation result

The corrected package SHA-256 was
`114d0686507dbaf934877711f45a821268d5e657393b16731bec638d431a69b3`.
Public handoff emitted packet digest
`4b616ad766387deecb7174c8a7388bc531621ef3d5285e236370f6ab5c756f8a`
for run `cold304` and candidate branch `qualification304-candidate-20260930-202014`.
The fresh clone preserved commit `7d05e36764bb47e7ff8ab372c0c064685ddb53aa` and
candidate digest `a5a1df59f0e5184dd1a6b70afbd1552db9c07a8e2b75450e9287bc0276ececeb`.
No candidate blob was manually rewritten. The prior writer was observed stopped.

Public resume preview returned `blocked: false`, `candidateChanged: false` and no
pending operations. Applying its exact digest returned durable `active` state,
owner `cold-adopter-rev4`, generation 1, the same candidate, and revision
`9e55635c87a9c3b3bd3d30b1b56fecaff57ab821cd21a2479450a9f296b913d2`.
The coordination source is `qualification304-cold-20260930-202014` in this repository.

This completes the supported adoption -> observed check -> pause/handoff -> fresh-root
resume chain through packaged public entrypoints. It does not certify later phase
acceptance, a merge or a general autonomous engineering model. Initial failed attempts
and documentation hints remain recorded above; the successful repair retry is not
retrospectively described as a zero-intervention first attempt.

## Review and checks

Codex retained formal role ownership and performed evidence-backed self-review.
Two fresh-context `gpt-6-luna` desktop child helpers performed the adoption trial and
read-only evidence review. No distinct-platform intelligence, native model CLI or human
candidate approval is claimed. The evidence review's digest example finding was fixed
and rechecked; continuation was verified by the separate adoption helper.

Local `pnpm validate:release` passed 1,201 tests across 138 files after the alias fix,
including package parity and release validators. Subsequent evidence-only documentation
is checked with formatting, docs validation and final exact-head CI. CI and live-process
qualification remain distinct: the live host was Windows/Node 26.10.0; CI targets
Node 20/24 on Windows/Linux/macOS. No new out-of-scope defect was identified.
