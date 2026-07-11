# Deterministic assisted update proposal

This review covers the update path for projects that already use `multi-agent-sdlc`. The current workflow works, but the update plan is still too dependent on an LLM reading prose instructions and manually classifying update state. The target is an onboarding-like flow where deterministic CLI output drives the plan even when the command is invoked from an LLM session.

## Current update flow

Current entry points:

- `node bin/cli.mjs update-prompt --target <project>` prints a copy-paste LLM handoff.
- `node bin/cli.mjs doctor --target <project>` reports installed framework file status read-only.
- `node bin/cli.mjs sync --target <project>` writes safe fast-forwards, seeds missing seed-once files, updates the lockfile, and reports conflicts.
- `node bin/cli.mjs mark-merged <path> --target <project>` records an intentionally hand-merged framework file so future syncs do not fast-forward it.
- `agent-framework-lock.json` records framework-owned file hashes and hand-merged files.

## What is deterministic today

| Area                      | Deterministic behavior today                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework file list       | `lib/framework-files.mjs` is the canonical source for framework-owned and seed-once paths.                                                                  |
| Lockfile hashes           | `lib/lockfile.mjs` records content hashes for framework-owned files.                                                                                        |
| Safe fast-forward         | `sync` updates a framework-owned file only when the target hash still matches the lockfile hash.                                                            |
| Local conflict protection | `sync` reports locally modified framework-owned files as `conflicts` and does not overwrite them.                                                           |
| Seed-once behavior        | `AGENTS.md` and `docs/stack-conventions.md` are created only when missing; existing files are skipped.                                                      |
| Hand-merged behavior      | `mark-merged` removes a tracked hash and adds the path to the lockfile `merged` list.                                                                       |
| Read-only drift report    | `doctor` reports `ok`, `modified`, `merged`, `missing`, `notInstalled`, and `updateAvailable`.                                                              |
| Extension state           | `doctor` reports enabled-valid, enabled-missing, enabled-invalid, discovered-disabled, and duplicate-id extension packs without enabling or disabling them. |

## What still depends on LLM judgment

| Area               | Current LLM-dependent step                                                                                                                    | Risk                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Update readiness   | The agent decides whether `doctor` output is enough to proceed.                                                                               | Agents may miss a blocker or overstate safety.                         |
| Category mapping   | The agent maps `doctor`/`sync` arrays into safe fast-forward, conflict, seed-once skip, hand-merged, missing/removed, and blocker categories. | Different agents produce different plans for the same state.           |
| Command plan       | The agent decides whether to run `sync`, edit conflicts, call `mark-merged`, or stop.                                                         | A prompt mistake can propose writes before approval.                   |
| PR evidence        | The agent writes update evidence from memory/prose.                                                                                           | Evidence may omit counts, file categories, or approval boundary.       |
| Extension adoption | The agent decides whether newly discovered extension packs should be enabled.                                                                 | Optional policy changes can be activated silently instead of reviewed. |
| Recovery path      | Projects with no lockfile, old lockfiles, or hand-merged files require ad hoc interpretation.                                                 | Update can drift into onboarding or manual repair without clear state. |

## Target deterministic flow

Add a read-only update planning command that produces both human-readable and machine-readable output.

Recommended command shape:

```bash
node bin/cli.mjs update-plan --target /path/to/project
node bin/cli.mjs update-plan --target /path/to/project --json
```

The command should be read-only. It should not call `sync`, edit files, mark merges, commit, push, or open a PR.

### JSON shape

The output should be stable enough for tests and PR evidence:

```json
{
  "ok": true,
  "targetDir": "/path/to/project",
  "sourceFramework": {
    "version": "0.4.1",
    "frameworkFileCount": 90,
    "seedOnceFileCount": 2
  },
  "lockfile": {
    "exists": true,
    "trackedCount": 88,
    "mergedCount": 2,
    "schema": "current"
  },
  "classifications": {
    "safeFastForward": ["docs/agent-workflow.md"],
    "alreadyCurrent": ["AGENTS.md"],
    "conflicts": ["CLAUDE.md"],
    "seedOnceCreate": [],
    "seedOnceSkip": ["docs/stack-conventions.md"],
    "handMerged": ["CODEX.md"],
    "removedOrMissing": [],
    "notInstalled": [],
    "blockers": [],
    "extensions": {
      "enabledValid": ["extensions/evidence-driven-engineering"],
      "enabledMissing": [],
      "enabledInvalid": [],
      "discoveredDisabled": ["extensions/agent-handoff-governance"],
      "duplicateIds": []
    }
  },
  "recommendedCommands": [
    {
      "phase": "apply-approved-fast-forwards",
      "command": "node /path/to/multi-agent-sdlc/bin/cli.mjs sync --target /path/to/project",
      "requiresApproval": true,
      "writes": true
    }
  ],
  "approvalGate": {
    "requiredBeforeWrites": true,
    "writeCommands": ["sync", "mark-merged", "manual-conflict-edit", "commit", "push", "pr-create"]
  },
  "prEvidence": {
    "summary": "1 safe fast-forward, 1 conflict, 1 hand-merged file, no blockers",
    "validationCommands": ["doctor-env", "doctor", "update-plan --json"],
    "notes": []
  }
}
```

### Human-readable report

The non-JSON report should present the same categories in deterministic order:

1. update status and blocker summary;
2. safe fast-forwards;
3. conflicts requiring manual review;
4. seed-once creates/skips;
5. hand-merged files;
6. missing/not-installed files;
7. exact next commands, split into read-only and write phases;
8. PR evidence block.

## Approval-gated phases

The deterministic method should separate read-only planning from writes:

1. **Inspect** — `doctor-env`, `doctor`, and `update-plan --json`.
2. **Plan** — operator reviews deterministic classifications and proposed write commands.
3. **Approve** — explicit human approval required before writes.
4. **Apply** — run `sync` only for approved safe fast-forwards; resolve conflicts manually or through scoped follow-up work.
5. **Record** — use CLI-generated evidence in commit/PR body.
6. **Verify** — rerun `doctor`, `update-plan --json`, and repository validators.

An LLM may explain the report, but it should not invent categories or commands. If `update-plan` reports blockers, the agent must stop or create follow-up issues.

## Safety when called from an LLM session

The LLM-facing `update-prompt` should instruct the agent to run `update-plan --json` and present that output before requesting approval. The prompt should treat the JSON as the source of truth for classifications and next commands.

Safety rules:

- no write command before approval;
- no manual conflict edit without a file-specific plan;
- no `mark-merged` unless the plan lists the file and the operator confirms it was manually reconciled;
- no `extensions enable` or `extensions disable` unless the operator explicitly approves the extension choice;
- no PR readiness claim without deterministic PR evidence from the plan;
- no fallback from update to onboarding unless the plan classifies the target as not adopted or recovery/migration.

## Compatibility and migration concerns

- Existing lockfiles must continue to work.
- Projects without lockfiles but with framework files should be classified as `recovery-required`, not silently initialized or synced.
- Hand-merged files must remain protected and visible in the plan.
- Seed-once files must remain project-owned after creation.
- A future plan schema should include a `schemaVersion` so agents can cite the output reliably.
- `sync` should not consume an old or edited plan file unless the plan includes enough source/target identity and hash evidence to prove it is still current.

## Recommended follow-up issues

1. Add a read-only `update-plan` command with deterministic JSON/report output.
2. Add an approval-gated apply mode that consumes a current plan or otherwise refuses to write.
3. Add PR evidence generation for assisted updates so agents can paste deterministic update evidence into PR bodies.

These are separate because the read-only plan is low-risk and foundational, while plan-consuming write behavior changes update semantics and needs stricter tests.
