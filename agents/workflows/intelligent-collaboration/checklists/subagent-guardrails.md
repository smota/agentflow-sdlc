# Subagent guardrails checklist

- [ ] Helper task is bounded and useful.
- [ ] Helper is read-only unless isolated spike.
- [ ] One writer per shared worktree.
- [ ] No secrets or private local data in helper prompt/output.
- [ ] Timeout/file/tool limits set where applicable.
- [ ] Parent validates helper findings.
- [ ] Helper does not sign final gate unless role routing explicitly assigns it and evidence supports that.
