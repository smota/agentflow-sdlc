# Week-0 gate

The gate the [governed factory](../designs/governed-factory.md) must pass before any agent runs
unattended (design item W0-15). It runs on the author's machine against the real `sbx`, so it is not
part of `validate:release`.

```bash
agentflow-sdlc box gate --control-repo <owner>/agentflow-control
```

It writes `.agentflow/gates/week0.json` in the target directory and exits non-zero when a check
fails. The kill and cap drills run in a throwaway target directory, so the repository's own
coordinator state is not touched.

## What it checks

| Check                   | Passes when                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `box-check`             | Every week-0 setup act passes `agentflow-sdlc box check`                                                      |
| `no-ssh-keys`           | `~/.ssh` does not exist inside a fresh `sbx` sandbox                                                          |
| `no-gh-config`          | `~/.config/gh` does not exist inside it                                                                       |
| `no-github-credential`  | The GitHub API does not accept the sandbox's `GH_TOKEN` (it is `sbx`'s proxy placeholder)                     |
| `off-allowlist-blocked` | A request to `https://example.com/` from inside does not succeed                                              |
| `kill-under-10s`        | `coordinator kill` stops a real guarded run, confirms it stopped, and removes its sandbox in under 10 seconds |
| `cap-refuses`           | A guarded run with a run cap of 0 is refused                                                                  |

When `box-check` fails, the gate stops there and names the missing act.

## When to run it

- Before the first unattended run, in week 0.
- Again at the M1 exit, when it also checks the pause flag read from the control repository.
- Again at the M2 exit, when it also checks the daily budget window.
- After every `sbx` upgrade.

## Result

`week0.json` records the time, the `sbx` version, each check with its detail, and `passed`. The first
pass on the author's host, on 2026-11-25 with `sbx` 0.54.1, took 30 seconds; the kill drill stopped
the run and removed its sandbox 1,964 ms after `coordinator kill`.
