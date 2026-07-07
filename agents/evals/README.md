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

## Directory Structure

```
agents/evals/
├── README.md          ← this file
├── datasets/          ← input fixtures (issue specs, diffs, role invocations)
│   └── .gitkeep
└── suites/            ← evaluation suites (assertions on agent output)
    └── .gitkeep
```

## Roadmap

Population of `datasets/` and `suites/` is tracked in a separate issue. This scaffold
establishes the directory contract so future evaluation tooling has a stable home.

## Running Evaluations

Evaluation runner TBD — tracked in a separate issue.

Results are written to `.agent-runs/evals/` (gitignored).
