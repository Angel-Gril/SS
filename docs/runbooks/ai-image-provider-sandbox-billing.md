# QA-02 AI Image Sandbox Billing Finalization

Use this offline finalizer only after one paid international image sandbox request has a compatible
immutable evidence generation. A new exact-money request uses a `schemaVersion: 3` intent and
`schemaVersion: 5` submit report. Legacy cents evidence uses intent v2/report v4, and historical
report v3 remains readable. The finalizer records settled Provider billing as a new sibling
artifact; it never edits the original report. Exact reports retain `actualCost: null`, while legacy
reports retain `actualCostCents: null`.

Billing finalization does not change the Provider outcome, authorize a retry, enable a capability,
activate a feature flag, write a database, or contact the Provider. A
`RECONCILIATION_REQUIRED` submit remains technically unresolved even after its bill is settled.

## Eligible Evidence

The finalizer derives these paths from the validated Operation ID and the private evidence root:

```text
<root>/intents/<operation-id>.intent.json
<root>/intents/.fingerprints/<request-fingerprint>.claim.json
<root>/<operation-id>.report.json
```

It does not trust `intentPath`, `imagePath`, or other absolute paths stored in a report. Historical
timestamp-less v2 reports, `PRE_DISPATCH_FAILED`, a report whose generation-specific actual-cost
field was modified, and any mismatched intent/report/claim are ineligible. Exact intent v3 and
report v5 require an exact billing attestation (v2 or v3); legacy generations cannot be mixed with
them even when the numeric amount is equivalent. For v4/v5 reports the finalizer validates the explicit
`operationEndpointSha256` against the immutable intent while retaining `apiBaseSha256` as the exact
Registry-promotion digest. Exact v3 intents independently bind that same API Base digest.
Historical v3 report `endpointSha256` is read only as an operation-endpoint digest and is never
reinterpreted as an API Base. The finalizer recomputes the transport-semantic request fingerprint
rather than trusting matching values copied among the artifacts.

The evidence root may be the deployment-managed top-level link to the private shared sandbox
directory. The finalizer resolves that link once, requires its target to be a private directory, and
rejects any intent/report/claim whose real path escapes the resolved target.

The original approval may be expired by the time billing settles. The finalizer binds its immutable
approval ID/digest and hashed account/billing references but does not require the old approval to be
current.

## Private Billing Attestation

Create one private canonical JSON file outside the repository or under an access-controlled private
evidence directory. Also retain distinct before/settled Provider billing exports or screenshots as
private, non-symlink files no larger than 16 MiB. Attestation v3 additionally retains one distinct
canonical snapshot of the authenticated read-only Relay Token log. On Linux every file must be a
regular `0600` file.
Save the attestation as pretty two-space JSON with one trailing newline; missing/extra fields,
duplicate keys, invalid UTF-8, unsafe modes, file changes, and digest mismatches fail closed.

```json
{
  "schemaVersion": 3,
  "settlementId": "qa02-full-edit-20260729-billing-01",
  "statement": "I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT",
  "operationId": "qa02-full-edit-20260729-01",
  "preCallObservedAt": "2026-07-29T01:00:00.000Z",
  "settledObservedAt": "2026-07-29T01:10:00.000Z",
  "reconcilerRef": "billing-review-20260729-01",
  "providerAccountRef": "relay-account-main",
  "pricingRevision": "qa02-price-policy-20260730-v1",
  "preCallBillingSnapshotRef": "private-ledger/qa02-full-edit-before",
  "billingReconciliationRef": "private-ledger/qa02-full-edit-after",
  "preCallBillingSnapshotPath": "/secure/ai-image-sandbox/private/qa02-full-edit-before.json",
  "settledBillingSnapshotPath": "/secure/ai-image-sandbox/private/qa02-full-edit-after.json",
  "preCallBillingSnapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "settledBillingSnapshotSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "providerBillingEntryRef": "private-ledger/qa02-full-edit-entry",
  "intentSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "submitReportSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "fingerprintClaimSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "requestFingerprint": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "approvalId": "qa02-full-edit-20260729-01",
  "approvalSha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "correlationMethod": "PROVIDER_TOKEN_LOG_ENTRY",
  "providerRequestId": "private-relay-billing-log-request-id",
  "billingOutcome": "CHARGED",
  "actualCost": {
    "currency": "CNY",
    "amount": 119,
    "scale": 4
  },
  "meterEvidence": {
    "schemaVersion": 1,
    "kind": "NEW_API_QUOTA_AND_TOTAL_USAGE_V1",
    "rawQuotaDelta": 5950,
    "quotaUnitsPerCurrencyUnit": 500000,
    "displayTotalUsageDelta": {
      "amount": 119,
      "scale": 2
    },
    "displayTotalUsageUnitCurrencyScale": 2
  },
  "providerTokenLogSnapshotPath": "/secure/ai-image-sandbox/private/qa02-full-edit-provider-token-log.json",
  "providerTokenLogSnapshotSha256": "2222222222222222222222222222222222222222222222222222222222222222",
  "providerTokenLogUserId": 123,
  "providerTokenLogTokenId": 456
}
```

The referenced v3 Token-log snapshot has this closed wrapper. `bodyBase64` is the exact raw JSON
response body from the authenticated read-only request, not a reconstructed subset:

```json
{
  "schemaVersion": 1,
  "kind": "AI_IMAGE_SANDBOX_PROVIDER_LOG_SNAPSHOT",
  "operationId": "qa02-full-edit-20260729-01",
  "observedAt": "2026-07-29T01:11:00.000Z",
  "request": {
    "name": "providerTokenLog",
    "method": "GET",
    "uri": "https://relay.example/api/log/token",
    "httpStatus": 200,
    "contentType": "application/json; charset=utf-8",
    "bodySha256": "3333333333333333333333333333333333333333333333333333333333333333",
    "bodyBase64": "eyJkYXRhIjpbXX0="
  }
}
```

Rules:

- Exact attestations v2/v3 use one closed `actualCost` object. `CHARGED` requires a positive
  amount; `NO_CHARGE` requires zero. Currency and scale must match the approved exact-money chain.
- `meterEvidence` must independently prove the same exact cost through both integer raw-quota
  change and displayed total-usage change. For the example above, `5950 / 500000 = CNY 0.0119`,
  while displayed usage changed by `1.19` units whose currency scale is `2`. A mismatch in either
  meter fails closed.
- For an exact `NO_CHARGE` settlement, `actualCost.amount`, `rawQuotaDelta`, and
  `displayTotalUsageDelta.amount` must all be zero. The zero display delta must use its canonical
  minimum decimal form, exactly `{ "amount": 0, "scale": 0 }`; zero with a positive decimal scale
  is rejected before any settlement claim is written. `actualCost` may retain the approved money
  scale so the receipt remains generation-compatible with the quote and maximum.
- Historical attestation v1 with `currency` and `actualCostCents` remains readable only with the
  matching legacy intent/report generation. Do not convert or mix generations in place.
- `PROVIDER_REQUEST_ID` requires the raw private request ID, whose SHA-256 must match the submit
  report. It is valid only in attestation v2; the raw ID remains only in the private attestation.
- `PROVIDER_TOKEN_LOG_ENTRY` is valid only in attestation v3. `providerRequestId` is the private
  Relay billing-log `request_id`, not the upstream response ID. The finalizer separately retains
  the report's upstream request-ID hash, then opens and hashes the reviewed Token-log snapshot,
  verifies its `GET /api/log/token` origin against the intent API Base, and requires exactly one
  matching consume entry. Candidate selection does not start from the attested ID: there must be
  exactly one entry in the retained response matching the model, generation/edit path, raw quota
  delta, report time window, and Provider duration, and only then may its ID be compared. If the
  log exposes `upstream_request_id`, its SHA-256 must match the submit report. Otherwise the receipt
  explicitly records `UNAVAILABLE_UNIQUE_ENTRY`; the independent upstream hash remains present and
  is not reinterpreted as the Relay ID.
- `providerTokenLogUserId` and `providerTokenLogTokenId` are private reviewed identifiers from the
  same Token-log entry. They must match that entry. The sanitized receipt stores only their combined
  hash. Together with the approval-bound account reference and API Base, they prevent a log from a
  different Relay account or API Token from being silently substituted.
- `UNIQUE_ACCOUNT_TIME_WINDOW` requires `providerRequestId: null`, a submit report with no request
  ID hash, and a pre-call-to-settled observation window no longer than 15 minutes. Use it only when
  the account/time window uniquely identifies this request; concurrent Provider activity makes it
  invalid evidence.
- `preCallObservedAt` must be no later than submit `startedAt`; `settledObservedAt` must be no
  earlier than submit `completedAt` and no more than five minutes in the future. The pre-call
  observation must be at or before approval, no more than 15 minutes old when approved, and the
  submit must have started no more than 15 minutes after that observation and inside the stored
  approval window (allowing only the existing five-minute future-clock skew at its lower boundary).
- Both snapshot paths are opened with bounded, private, no-symlink semantics and their actual bytes
  must match the two attested SHA-256 values. The before and settled paths must be distinct files,
  not aliases or hard links to the same file. Filesystems that cannot provide a stable canonical
  path plus device/inode identity are rejected.
- The v3 Token-log snapshot is subject to the same private-file and distinct-inode checks. Its
  closed wrapper stores the exact authenticated GET URI/status/content type plus raw response bytes
  as canonical base64 and a SHA-256. The decoded response must be successful JSON with no more than
  1,000 entries. Do not put the API Key, Authorization header, cookie, or login session in it.
- The wrapper and attestation are not Provider signatures. Their source authenticity is asserted by
  the named trusted `reconcilerRef`; the offline finalizer proves reviewed-byte integrity and
  cross-artifact consistency after capture. The reconciler must perform the authenticated GET in a
  controlled process, retain the exact raw bytes, review the matching account/Token entry, and keep
  the Key outside every artifact. Without that trusted capture, v3 is not valid evidence.
- A v3 finalization atomically claims the billing entry across the entire evidence root using the
  API Base, Token-log user/Token IDs, and billing request-ID hash. The approval-bound account label
  is retained inside the claim for audit/conflict checks but cannot partition the global key, so
  renaming that label cannot authorize reuse. Reusing the same entry for another Operation, report,
  snapshot, or attestation digest fails closed before an operation settlement is written. If a
  process stops after only this global claim is durable, recovery must use the byte-identical
  attestation; changing the settlement decision or metadata cannot adopt the isolated claim.
- Account, pricing, currency, and before/after billing references must hash to the approval evidence.
- The intent, report, fingerprint claim, request fingerprint, approval ID/digest, endpoint/model,
  operation/profile, Prompt/source/mask hashes, revisions, and quoted/maximum costs must all agree.

## Run Offline

Unset Provider secrets and paid confirmation first. The finalizer rejects
`AI_IMAGE_SANDBOX_API_KEY`, `AI_IMAGE_SANDBOX_CONFIRM`, `AUTHORIZATION`, `OPENAI_API_KEY`, and
`DASHSCOPE_API_KEY`, including the sibling `AI_IMAGE_TRANSLATION_SANDBOX_API_KEY`.

```bash
export NODE_ENV=sandbox
export AI_IMAGE_SANDBOX_OPERATION_ID=qa02-full-edit-20260729-01
export AI_IMAGE_SANDBOX_ADAPTER_REVISION="$(cat DEPLOYED_COMMIT)"
export AI_IMAGE_SANDBOX_EVIDENCE_ROOT=/secure/ai-image-sandbox
export AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH=/secure/ai-image-sandbox/private/qa02-full-edit.billing.json
export AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_SHA256="$(sha256sum "$AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH" | awk '{print $1}')"
pnpm --filter server sandbox:ai-image:billing:finalize
```

The official command requires a Git checkout, verifies the clean revision twice, and proves that its
CLI, settlement, revision, and request-fingerprint modules are tracked and byte-identical to that
revision. It rejects a marker-only release archive because that archive cannot reconstruct Git blob
membership at runtime. On a VPS, use a private clean checkout of the deployed revision and point
`AI_IMAGE_SANDBOX_EVIDENCE_ROOT` to the private shared evidence target. The command performs zero
DNS/fetch/Provider operations and writes:

```text
<root>/billing/.claims/<operation-id>.billing.claim.json
<root>/billing/<operation-id>.billing.settlement.json
```

Both artifacts are append-only and private. An exact replay returns the existing settlement even
after a compatible finalizer revision upgrade; the receipt retains the revision that first won the
immutable claim. A different attestation, amount, or evidence digest for the same Operation ID
returns a conflict. If a process stopped after writing only the claim, recovery under a different
finalizer revision fails closed; that revision can only byte-verify a complete existing receipt and
never enters the receipt write path. Rerun the original reviewed revision rather than attributing the
receipt to the wrong code. Output parents must be real private directories beneath the resolved
evidence root; linked parents are rejected before child creation, and Linux writes remain bound to
one held directory descriptor. The final durability sync also uses that held descriptor instead of
reopening the visible directory path.

The sanitized settlement stores only hashes (including the model digest), enums, amounts,
timestamps, and non-secret request metadata. An exact v5 submit produces a v3 settlement receipt
for attestation v2 or a v4 receipt for Token-log attestation v3. Both retain exact `actualCost`,
`quotedCost`, and `maximumCost` objects plus explicit `apiBaseSha256` and
`operationEndpointSha256`. The v4 receipt also retains separate upstream-response and Relay
billing-entry request-ID hashes, their bridge status, a globally claimed billing-entry key, a
hashed Relay user/Token identity, and the Token-log snapshot digest. A legacy v4 submit produces a
v2 receipt, while a historical v3 submit
keeps the byte-stable v1 receipt whose `endpointSha256` means the operation endpoint. Only a
receipt field explicitly named `apiBaseSha256` may be copied into Registry evidence. The settlement
never stores raw meter deltas, raw account/billing references, the raw Provider request ID, API
keys, Authorization, Provider responses, URLs, free-form reasons, or local paths.

## Interpret The Result

- `billingGate: PASS`: the settled cost is within the approved maximum.
- `billingGate: COST_LIMIT_EXCEEDED`: the real bill exceeded the approved maximum. The amount is
  still recorded faithfully and capability promotion remains blocked.
- `submitState: RECONCILIATION_REQUIRED`: billing is closed but the technical outcome is still
  unknown. Never retry the same request.

This settlement closes only the billing-evidence portion of QA-02. Exact operation compatibility,
result quality, privacy review, and rollout approval remain separate gates.
