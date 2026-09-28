# Public delivery qualification

This record covers issue #301 on 2026-09-28, using implementation `182e1c2`
on Windows x64 / Node 26.10.0, GitHub, and the public Node CLI. It supplements
the [previous completion evidence](../maintainers/process-autonomy-completion.md).
Qualification is layered: actual filesystem pressure, actual source contention,
and public CLI/provider interruption are separate experiments.

## Scope and evidence

The public run is `qualification301-public-1790607481439`, stored using
`segmented-v2` on the `agentflow-301-qualification` coordination branch of
`smota/agentflow-sdlc`. Its candidate is the single `candidate.txt` change at
`3b00bc505c0aa20fd66e015f4ada8dc80015b23d`. Its only delivery destination is
`qualification/301-base-1790607481439`; the base initially pointed to
`d8cc157dea9563c16569274d494debe00b894f81`.

The fixture's two deterministic checks both inspect that file. They qualify
transport, authority and phase mechanics, not independent engineering review
or the whole product. The product regression suite separately passed 1,177 tests
across 135 files; final validation including the adjacent desktop-provenance fix
passed 1,183 tests across 136 files. Standard/autonomous fixture policy explicitly permits
external actions and named merge. Default open-PR and high-assurance policies
do not inherit this authority.

| Requirement            | Observed result                                                                                                                                   | Boundary                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Typed intent           | Phase zero stored a sealed request and host-observed consent before advancing                                                                     | Actual user messages observed in the Codex session; opaque digests only in source; not authenticated human identity |
| Ready PR               | An admitted one-effect operation created [PR #307](https://github.com/smota/agentflow-sdlc/pull/307) with `draft: false`                          | Disposable head/base; no integration or release branch                                                              |
| Lost provider response | Process exited 72 after the real PR POST returned; a fresh CLI reconciled the exact existing PR                                                   | Instrumented public run subprocess; local process-loss injection, not a GitHub outage                               |
| Replay                 | Repeating the operation returned exit 6 without redispatch                                                                                        | Existing effect reconciled; no second PR                                                                            |
| Source unavailable     | Injected source-read failure denied admission, forwarded no business write and retained identical audit bytes                                     | Local transport fault; no claim of a real GitHub service outage                                                     |
| Exhaustion             | A distinct operation after the one-effect grant was consumed was denied with `BUDGET`                                                             | Zero forwarded writes and unchanged local audit                                                                     |
| Revocation             | A distinct operation after acknowledged revocation was denied with `REVOKED`                                                                      | Zero forwarded writes and unchanged local audit                                                                     |
| Lost source ACK        | Public checkpoint process exited 71 after real source-ref update; fresh `journal-reconcile` acknowledged the exact event                          | Source commit was already durable; no duplicate event                                                               |
| Source CAS contention  | Two writes from the same real source parent produced one winner; loser was proven not committed and retired                                       | Adapter-level generation contention; does not certify public liveness/packet takeover                               |
| Full filesystem        | Linux private tmpfs returned actual `ENOSPC`; prior evidence survived, no abandoned lock remained, safety write succeeded after space restoration | No promise that physically full storage can persist a new record                                                    |
| Fresh root/process     | Prior PR #306 journey resumed the packet through the packed CLI in another Git root and process                                                   | See prior completion evidence for line-ending intervention and exact versions                                       |

The contention run `qualification301-contention-1790607149383` is pinned at
source commit `02d7411e30b1416e850cae1420f552810db36cae`: exactly three chained
events, one generation transfer, final paused state, no business dispatch.
Reproduce the filesystem experiment with
`node scripts/qualification/journal-enospc.mjs` in its documented isolated Linux
environment; it does not fill the workstation filesystem.

Initial PR CI exposed a Windows/Node 20 fixture defect: unlinking the still-open
lock left its name delete-pending, so recreation failed before a replacement
existed. The corrected test renames the held file before creating a replacement,
including a zero-byte case. Cleanup additionally compares the original identity,
fresh open-handle identity and current path. All 26 journal tests passed on an
isolated official Node 20.20.2 runtime, and the real tmpfs ENOSPC probe passed again.
This does not establish an atomic unlink-if-same operation; cooperative filesystem
access remains the boundary. The original CI failure is not evidence that a
successfully created replacement was deleted by the product.

## Completed phase and merge qualification

A fresh source read verified completion at coordination commit
[`f3cd530ee7cb46dfff1ea904c6df7b6da44b761b`](https://github.com/smota/agentflow-sdlc/commit/f3cd530ee7cb46dfff1ea904c6df7b6da44b761b).
The digest-checked chain contains 52 unique events: nine frozen role contracts,
18 actual check observations, eight phase advances and one terminal completion.
There are two admitted business operations, both confirmed, and two grants, both
revoked with one attempt/effect consumed each. The local journal has zero pending
entries. The source issue revision remained unchanged throughout the phase run.

The second grant allowed only merge into the named disposable base. PR #307 merged
at `2026-09-28T15:44:50Z`, with merge commit
[`b5203c4fcf8e649a7d319a3f50bf8edc2cceaa81`](https://github.com/smota/agentflow-sdlc/commit/b5203c4fcf8e649a7d319a3f50bf8edc2cceaa81).
A separate CLI invocation reconciled the operation; repeating `act` returned
exit 6 without redispatch, and a further reconciliation returned the confirmed
outcome. A fresh GitHub read matched the PR head, base and merge commit, including
the destination ref. The grant was revoked before phase eight completed.

This establishes the declared #301 public journey and layered fault qualification.
The implementation PR still requires its own review, exact-candidate CI and merge;
the disposable PR is not product delivery. The broader adoption, engineering
provider and efficiency requirements remain on #302, #303 and #304.

## Interpretation and accounting

Each grant allowance counts a logical admitted business effect. Source blob/tree/
commit/ref requests and projection operations have separate records; the allowance
does not count every backend API call or bound total provider spending. A projection
requires explicit external-action authority as well as a compatible persisted run
and current posture ceiling.

The phase-zero consent is intent-only. PR creation and merge require separately
bounded grants. Trusted-host authentication, hard token/currency ceilings and
human security/release attestation are unsupported by this cooperative relay.
GitHub merge enforces the head SHA but has no atomic base-retarget precondition;
the disposable experiment excludes a concurrent actor retargeting the PR.

Codex Sol implemented authority/recovery and separately reviewed them; Codex Luna
handled bounded fixture/provider work. These were desktop child subagents, with
same-platform self-review disclosed. Agy was unavailable. No native model CLI
execution, cross-platform independence or human review is inferred from helper
model names. Raw session messages and bulk process logs remain private scratch.
