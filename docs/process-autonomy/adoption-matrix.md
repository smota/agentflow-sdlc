# Adoption documentation coverage matrix — S8

This matrix maps supported adopter entry points, required instructions, observable outcomes, and recovery paths across the five canonical adoption journeys, as defined in `docs/maintainers/process-autonomy-execution-plan.md`.

## Journey Coverage Matrix

| Adoption journey | Prerequisites | User intent | Documented action / command | Expected observable result | Next step | Recovery / undo path |
| --- | --- | --- | --- | --- | --- | --- |
| **1. First adoption on empty machine / project** | Node.js 20+, Git installed, empty directory or clean repo | Initialize AgentFlow governance, select runtime adapters | `node bin/cli.mjs adopt plan --target <path> --json` then `adopt apply` | `agent-workflow.config.json` created, exit 0, validation passes | Run `sdlc validate` | Remove config file or run `git clean -df` |
| **2. Existing or partial installation** | Pre-existing Git repo with some config | Detect existing skills/config, configure missing adapters | `node bin/cli.mjs adopt plan --target <path>` | Displays remaining actions, reuses existing compatible config | Confirm remaining plan items | Plan is non-destructive until confirmed |
| **3. Upgrade or unknown installation** | Repository initialized with older version | Update contracts and adapters without overwriting local custom rules | `node bin/cli.mjs adopt plan` with upgrade preview | Shows additive changes, preserves local customizations | Review diff, apply confirmed update | Rollback via Git commit revert or re-running prior migration |
| **4. Autonomous execution & handover** | Initialized project, approved task issue/spec | Approve once for bounded execution; fresh agent continues | `issueGrant` / `dispatchToHarness`, export continuation packet | Execution proceeds to budget limit without prompt; fresh agent resumes via bundle | Verify PR / gate evidence | Revoke grant or call `cancel`; rollback to base branch |
| **5. Optional integrations & troubleshooting** | Core AgentFlow installed; optional Meshloop or OTel | Connect optional execution harness or OTLP collector | Configure `meshloop` or `otel` in project config | Executes via adapter if available; graceful fallback if absent | Review qualification receipt | Disable config flag; core workflow continues directly |

## Documentation Integrity Rules

1. **Source vs Installed Separation**: Testing development versions explicitly uses checkout source files (`bin/cli.mjs`, `lib/`); never edit installed runtime links directly.
2. **Approve-Once Authority**: A single approval binds a scoped delegation grant with hard ceilings. Material deviations (out-of-scope paths, budget exhaustion) halt execution immediately.
3. **Portable Continuation**: Continuation packets (`continuation-packet-v1`) contain content-addressed digests and metadata allowing independent handover without chat transcript dependencies.
4. **No Hidden Failures**: Unsupported providers, missing binaries, or malformed outputs fail closed with structured error codes rather than falling back silently.
