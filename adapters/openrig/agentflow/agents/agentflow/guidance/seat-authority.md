# Seat authority

Claude tool rules for this seat are `claude_permissions` with allow and deny lists in the rig spec, or `rig seat set-permissions <seat> --rules <file.json> --reason "<why>"` for an existing seat. OpenRig never writes those rules into the project's Claude settings.

Launch no longer rewrites `defaultMode` in `.claude/settings.local.json` to `acceptEdits`. OpenRig 0.7.1 stopped that rewrite and does not repair a file already changed. Do not expect that rewrite.

When this seat uses its own account home, that home is an absolute `CLAUDE_CONFIG_DIR` or `CODEX_HOME` under the member's or the rig's `env:`. `rig up --env` does not apply those two variables.

Typing guard: `rig seat set-typing-guard <seat> --mode off|openrig-urgent|urgent-only|hold`. It is off until set, so automatic input still reaches an existing seat.

Terminal policy: `rig seat set-terminal-policy <seat> --preset no-peer-interventions|help-within-instructions|full-control`. Existing seats keep `full-control` until that command is used.

Hosted members stay off. The unqualified Claude API-key switch stays off.
