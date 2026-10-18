# Steering merge authority

`lib/core/steering-merge-policy.mjs` evaluates readiness from an authoritative current pull
request snapshot. It never executes publication or treats authored PR text as authority.

The default policy requires an open, explicitly nondraft PR, known current head SHA, known
mergeability, nonempty CI with only successful completed check runs or successful status
contexts, independent current-head review, and independent current-head human approval.
Unknown identity, missing checks, unknown conclusions, stale reviews, dismissed approvals,
or current changes requested keep readiness held. Review selection uses the latest decisive review timestamp
per reviewer, regardless of array ordering. Ambiguous or malformed review history remains
unverified. A human requires an explicit source identity (`is_bot: false` or GraphQL
`__typename: User`), never the absence of a bot flag.

PR body text, labels, comments, arbitrary approval references, and auto-merge flags cannot
satisfy these gates. Explicit standard self-review remains possible only through a trusted
source resolver and a policy that selects `allowSelfReview: true` and
`requireHumanApproval: false`. The default human requirement is not weakened. No CLI text
option should turn a caller declaration into a verified source receipt.

The optional synchronous `resolveReviewEvidence({pr, headOid, repository, prNumber, baseRefName})` host port returns a source
receipt with `verified`, `repository`, `prNumber`, `baseRefName`, `headOid`, `decision: approved`,
`reviewerId`, `reviewerPermission`, `independent`, `human`, and `sourceRef`. Repository, PR, base and
head must all match; a shared head digest alone does not identify an approval subject. Reviewer
identity comparisons ignore case. Comment-only and pending reviews cannot dismiss a change request. It must resolve existing authoritative evidence; it is not an authentication
mechanism for arbitrary JSON. Exceptions, promises, stale heads and malformed receipts hold.

Actual publication requires a separate authenticated decision. The host should bind a
steering request to the exact repository, PR number, current head SHA, merge strategy and
deletion policy. A suitable subject is `recordDigest({repository, prNumber, headOid})`; a
suitable action is `recordDigest({action: 'merge', repository, prNumber, headOid,
strategy: 'squash', deleteBranch: true})`. The endpoint verifier must authenticate the authority,
reply route, goal/task, challenge, power, both digests and expiry. The host must consume its
approved decision through existing operation admission/reconciliation so replay cannot
publish twice. Readiness alone supplies no merge grant.

Readiness checks should remain the default CLI behavior. Explicit execution must still use
trusted host authority and current evidence. Pass the exact inspected head to GitHub's
`gh pr merge --match-head-commit <headOid>` guard. A head change must require new readiness
and authorization; do not silently refresh the SHA and reuse the old decision.

Source inspection must obtain author identity and review commit metadata explicitly. If a
CLI projection omits them, report unknown or use supported source enrichment. Tests with
trusted fixture callbacks establish policy behavior, not deployed human authentication or
permission to merge the implementation PR. High-assurance human security and acceptance
review remains required before that merge.

The executable now defaults to check-only. Native approval facts require current repository
`write`, `maintain` or `admin` permission, observed through GitHub's collaborator-permission
endpoint when `--repo` is supplied. A host review receipt likewise carries `reviewerPermission`.
Missing permission stays unknown. An unresolved latest change request continues to hold across
head changes; a server `REVIEW_REQUIRED` decision cannot pass because one reviewer approved.

Publication additionally requires an explicit human decision (`human` and `approverId`) from the
trusted endpoint, bound to the consumed approval nonce and exact action. User GO for coding is
not that approval. The executable rechecks readiness and permissions after authentication, pins
the head in the merge command, and verifies the exact head's merged state and merge commit from
source afterward. A command acknowledgement with missing readback remains `MERGE_SUBMITTED`,
with `merged: false`, `publicationVerified: false` and a reconciliation obligation. Unknown command
outcomes are never replayed blindly. No host endpoint is installed by these source changes.

The bounded CLI projection holds at 100 review or check entries rather than assuming that a
full projection proves complete history. Larger histories need an authoritative paginated reader.
A GitHub User account is account-type evidence; it does not prove a physical person's presence.
Actual publication still requires the authenticated human decision from the trusted host endpoint.

## Guided steering setup and enforcement limits (`steer setup`)

`lib/config/steering-agreement.mjs` and `agentflow-sdlc steer setup` resolve existing steering
settings from `agent-workflow.config.json` (or unified `agentflow.config.json`), `sdlc.config.json`,
and the pinned `executionDistribution` profile (`steer.lead` default and fallback routes).

When valid parameters were already confirmed and match the current `confirmedDigest`, `steer setup`
reuses them without re-prompting (`reusedConfirmedAgreement: true`). When `executionDistribution` or
`goalScope` is missing, `steer setup` returns bounded questions for the missing fields; for
`steeringOwner`, `returnRoute`, `reviewAndPublicationAuthority`, `quotaPolicy`, and
`checkpointsAndStopConditions`, it presents the resolved defaults and requires an explicit
digest-confirmed plan/apply step (`steer setup --plan` followed by
`steer setup --apply --plan-file <file> --confirm <digest>`) before updating the project
configuration.

`steer-guard` blocks direct file edits and git mutations, not `agentflow-sdlc steer setup --apply`.
Conversational parameter confirmation and `steer setup --apply` record operating preferences only.
They never fabricate host authentication, never bypass `evaluateSteeringBinding` or
`evaluateMergeReadiness`, and never grant merge, unfreeze, or publication authority. Prose guidance
in skills and culture files is advisory; native runtime gates enforce authority independently.
