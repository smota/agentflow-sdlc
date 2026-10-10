# Person gates

A person gate is a decision only a person can make: agreeing to a goal revision, releasing a
candidate, or answering an agent escalation. The gate classes, subject kinds, and decisions are the
ones in `lib/core/gate.mjs`. This page covers how a gate appears on the work record.

Three facts stay separate on every work item:

- A **phase pass** means an agent finished a role. It never answers a gate.
- A **process state** (Backlog, Readiness, WIP, Delivered) comes from the phase record. A gate never
  changes it.
- A **person gate** is waiting, agreed, refused, or stale. Only the person's answer moves it.

## Statuses

| Status  | Meaning                                                                          |
| ------- | -------------------------------------------------------------------------------- |
| waiting | The decision is owed. The entry names who must answer and the subject.           |
| agreed  | The person answered `agree` on this subject. Only this status satisfies a gate.  |
| refused | The person answered `changes-requested` or `blocked`. The gate is not satisfied. |
| stale   | The item's subject changed. Earlier answers do not carry to the new subject.     |

A gate binds to the item's current subject:

- A goal gate (`goalRevision`) binds to the goal a person reads: its title, its body without the
  product's gate block, and its kind, parent, and change class. The same digest is used on GitHub
  and on the filesystem. A phase pass, a label, or an issue update does not change it.
- A candidate gate (`candidateDigest`) binds to the item's current candidate, recorded with
  `gates candidate`. With no candidate recorded, no candidate gate opens.

When the subject changes, earlier answers show `stale`, and a `waiting` gate for the new subject
appears on the item. Answering it records that gate.

Who must answer is the gate's required role on the registered human platform, plus a named person
when the project names one. An agent is never the who, even an agent that holds the role.

An agent action under a delegation grant is recorded as **on behalf**: the person is the principal,
the agent platform and executor are the actor, with the grant reference, action, and subject. It is
an agent action. It never satisfies a gate.

## Commands

```bash
agentflow-sdlc gates open --medium filesystem --root <goal-dir> --class adequacy-of-intent --role analyst
agentflow-sdlc gates waiting --medium github --repo <owner/repo> [--role <role>] [--person <name>] [--json]
agentflow-sdlc gates candidate --medium filesystem --root <goal-dir> --subject <candidate digest>
agentflow-sdlc gates answer --medium github --repo <owner/repo> --issue <n> --gate <digest> --decision agree --person <name>
agentflow-sdlc gates on-behalf --medium filesystem --root <goal-dir> --principal <person> --actor-platform claude --actor-executor claude-cli --grant <ref> --action merge --subject-kind candidateDigest --subject <digest>
```

`gates answer` is for the person, in the person's own terminal. **An agent must not run it.** The
command takes no platform from the caller, writes the answer as the registered human platform with
`human-gate` independence, and exits non-zero without writing anything when it runs under an agent
runtime (it checks `AI_AGENT`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, the Codex sandbox and thread
variables, and an OpenRig seat's session and node ids).

The platform field is the existing local trust model. The record is not proof of identity, and no
part of it is an electronic signature. A later system that proves identity must produce an answer
record that the same validator accepts.

Opening a gate also emits the existing optional gate-pending event when `AGENTFLOW_GATE_HOOK_URL`
is set. With no hook, nothing is sent and nothing fails: the record and `gates waiting` are the
wait list.

## Where the record lives

- Filesystem medium: `gates.json` beside `goal.json`. It is not a transition.
- GitHub: one product-owned block in the issue body, between `<!-- agentflow-gates -->` and
  `<!-- /agentflow-gates -->`. The block shows a table of gates and any on-behalf actions, and
  carries the record the product reads back. The product rewrites it; do not edit it by hand.
  Ordinary issue comments are never read as answers.

`agentflow-sdlc phase read` returns the projected gates for the item on either medium.

## One validator

`judgeAnswer` and `validateGateLog` in `lib/core/person-gates.mjs` accept a sealed gate plus a
person's `agree` from the human platform on the current subject, and defer to `satisfyGate` for the
final decision. They reject, each with its own reason:

- `agent-signature`: the answer is not from the human platform with `human-gate` independence.
- `stale-subject`: the answer is not bound to the gate's current subject.
- `altered-gate`: the gate no longer matches its seal.
- `grant-as-agreement`: an on-behalf entry or a delegation grant presented as the answer.
- `refusal-as-satisfaction`: a refusal presented as satisfaction.

The same records give the same verdict on GitHub and on the filesystem medium.
