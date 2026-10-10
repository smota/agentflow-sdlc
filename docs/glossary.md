# Glossary

One meaning each for the terms that describe where AgentFlow work is recorded, who runs it, and
what the Cockpit may address. Other documents use these terms with these meanings.

| Term             | Meaning                                                                                                                                                                                                                              | Examples                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Source adapter   | Where the durable work record lives. It implements the `SourceAdapter` port. See [GitHub source adapter](sources/github.md).                                                                                                         | GitHub, the filesystem medium  |
| Execution layer  | What runs agent seats for a project. A project names one execution layer or none. With none, AgentFlow records work but nothing in AgentFlow runs it. An execution layer is not a provider, a runtime platform, or a source adapter. | OpenRig, none                  |
| Coordinator      | The one seat of the execution layer that the Cockpit addresses. The Cockpit does not call any other seat.                                                                                                                            | The OpenRig orchestrator seat  |
| Runtime platform | Who produced workflow evidence. It is a registered identity, not a mechanism. See [Runtime platforms](runtime-platforms.md).                                                                                                         | `claude`, `codex`, `agy`, `pi` |
| Harness adapter  | The files that let one agent harness run AgentFlow: its entry file, skills, roles, and settings. See [`adapters/`](../adapters/).                                                                                                    | `claude-code`, `codex`, `pi`   |

Two related terms keep their own documents:

- A **provider** supplies capabilities behind the versioned provider port. See the
  [provider matrix](providers/provider-matrix.md).
- An **execution target** says how one runtime platform's work is launched. See
  [Execution targets](execution-targets.md).

Pi is a runtime platform and a harness adapter. It is not a provider and not an execution layer. The
`pi-cli` provider was removed; a configuration that names it fails with that message. OpenRig runs
Pi seats as the execution layer.
