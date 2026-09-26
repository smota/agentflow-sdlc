# GitHub merge adapter — S3 qualification checkpoint

`createGitHubMergeAdapter({ client })` separates sending an admitted merge from
observing its outcome. It accepts an exact repository/base, PR number, head SHA
and merge method through the operation envelope. The service remains responsible
for granting authority, validating current checks/review and persisting admission
and intent before calling the adapter.

The adapter reads the PR and verifies repository, base and head. Its merge request
includes the head `sha` condition supported by [GitHub's merge endpoint](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request).
It does not retry a failed request or request branch deletion. A successful request
still requires a fresh provider observation before the run records confirmation.
Reconciliation binds the observed merged PR, head, merge commit and timestamp to
the exact operation and candidate. Incomplete or mismatched observations remain
unknown; they cannot advance delivery acceptance.

The head condition is enforced by GitHub. The base check is a preflight observation:
the endpoint has no equivalent expected-base parameter. Concurrent PR retargeting
must be excluded by the cooperative operating policy, or this adapter cannot claim
strict target-branch enforcement. It is not a trusted-host or hostile-concurrency
guarantee. The runtime must disclose this capability limit before delegation.

Five fixture tests cover exact-head submission, changed head/base refusal,
authoritative merged observation and lost-response behavior. No real merge was
performed for qualification, and CLI routing/live end-to-end acceptance remains
part of S3/S9. This checkpoint does not certify through-merge autonomy.
