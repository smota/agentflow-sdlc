# Harness adapters

## Pi

Use Pi subagents/workflows when available. Record `pi-subagent`, `pi-session`, or `pi-parent` execution target and boundaries.

## Claude

Use Claude native plan/subagent support when available. Distinguish `claude-cli` from `anthropic-api`.

## Codex

Use framework-emulated planning and provider/CLI execution. Delegated subagents may be unavailable and should fail closed when required.

## Agy

Use Agy CLI/session routing when configured. Manual handoff may be the safest delegated mode.

## Manual

Humans can satisfy gates and manual capabilities. Record `human` executor and `human-handoff` boundary.
