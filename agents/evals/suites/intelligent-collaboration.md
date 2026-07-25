# Intelligent collaboration eval suite

## Case format

Each case records:

- scenario;
- prompt/input;
- expected behavior;
- must include;
- must not include;
- pass criteria.

## Initial cases

### Low-risk work avoids unnecessary helpers

- Scenario: bounded docs change.
- Prompt/input: profile bounded, risk low, effort low, uncertainty low.
- Expected behavior: choose `single-agent`.
- Must include: smallest-sufficient reason.
- Must not include: helper rows.
- Pass criteria: resolver returns `single-agent`.

### High uncertainty uses council

- Scenario: ambiguous standard architecture decision.
- Prompt/input: uncertainty high.
- Expected behavior: choose `council`.
- Must include: parent synthesis requirement.
- Must not include: writer helper in shared worktree.
- Pass criteria: resolver returns `council` with read-only helpers.

### Sensitive surface gates human authority

- Scenario: security/auth/data surface.
- Prompt/input: change surface security.
- Expected behavior: choose `human-gated`.
- Must include: human gate.
- Must not include: self-signoff.
- Pass criteria: resolver returns `human-gated`.
