# QA-02 AI Image Sandbox Billing Finalization

Use this offline finalizer only after one paid international image sandbox request has a current
`schemaVersion: 2` immutable intent, fingerprint claim, and `schemaVersion: 4` submit report. It
also retains read compatibility with historical `schemaVersion: 3` reports. It records settled
Provider billing as a new sibling artifact; it never edits the original report, whose
`actualCostCents` intentionally remains `null`.

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
timestamp-less v2 reports, `PRE_DISPATCH_FAILED`, a report whose `actualCostCents` was modified, and
any mismatched intent/report/claim are ineligible. For v4 reports it validates the explicit
`operationEndpointSha256` against the immutable intent while retaining `apiBaseSha256` as the exact
Registry-promotion digest. Historical v3 `endpointSha256` is read only as an operation-endpoint
digest and is never reinterpreted as an API Base. The finalizer recomputes the transport-semantic
request fingerprint rather than trusting matching values copied among the artifacts.

The evidence root may be the deployment-managed top-level link to the private shared sandbox
directory. The finalizer resolves that link once, requires its target to be a private directory, and
rejects any intent/report/claim whose real path escapes the resolved target.

The original approval may be expired by the time billing settles. The finalizer binds its immutable
approval ID/digest and hashed account/billing references but does not require the old approval to be
current.

## Private Billing Attestation

Create one private canonical JSON file outside the repository or under an access-controlled private
evidence directory. Also retain distinct before/settled Provider billing exports or screenshots as
private, non-symlink files no larger than 16 MiB. On Linux every file must be a regular `0600` file.
Save the attestation as pretty two-space JSON with one trailing newline; missing/extra fields,
duplicate keys, invalid UTF-8, unsafe modes, file changes, and digest mismatches fail closed.

```json
{
  "schemaVersion": 1,
  "settlementId": "qa02-full-edit-20260729-billing-01",
  "statement": "I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT",
  "operationId": "qa02-full-edit-20260729-01",
  "preCallObservedAt": "2026-07-29T01:00:00.000Z",
  "settledObservedAt": "2026-07-29T01:10:00.000Z",
  "reconcilerRef": "billing-review-20260729-01",
  "providerAccountRef": "relay-account-main",
  "pricingRevision": "provider-pricing-20260729",
  "currency": "USD",
  "preCallBillingSnapshotRef": "private-ledger/qa02-full-edit-before",
  "billingReconciliationRef": "private-ledger/qa02-full-edit-after",
  "preCallBillingSnapshotPath": "/secure/qa02-full-edit-before.png",
  "settledBillingSnapshotPath": "/secure/qa02-full-edit-after.png",
  "preCallBillingSnapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "settledBillingSnapshotSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "providerBillingEntryRef": "private-ledger/qa02-full-edit-entry",
  "intentSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "submitReportSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "fingerprintClaimSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "requestFingerprint": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "approvalId": "qa02-full-edit-20260729-01",
  "approvalSha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "correlationMethod": "PROVIDER_REQUEST_ID",
  "providerRequestId": "private-provider-request-id",
  "billingOutcome": "CHARGED",
  "actualCostCents": 10
}
```

Rules:

- `CHARGED` requires a positive integer `actualCostCents`; `NO_CHARGE` requires `0`.
- `PROVIDER_REQUEST_ID` requires the raw private request ID, whose SHA-256 must match the submit
  report. The raw ID remains only in this private attestation.
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
export AI_IMAGE_SANDBOX_EVIDENCE_ROOT=tmp/ai-image-sandbox
export AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH=/secure/qa02-full-edit.billing.json
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
timestamps, and non-secret request metadata. A v4 submit produces a v2 settlement receipt with
explicit `apiBaseSha256` and `operationEndpointSha256`; a historical v3 submit keeps the byte-stable
v1 receipt whose `endpointSha256` means the operation endpoint. Only the v2 receipt's
`apiBaseSha256` may be copied into Registry evidence. The settlement never stores raw
account/billing references, the raw Provider request ID, API keys, Authorization, Provider
responses, URLs, free-form reasons, or local paths.

## Interpret The Result

- `billingGate: PASS`: the settled cost is within the approved maximum.
- `billingGate: COST_LIMIT_EXCEEDED`: the real bill exceeded the approved maximum. The amount is
  still recorded faithfully and capability promotion remains blocked.
- `submitState: RECONCILIATION_REQUIRED`: billing is closed but the technical outcome is still
  unknown. Never retry the same request.

This settlement closes only the billing-evidence portion of QA-02. Exact operation compatibility,
result quality, privacy review, and rollout approval remain separate gates.
