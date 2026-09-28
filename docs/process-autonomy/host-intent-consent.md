# Phase-zero host-observed intent consent

New runs require a scoped, host-observed decision before phase zero advances. The
decision records that the actual user accepted the adequacy of the frozen intent.
It does not authorize an edit, grant a business action, establish human identity,
or satisfy candidate, security, release, or changed-goal review gates.

The host may supply `resolveHostIntentConsent(request)` to `createRunService`.
The callback receives a sealed request after bilateral role acceptance and current
verification pass. It must return a `host-intent-consent` record created with
`createHostIntentConsent` from an actual observed user decision. With no callback or
receipt, the service blocks phase zero. The event stores both the sealed request and
decision atomically with the phase advancement. Old event chains remain readable;
their earlier advances are not retroactively represented as consented.

The public CLI exposes the same cooperative relay through a plan and exact digest
confirmation:

1. Save the current `run next <id> --json` advance plan. Run
   `run intent-plan <id> --plan <advance.json> --confirm <advance-plan-digest>` to
   get the sealed request.
2. The active agent checks the actual user session decision against that request.
   It creates a typed consent with `createHostIntentConsent`, including `decision:
'agree'`, a registered non-human `observerRuntime`, observed and expiry timestamps, and SHA-256 digests
   for the session, turn, evidence, and decision reference. Keep raw private
   identifiers and transcript references in host scratch; only opaque digests go
   into source state.
3. Supply the receipt to `run advance <id> --execute --plan <advance.json>
--confirm <advance-plan-digest> --consent <receipt.json> --consent-confirm
<receipt-digest>`. The command rederives the current scope and source revision;
   any changed plan, frozen goal, checks, business boundary, budget, or source
   revision blocks advancement.

The CLI rereads the source issue when advancing and compares it with the frozen
revision. This detects observed drift; it is not an enduring lock on issue content
after that read.

The request binds the run, generation, phase-zero revision, frozen goal and
contract revision, plan digest, profile, destination, checks, and business ceiling.
Its `expiry.effectGrant: separate-typed-grant-required` means this is **intent-only**
acceptance. No business effect inherits an expiry or budget from the consent. Each
effect instead requires its own bounded typed grant and admission, with concrete
expiry and allowances. A null run budget means no numeric budget was configured;
it is not an unlimited effect grant.

This is a local cooperative observation claim by the host agent, not authenticated
human review. The CLI cannot verify who authored a receipt or whether the claim is
truthful when processes share the same account. The receipt never substitutes for
the high-assurance human gates or the separate escalation flow. A source-branch
write uses coordination transport authority only; the persisted run boundary and
posture ceiling still govern business actions. Standard posture's open-PR ceiling
does not permit merge, and observe/propose do not permit edits. Delegated merge
also remains blocked whenever the effective change class requires human candidate
release; this cooperative intent receipt is not release evidence.
