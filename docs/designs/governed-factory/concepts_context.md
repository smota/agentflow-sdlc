> **Superseded for planning:** `concepts_brief.md` is the current document. This file holds the research facts the reviewers read on 2026-11-22. Its draft roadmap section is out of date.

# Goldfish context: evolving AgentFlow into a governed dark factory

Input for the brainstorm. Facts are from a read-only audit of this repository (this repository, v1.12.0, HEAD 462bfab) and from desk research done 2026-11-22. "Inference" marks judgement, not fact.

## The person and constraints (stated by the author, Samuel)

- Single maintainer. About 1-2 hours a day of human time. Agents (Claude, Codex, Gemini/Agy) do most of the building, mostly unattended. Samuel merges every PR; agents never merge.
- First user is Samuel's own repositories. The evolution must be built through AgentFlow itself (dogfooding).
- Goal at about 6 months: adoption (any kind, do not over-focus on numbers) and a business offer. The offer is implementation and services (consulting), not a hosted product, for now.
- GxP: several regulated contexts (GMP, GLP, GCP, SaMD). Keep it lightweight. It must be "claimable", meaning easy tracking and mapping of requirements to evidence. No external validation and no validation certificate.
- Assumed fixed: Windows 11 plus WSL, multiple agent vendors, GitHub as the only source system for now, no competing fork of other projects, rent an external execution engine where one fits (OpenRig today; openfabriq and a2dlc were studied).

## What AgentFlow is today

- An open-source (Apache-2.0) process and governance layer for AI coding agents: 9 role-pass phases, change class x posture risk model, person gates, digest-bound review attestations, oracle (test) custody, seat path-ownership rules, execution distributions (per-role model, effort, fallbacks), runtime platform registry. About 100k lines in lib (half tests), 33k in scripts, 145 docs, 63 schemas, 31 validators, about 90 CLI subcommands. CI on Ubuntu, Windows and macOS.
- Not published to npm (install from GitHub). 1 GitHub star. The only consumer is the author's own repo preview (not applied). No sample consumer repo.
- AgentFlow does not launch agents by itself. Agents run interactively in a terminal or in OpenRig seats. No unattended loop runs agent work today; the hourly GitHub workflow only surfaces the top human decision.

## Verified gap: documented controls that the code does not run

The guiding principles (docs/guiding-principles.md) claim: every role transition produces a tamper-evident, cryptographically chained record; monotonic fencing tokens; WIP checkpoint branches; a 15% handover context cap; a zero-deadlock gate sweeper; supervised child processes; strictly read-only tester and reviewer roles.
The modules cited for these (lib/audit/role-flow-span.mjs, lib/gates/gate-sweeper.mjs, lib/qa/process-supervisor.mjs, lib/qa/qa-contract-verifier.mjs, lib/runtime/handover-protocol.mjs, lib/runtime/lease-fencing.mjs) have no importer in the product outside tests (verified by search). All were added in one batch on 2026-09-26. AGENTS.md admits tester and reviewer are read-only by guidance only. There is no kill switch anywhere.

## Audit summary of other gaps (agent audit; not every row re-verified)

- Execution safety: isolation is git worktrees only; spawned CLIs inherit HOME, so the user's own harness hooks, rules and MCP servers load; a GitHub token fallback via `gh auth token` is reachable; network policy is declared but not enforced; no per-day budget; per-run budget admission exists and fails closed when usage is unknown.
- Verification: oracle custody and digest pinning exist, but builders can still read oracles (no holdout); no no-op test, mutation, flaky-test detection or change replay.
- Evidence: records are content-digested, but unsigned, with self-asserted timestamps, no retention policy, no prompt hash; the hash chain is unwired.
- GxP artifacts absent: supplier/model qualification, validation package, periodic review, training records, ALCOA+ mapping, CAPA lifecycle; e-signature manifestation incomplete; identity is GitHub only.
- Strong assets to keep: stale-digest review attestation (lib/core/review-attestation.mjs), oracle custody with revocation epochs (lib/core/oracle-custody.mjs), model-family four-eyes check (lib/core/execution-receipt.mjs), human-gate rule (lib/core/gate.mjs), fail-closed budget admission (lib/core/delivery-policy.mjs), distribution pinning with confirm-token migrations, risk-adaptive posture (fits FDA CSA risk-based assurance), release gate across three operating systems.

## Landscape (desk research; mostly secondary sources)

- Popular AI-DLC frameworks win adoption with one-command install, harness neutrality and low ceremony (GitHub Spec Kit about 151k stars, OpenSpec 75k, BMAD 56k, Superpowers). They are prompt conventions with no enforcement and no signed evidence.
- Engines enforce (AWS AI-DLC 6.2k stars with an audit trail and approval gates; Archon; Kiro; Warp), but none signs approvals or keeps a tamper-evident log. No surveyed framework claims Part 11, Annex 11, FDA CSA or GAMP alignment. Inference: the regulated niche is open.
- Credible "dark factories" (StrongDM: no human writes or reviews code) rely on: human-owned intent and spec; holdout scenarios the agent cannot read; deterministic gates before LLM judgement; isolated high-fidelity environments; a gated merge path with recovery. No source publishes defect or revert rates.
- Production agent platforms (Stripe, Spotify, Ramp, GitHub Copilot agent, Factory, Devin, Claude Code) converge on: a fresh sandbox per run; default-deny egress including MCP traffic; agents hold no push credentials (platform pushes with short-lived tokens); checks before review and the requester cannot approve; hard spend, turn and sub-agent limits plus a kill switch; a per-run audit trail the agent cannot alter. Incidents in 2025-2026 (Replit production database deletion, Amazon Q wiper prompt, Nx "s1ngularity" secret theft through agent CLIs, GitHub MCP private repo leak) each map to a missing control in that list.
- Mature standards: in-toto statements and SLSA provenance, GitHub artifact attestations or cosign, RFC 3161 trusted timestamps, SSH-signed commits and approvals, OPA or Cedar default-deny policy at the tool-call hook, per-seat GitHub App tokens (1 hour), NIST SSDF and SP 800-218A as a control catalog. No standard yet binds model version, prompt and context to an artifact.
- GxP: draft EU GMP Annex 22 (consultation closed October 2025) excludes LLMs from critical GMP use and requires human verification elsewhere; FDA CSA final September 2025; ISPE GAMP AI guide July 2025; QMSR effective February 2026. Roles that must stay human: e-signature and approval, release, risk acceptance, supplier qualification, design-review sign-off, periodic review, approval of changes to the factory itself. Two cases: (A) the GxP software the factory builds; (B) the factory as a tool used to build it, which needs proportionate tool assurance. Statuses of drafts are unconfirmed; not legal advice.

## Draft roadmap under review (proposed by the assistant; the brainstorm should challenge it)

0. Truth (2-3 weeks): wire or retract every unwired claim; "implemented / measured" ledger; npm publish; consumer repo.
1. Safe execution (4-6 weeks): sandbox and egress, credential and config isolation, kill switch, per-day budget, wire sweeper and supervisor, harness-neutral write-time guards.
2. Independent verification (4-6 weeks): holdout custody, no-op and mutation checks, replay benchmark, judge calibration; evaluate a2dlc instead of rebuilding.
3. Evidence integrity (4-6 weeks): in-toto statements, signed approvals, trusted time, wired hash chain, model and prompt hash, retention.
4. GxP overlay (6-10 weeks): opt-in pack with intended use, risk assessment, trace matrix, supplier and model qualification, validation package templates, periodic review, CAPA, e-signature manifestation.
5. Enterprise (later): more source systems, SSO, SIEM.

Known tensions already raised: the total is about 24-37 focused weeks for one person; GxP shapes the evidence schema so putting it last risks rework; dogfooding on non-regulated repos never exercises GxP features; the agents building AgentFlow run without the safety controls until Phase 1 lands; Samuel's 1-2 hours a day of review caps throughput; a services offer is sold on a credible demo and case study rather than feature completeness.
