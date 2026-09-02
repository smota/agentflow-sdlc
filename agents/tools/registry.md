# Agent Tools Registry

Inventory of CLIs, identity registry, and MCP integrations used by registered runtime platforms in
role-based workflow. Runtime platform identity is separate from tool/executor used; see
`manifests/runtime-platforms.json` and `docs/runtime-platforms.md`. Each runtime invokes tools within
its own session — there is no shared dispatcher.

---

## Runtime platform identity registry

| Registry/tool                                   | Purpose                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `manifests/runtime-platforms.json`              | Built-in ChatGPT, Cowork, Antigravity, Pi, Claude, Codex, Agy, and human identity slugs |
| `lib/runtime-platforms.mjs`                     | Registry validation, project extension merge, identity lookup                           |
| `schemas/runtime-platform-registry.schema.json` | Portable registry shape                                                                 |
| `scripts/validate-pr-manifest.mjs`              | Registry-backed PR identity validation                                                  |
| `scripts/validate-role-attribution.mjs`         | Registry-backed multi-agent attribution validation                                      |
| `scripts/validate-sdlc-role-pass.mjs`           | Registry-backed role-pass identity validation                                           |

## Headless CLIs

| Model  | CLI command  | Notes                                                    |
| ------ | ------------ | -------------------------------------------------------- |
| Claude | `claude -p`  | Non-interactive prompt mode                              |
| Codex  | `codex exec` | Resolve from `PATH`; set `CODEX_CLI` to override         |
| Agy    | `agy -p`     | Cross-platform Go binary; no path prefix needed          |
| Pi     | `pi`         | Parent/session runtime; subagent targets remain distinct |

ChatGPT, Cowork, Antigravity, and human may be truthful platform identities without a matching
headless CLI entry. Record actual executor, transport, delegation boundary, and model separately.

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

| Script                                           | Purpose                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `scripts/validate-spec.mjs`                      | Validates `SPEC.md` before implementation begins                    |
| `scripts/validate-bounded.mjs`                   | Checks Lane B (bounded) eligibility on the current diff             |
| `scripts/system-check.mjs`                       | Validates local environment, versions, and connectivity             |
| `scripts/issue-markdown.mjs`                     | Pure transform for replacing a section in an issue/PR markdown body |
| `scripts/provider-status.mjs`                    | Inspects provider facets and execution-intent support at runtime    |
| `scripts/role-collaboration.mjs`                 | Classifies, plans, validates, and verifies role collaboration       |
| `scripts/validate-execution-intent-evidence.mjs` | Validates portable execution-intent evidence and guardrails         |
| `scripts/role-collaboration-smoke.mjs`           | Runs the provider-to-role-acceptance path without external effects  |

Run from the repository root with `node scripts/<name>.mjs`. Use `pnpm --filter <package>` for
package-scoped commands.
