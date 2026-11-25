# Week-0 setup

The setup acts the [governed factory](../designs/governed-factory.md) needs, in the order the
milestones first need them. Each act is the author's: it contains the agents, so no agent can
reach it. `agentflow-sdlc box check` reads each one and names what is missing.

```bash
agentflow-sdlc box check --control-repo <owner>/agentflow-control
```

`box check` needs your local `gh` and `sbx` sign-ins, so it is not part of `validate:release`. It
reports each act as `ok`, `missing`, `later` (a later milestone needs it first) or
`not-applicable`. It exits non-zero when a week-0 act is missing.

## Week 0

These acts must pass before the week-0 gate.

1. **Install `sbx`** (Docker Sandboxes) at version 0.51.0 or later, because 0.51.0 fixed a
   high-severity file-copy escape:

   ```bash
   winget install Docker.sbx
   ```

2. **Start the daemon in the background and sign in** to Docker in your own terminal. Without
   `--detach` the daemon stops when its terminal closes. The sign-in uses your Docker
   account, so an agent never performs it. Signing in also initializes the global network policy:

   ```bash
   sbx daemon start --detach
   sbx login
   sbx diagnose
   ```

3. **Create the private control repository** with the layout in ADR 021: `path-classes.json`,
   `trust-policy.json`, `pause.json`, `checkins/`, `canon/`, `delegation/` and
   `holdouts-repo.json`. It holds policy, not secrets. Give no GitHub App write access to it.

4. **Set the host rules** on the machine that runs the factory:
   - Turn off sleep on AC power: `powercfg /change standby-timeout-ac 0`.
   - Keep WSL running if you use the WSL2 fallback: `vmIdleTimeout=-1` in `%UserProfile%\.wslconfig`.
   - Windows Update restarts outside your active hours. Treat them as planned downtime: the soak
     excludes logged downtime from its active hours.

5. **Initialize the coordinator** in the repository the factory works on. It starts paused, so
   nothing runs until you resume it:

   ```bash
   agentflow-sdlc coordinator status
   agentflow-sdlc coordinator resume
   ```

6. **Set the run cap** in `.agentflow/run-cap.json` (default 10 runs per 24 hours):

   ```json
   { "limit": 10, "windowHours": 24, "runs": [] }
   ```

7. **Set the sandbox command** in `.agentflow/sandbox.json` from the `sbx` spike recorded in ADR 020.
   `command` runs an agent command inside a sandbox; `stopCommand` tears the sandbox down after
   every run; `envAllowlist` may name only approved, non-credential variables.

## Later milestones

`box check` lists these as `later` until the milestone that needs them.

| Act                                                                                                  | Needed by                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Configure npm trusted publishing for `agentflow-sdlc`                                                | M0 (the `next` alpha)                       |
| Set up a commit-signing key and add its fingerprint to `trust-policy.json`                           | M1 (signed human acts)                      |
| Create the builder, reviewer and steward GitHub Apps, each installed on the governed repository only | M1 (the launcher pushes as the builder App) |
| Create the private holdouts repository and its read-only deploy key                                  | M2 (verifier job C)                         |
| Require a code-owner review on `factory-core` paths, with only the author on the bypass list         | M2 (`.github/CODEOWNERS`)                   |
| Enable the merge queue and sign the first delegation                                                 | M2b (the merger)                            |
| Limit the steward App to `v*-next.*` tags and reserve other release tags for the author              | L3                                          |

## Kill authority

You are the kill authority. `agentflow-sdlc coordinator kill` stops every guarded run on the machine
at once and refuses new ones until you resume. `pause` lets the active run finish.
