# ADR 020 — Docker Sandboxes (`sbx`) as the reference containment substrate

**Status:** Proposed
**Date:** 2026-11-25

## Context

The [governed-factory design](../designs/governed-factory.md) runs each agent run in a disposable
sandbox that holds no GitHub credential and cannot reach hosts off an allowlist. The author chose
Docker Sandboxes (`sbx`, microVMs on the Windows host) as the reference implementation, with an
assembled WSL2 stack as a fallback built only if `sbx` fails its week-0 spike (D41). This ADR records
that spike (design item W0-4), run on the author's host on 2026-11-25 with `sbx` 0.54.1.

## Decision

1. **`sbx` is the reference containment provider.** It passed the spike, so the WSL2 fallback (M2-7)
   is not built. Minimum version 0.51.0 (a high-severity file-copy escape was fixed there); the host
   runs 0.54.1, and `agentflow-sdlc box check` refuses anything older than the minimum.

2. **One sandbox per run, in three steps.** `sbx run` refuses a non-interactive run unless it is
   detached, so the guarded runner (and later the launcher) uses this mapping in
   `.agentflow/sandbox.json`:

   ```json
   {
     "startCommand": ["sbx", "run", "--detach", "--name", "{name}", "<agent>", "{workspace}"],
     "command": ["sbx", "exec", "{name}"],
     "stopCommand": ["sbx", "rm", "--force", "{name}"],
     "envAllowlist": ["LOCALAPPDATA", "APPDATA", "ProgramData"]
   }
   ```

   `{name}` is a fresh name per run (`af-` plus eight characters of the run id) and `{workspace}` is
   the working copy. `<agent>` is `claude` for Claude runs and `shell` for checks that need no model.

3. **Teardown is the stop.** Killing the host-side `sbx exec` does not stop the process inside the
   sandbox: in the spike, a `sleep` kept running in the microVM after its host process was killed.
   The runner therefore removes the sandbox after every exit, including a killed or timed-out run.

4. **Network policy: `balanced`.** The global policy is initialized as `balanced`, which is
   deny-by-default plus `sbx`'s allow list of AI services and package registries (195 allow rules on
   2026-11-25). An unlisted host returns 403 from the proxy. Design item M2-6 replaces it with the
   factory's own allowlist on a `deny-all` base.

5. **Never store a `github` secret in `sbx`.** Every sandbox carries `GH_TOKEN=gho_sbxproxy…`, a
   proxy placeholder that GitHub rejects (401). If a `github` service secret were stored, the proxy
   would authenticate the agent's GitHub requests, which breaks the rule that an agent holds no
   GitHub credential. `box check` fails when one is stored.

6. **Model credentials go through the proxy.** Claude Code runs headless inside the sandbox
   (`claude -p ... --output-format json` returns a result with no terminal) but reports
   "Not logged in" until a credential exists. The two routes are a stored `anthropic` service secret
   (an API key, injected by the proxy and never visible inside) or a login made inside the sandbox,
   which is lost when the sandbox is removed. Which route applies is the author's vendor-terms
   decision (W0-18). `sbx` has no built-in Agy agent; Agy needs the `shell` agent with `agy`
   installed, or a kit.

## Spike results

| Question                                    | Result                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Headless run with no terminal               | Works through `sbx exec`; `sbx run` needs `--detach` when not interactive                          |
| `~/.ssh`, `gh` configuration                | Absent inside; the host profile shows only the empty folders leading to the workspace              |
| Ambient GitHub token                        | Only the proxy placeholder; GitHub answers 401; no secrets stored                                  |
| Off-allowlist egress                        | 403 from the proxy (`example.com`, `neverssl.com`); `api.anthropic.com` reachable                  |
| Writes outside the workspace                | `/etc` refused; the sandbox's own home is writable and disappears with the sandbox                 |
| Kill of the host process                    | The process inside keeps running; removing the sandbox stops it                                    |
| Coordinator kill through the guarded runner | Run reported `killed` and its sandbox removed 2.1 seconds after `coordinator kill`                 |
| Sandbox lifecycle                           | Create 55 s on first use (image download), 5 s cached; `sbx rm --force` 1 s; no leftover processes |

The agent user inside the microVM belongs to `sudo`; the microVM is the boundary, not the user.

Not answered yet: whether a Claude login survives `sbx rm` and re-creation, and token refresh,
because no Claude credential has been provided (decision 6); and working-copy performance on the full
repository, measured only on a small scratch workspace so far.

## Consequences

**Positive:** Containment is rented, with the main guarantees observed rather than assumed: no
GitHub credential, a deny-by-default proxy, and a kill that removes the whole sandbox in about two
seconds. The runner needs no `sbx`-specific code; the command lines are configuration.

**Negative:** The `balanced` allow list is `sbx`'s, not the factory's, until M2-6. A stored `github`
secret would silently undo the credential rule, so it depends on `box check` and the week-0 gate.
`sbx` is closed-source and pre-1.0, so it is pinned, listed as "not qualified" in the supplier table
(M4-3), and re-checked on each upgrade.
