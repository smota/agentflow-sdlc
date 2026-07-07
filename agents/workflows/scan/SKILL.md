---
name: scan
description: 'Run a broad-context architecture or security scan in-session using Explore/Task subagents. Use when the scan scope exceeds what fits comfortably in the active context window.'
---

# /scan

Run a broad-context architecture or security scan in-session. Use for architecture or security
evidence when the scan scope exceeds what fits comfortably in the active context window.

Findings are advisory input to the current workflow profile's review step (self-review for
bounded/standard, human review for high-assurance — see `AGENTS.md` §23). Return the result for the
workflow-status comment. Do not create a separate issue comment unless the result needs explicit
attention or handoff.

---

## Usage

```
/scan <task-description>
```

Example:

```
/scan "scan all NestJS services for database queries missing a tenantId filter"
```

---

## Execution steps

### Step 1 — Determine scope

Determine scope from the task description. Default: all non-test TypeScript source files.

```bash
find apps packages \
  -name "*.ts" \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -name "*.spec.ts" \
  -not -name "*.integration.spec.ts" \
  -not -name "*.functional.spec.ts" \
  | sort
```

Narrow the scope if the task is domain-specific (e.g. only `apps/api/src/`).

### Step 2 — Run the scan

Read `AGENTS.md` for project conventions, then scan the scoped files for the requested violations.

For scans that fit in the current context, search directly (Grep/Glob/Read). For scans that exceed
the active context window, delegate to the `Explore` agent (or `general-purpose` for
multi-step analysis) with a self-contained prompt describing the conventions to check and the file
scope — see the Agent tool guidance for writing effective prompts.

List all violations with file path, line reference, violation type, and fix recommendation.

### Step 3 — Present findings

Format the output as:

```
## [SCAN] Findings

Task: <task-description>
Files scanned: <count>

<findings>

---
Advisory input only — assessed during this workflow's self-review or human-review step.
```

Incorporate findings into the current review evidence. The self-review (or human review, for
high-assurance) decides whether each finding is a gate failure or a follow-up.

---

## Rules

- Validate subagent output before incorporating it — trust but verify (`AGENTS.md` §17).
- Findings are input, not a verdict — this workflow's self-review or human review decides.
- Scope the file set to what is relevant — do not send the entire repo if a subdirectory suffices.
