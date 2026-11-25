# Digest and signing spike (week 0)

Design item W0-17 of the [governed-factory design](../../../docs/designs/governed-factory.md): four
questions to answer before M1 writes evidence records, so the envelope format does not need a
migration later. Run on the author's Windows host on 2026-11-25. The results feed ADR 022 (signing
seam) and ADR 023 (evidence envelope) in M3.

## 1. Do Windows and WSL checkouts produce the same digest?

**Answer: only for files that `.gitattributes` pins to LF. Git object IDs always agree.**

The Windows host has `core.autocrlf=true`. The repository's `.gitattributes` sets `* text=auto` and
pins `*.md`, `*.mjs` and `*.sh` to `eol=lf`. Of 1,173 tracked files, 193 were checked out with CRLF on
Windows: 143 JSON, 27 YAML, 7 text, 6 YML, 2 TOML and a few others.

For the same commit, cloned on Windows and inside WSL:

| File                        | Windows SHA-256 | WSL SHA-256     | Git blob ID (both) |
| --------------------------- | --------------- | --------------- | ------------------ |
| `docs/index.md` (`eol=lf`)  | `20c5e5352bd3…` | `20c5e5352bd3…` | `e7bf580eedfe…`    |
| `goals/gf-week-0/goal.json` | `e2b989f4b8b9…` | `e9d75362bc2c…` | `8f825dea4968…`    |

The tree ID agreed as well. Consequences:

- Evidence digests must hash git object IDs or LF-normalized content, never raw working-tree bytes
  (this is design item M3-5).
- `.gitattributes` now pins `*.json`, `*.yaml`, `*.yml`, `*.toml` and `*.txt` to `eol=lf`, so new
  checkouts agree on those bytes too. Files already checked out keep CRLF until they are checked out
  again; their index content is already LF, so no renormalization commit is needed.

Commands:

```bash
git ls-files --eol | awk '$2=="w/crlf"'
git rev-parse HEAD:<path>          # blob ID, identical on both checkouts
sha256sum <path>                    # differs for CRLF working-tree files
```

## 2. Does a commit signed with the author's key verify through the API and offline?

**Not yet answered.** No commit-signing key is configured on the host. It is listed as a later act
(needed by M1, signed human acts) in `agentflow-sdlc box check`, and this question is answered when
the key exists.

## 3. Does an RFC 3161 token verify offline?

**Answer: yes.** A SHA-256 timestamp request to `https://freetsa.org/tsr` returned `Status: Granted`
with a SHA-256 message imprint. `openssl ts -verify` then verified the token with no network, using
only the TSA's CA certificate and signing certificate saved beforehand. After one line was appended
to the data, the same check reported `Verification: FAILED`.

```bash
openssl ts -query -data data.txt -sha256 -cert -out req.tsq
curl -H "Content-Type: application/timestamp-query" --data-binary @req.tsq https://freetsa.org/tsr -o resp.tsr
openssl ts -verify -data data.txt -in resp.tsr -CAfile cacert.pem -untrusted tsa.crt
```

On this host `OPENSSL_CONF` points to a missing PostgreSQL file; set it to an empty file for these
commands. The verifier therefore needs the TSA certificates in its trust policy, which the evidence
envelope's timestamp source records.

## 4. Do `workflow_run` and the merge queue behave as the verifier topology assumes?

**Partly answered, with a design gap.** GitHub's documentation (source file
`data/reusables/gated-features/merge-queue.md` in `github/docs`) says:

> Pull request merge queues are available in any public repository owned by an organization, or in
> private repositories owned by organizations using GitHub Enterprise Cloud.

`smota/agentflow-sdlc` is owned by a personal account, so it cannot use a merge queue, which the M2b
merge path assumes. The managing-a-merge-queue page confirms that a required check must also run on
the `merge_group` event, which matches verifier job A. The author decided on 2026-11-25 not to move the repository now and to revisit it before M2b; until then the M2b merger serializes merges itself (see the design's "Merge queue availability"). The `workflow_run` checks run with M2-2, on this repository.
