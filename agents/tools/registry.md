# Agent Tools Registry

Inventory of CLIs and MCP integrations available to Claude, Codex, and Agy when running the
role-based single-agent workflow (`AGENTS.md` §23). Each agent invokes these directly within its
own session — there is no shared dispatcher.

---

## Headless CLIs

| Model  | CLI command  | Notes                                            |
| ------ | ------------ | ------------------------------------------------ |
| Claude | `claude -p`  | Non-interactive prompt mode                      |
| Codex  | `codex exec` | Resolve from `PATH`; set `CODEX_CLI` to override |
| Agy    | `agy -p`     | Cross-platform Go binary; no path prefix needed  |

Headless Codex invocations disable project hooks to prevent repeated hook output from consuming
the review context window.

---

## MCP Integrations

MCP servers extend agent capabilities within interactive Claude Code sessions. They are configured
in `.claude/settings.json` and are not available in headless subagent invocations.

| MCP Server        | Capability                    | Notes                              |
| ----------------- | ----------------------------- | ---------------------------------- |
| `context7`        | Library documentation lookup  | Fetch current docs for any library |
| `Supabase`        | Direct database introspection | Read schema, RLS policies          |
| `Google Calendar` | Calendar event management     | Scheduling and availability        |
| `Gmail`           | Email drafting and labeling   | Async handoff notifications        |
| `Google Drive`    | Document read/write           | Spec and report access             |

MCP servers are session-scoped. Never pass MCP credentials on the command line or store them in
committed configuration.

---

## Deterministic scripts (`scripts/*.mjs`)

| Script                         | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `scripts/validate-spec.mjs`    | Validates `SPEC.md` before implementation begins                    |
| `scripts/validate-bounded.mjs` | Checks Lane B (bounded) eligibility on the current diff             |
| `scripts/system-check.mjs`     | Validates local environment, versions, and connectivity             |
| `scripts/issue-markdown.mjs`   | Pure transform for replacing a section in an issue/PR markdown body |
| `scripts/setup.mjs`            | Installs git hooks and shared skills (`--force` to reinstall)       |

Run from the repository root with `node scripts/<name>.mjs`. Use `pnpm --filter <package>` for
package-scoped commands.
