# Agent Evaluation Framework

This directory scaffolds the evaluation infrastructure for detecting regressions in agent behavior
when skills, workflows, or `AGENTS.md` change.

## Intent

Agent evaluations verify that:

- Orchestration workflow produces correct evidence for each profile (bounded, standard, high-assurance)
- Role skills apply the correct checklist and output format for each named role
- Policy constraints from `AGENTS.md` are enforced (no `any`, no trunk branch commits, tenant isolation, etc.)
- Self-review and human-review gates trigger for the right profiles (`AGENTS.md` §23) and backup
  routing (`CLAUDE.md`/`CODEX.md`/`AGY.md`) degrades gracefully when an agent is unavailable

Evaluations are not a replacement for code review or CI — they complement them by catching
behavioral drift that unit tests cannot observe.

## Directory structure

```
agents/evals/
├── README.md          ← this file
├── datasets/          ← input fixtures for behavioral scenarios
├── fixtures/          ← expected and actual output fixtures
├── manifests/         ← executable eval manifests
├── prompts/           ← harness prompts used by manifests
└── suites/            ← human-readable suite contracts
```

## Running evaluations

Run the maintained framework suites and multi-agent acceptance checks:

```bash
pnpm test:evals
```

Run one manifest directly while developing a focused scenario:

```bash
node scripts/run-agent-evals.mjs --manifest agents/evals/manifests/framework-contracts.json --json
```

Results are written to `.agent-runs/evals/` (gitignored).
