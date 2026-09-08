# Ozon Source Listing Sandbox Probe

This runbook executes a real create/update request against a **dedicated Ozon test shop**. It is an opt-in acceptance probe, not a normal test and not a production recovery tool. The script sends at most one item and one `/v3/product/import` request per process.

Before requesting write approval, use the read-only preflight. It calls only Seller Info and reserved-offer lookup; it never calls import or archive:

```bash
export OZON_SANDBOX_TEST_SHOP=true
export OZON_SANDBOX_READONLY_CONFIRM=READ_ONLY_SELLER_INFO_AND_OFFER_CHECK
export OZON_SANDBOX_TEST_SHOP_ALIAS=<exact-erp-alias>
export OZON_SANDBOX_EXPECTED_SELLER_NAME=<exact-ozon-company-name>
node scripts/sandbox/ozon-source-listing-contract.mjs \
  --preflight \
  --offer-id ss-erp-sbx-<new-unique-suffix> \
  --audit tmp/sandbox-audits/ozon-source-listing-readonly-<suffix>.json
```

Only `READY_FOR_SEPARATE_WRITE_APPROVAL` is eligible for a later, separately approved write. Record the emitted preflight receipt SHA-256 in a separate approval manifest. `OFFER_NOT_AVAILABLE` or `PREFLIGHT_FAILED` blocks the write.

## Preconditions

1. Use credentials belonging only to a dedicated test shop. Never use a production shop, even temporarily.
2. Export and review one immutable production compiler envelope from `ozon-listing-production-compile-adapter/v1`. A hand-written `{ "items": [...] }` payload is rejected even when its fields look complete.
3. Give the item a new lowercase offer ID beginning with `ss-erp-sbx-`, for example `ss-erp-sbx-20260715-a1b2c3`. Never reuse an offer ID from an earlier probe.
4. Confirm all images are intentionally public test assets and that the item contains no real customer, supplier, credential, or personal data.
5. Choose a new audit path. Existing audit evidence is never overwritten intentionally.
6. Obtain an immutable approval manifest for exactly `IMPORT` and `ARCHIVE`, binding the ERP/Ozon shop identity, Seller name, credential revision fingerprint, preflight receipt SHA-256, payload SHA-256, reserved offer ID, approval ID, operator, device, and expiry.

The script performs a pre-submit offer lookup and fails closed if the reserved offer already exists. It accepts exactly one item to limit blast radius.

## Prepare The Independent Approval

First complete the normal ERP draft and production compiler export with the operator's real test-product
facts: category, required attributes, public test images, package weight and dimensions with units,
price, currency, and VAT. A synthetic image does not establish those product facts. Capture/workflow
pilot configuration and the eventual Ozon import/archive require their separately bound approvals.

Use this field layout only as a review template. Placeholders deliberately fail the execution gate;
save the completed approval outside the repository only after operator review:

```json
{
  "schema": "ss-erp/ozon-source-listing-approval/v1",
  "approvalId": "<unique-reviewed-approval-id>",
  "operatorId": "<responsible-operator>",
  "deviceId": "<approved-device>",
  "approvedAt": "<review-time-in-UTC>",
  "expiresAt": "<expiry-in-UTC>",
  "shopAlias": "<exact-ERP-test-shop-alias>",
  "sellerName": "<confirmed-Ozon-seller-name>",
  "clientIdSha256": "<preflight-credential.clientIdSha256>",
  "credentialRevisionSha256": "<preflight-credential.revisionSha256>",
  "offerId": "<same-new-reserved-offer-as-the-compiler-export>",
  "preflightReceiptSha256": "<SHA-256-of-the-exact-v2-preflight-file-bytes>",
  "payloadSha256": "<SHA-256-of-the-exact-compiler-envelope-file-bytes>",
  "operations": ["IMPORT", "ARCHIVE"]
}
```

Copy credential fingerprints from the approved preflight receipt; do not expose or recompute them by
pasting keys into shell commands. `payloadSha256` hashes the entire envelope file, including its
serialization, and differs from the envelope's `requestPayloadHash`. The approval window must be
positive, unexpired, and no longer than 24 hours; the v2 preflight must also be fresh. Compute
`--approval-sha256` only after the final review. Changes to any bound input require new evidence and
approval. The executable field and validation owner is `readApprovalManifest` in
`scripts/sandbox/ozon-source-listing-contract.mjs`.

## Credential Setup

Credentials are read only from dedicated environment variables. They must not be written to the payload, audit file, shell history, or issue tracker. Prefer a temporary secret-injection mechanism provided by the operator environment.

Bash example using values already injected into the shell environment:

```bash
export OZON_SANDBOX_TEST_SHOP=true
export OZON_SANDBOX_CONFIRM=CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING
export OZON_SANDBOX_TEST_SHOP_ALIAS=<exact-erp-alias>
export OZON_SANDBOX_EXPECTED_SELLER_NAME=<exact-ozon-company-name>
node scripts/sandbox/ozon-source-listing-contract.mjs \
  --execute \
  --payload tmp/sandbox/compiled-ozon-envelope.json \
  --preflight-receipt /operator-private/ozon-readonly-preflight.json \
  --preflight-sha256 <approved-receipt-sha256> \
  --approval-manifest /operator-private/ozon-write-approval.json \
  --approval-sha256 <approved-approval-sha256>
```

The secret injector must provide these two variables without echoing their values:

```text
OZON_SANDBOX_TEST_CLIENT_ID
OZON_SANDBOX_TEST_API_KEY
```

PowerShell uses the same variables and command arguments. Do not paste the API key into a command that will be retained in shell history.

## Execution

Run from the repository root:

```bash
node scripts/sandbox/ozon-source-listing-contract.mjs \
  --execute \
  --payload tmp/sandbox/compiled-ozon-envelope.json \
  --preflight-receipt /operator-private/ozon-readonly-preflight.json \
  --preflight-sha256 <approved-receipt-sha256> \
  --approval-manifest /operator-private/ozon-write-approval.json \
  --approval-sha256 <approved-approval-sha256> \
  --audit tmp/sandbox-audits/ozon-source-listing-20260715-a1b2c3.json
```

Optional polling controls are `--poll-interval-ms` (1-60 seconds) and `--poll-timeout-ms` (10 seconds-30 minutes). Read polling may retry. The `/v3/product/import` write never retries.

The script:

1. Validates both explicit opt-ins, the exact shop alias/Seller identity, dedicated credential variables, and the approved preflight receipt SHA-256.
2. Recomputes the production compiler envelope and authority hashes, then requires one complete item and a reserved offer ID no longer than 50 characters.
3. Re-reads Seller Info and verifies the offer does not already exist in the same credential-bound test shop.
4. Calls `/v3/product/import` exactly once.
5. Polls `/v1/product/import/info` only when a durable task ID is returned.
6. Records bounded item results and errors in a redacted audit JSON file.
7. Uses known `product_id` values or `/v3/product/info/list` offer lookup, then attempts `/v1/product/archive` cleanup.

Archive acceptance is followed by a product-info lookup. Only `ARCHIVE_VERIFIED` is a completed cleanup; `ARCHIVE_ACCEPTED`, `CLEANUP_PENDING`, or a failed cleanup must be completed manually in the test shop and recorded beside the audit artifact.

For an `UNKNOWN`, `CLEANUP_PENDING`, or `CLEANUP_FAILED` audit, use read-only reconciliation. It reuses only the audited reserved offer ID and current credential fingerprints; it never calls import or archive:

```bash
export OZON_SANDBOX_READONLY_CONFIRM=READ_ONLY_SELLER_INFO_AND_OFFER_CHECK
node scripts/sandbox/ozon-source-listing-contract.mjs \
  --reconcile \
  --audit tmp/sandbox-audits/ozon-source-listing-20260715-a1b2c3.json
```

## UNKNOWN Outcomes

Transport failure after request dispatch, HTTP 5xx without a durable task ID, a malformed acknowledgement, or polling timeout produces `UNKNOWN`. When an audit reports `UNKNOWN`, **never run the payload again** and never change the offer ID to bypass the guard.

Use only read operations to reconcile the recorded task ID and reserved offer ID. If Ozon later exposes the product, archive it. A new submission is allowed only after an operator records trustworthy evidence that the original request was not accepted; use a new immutable attempt and a new reserved offer ID.

## Audit And Exit Codes

The default audit directory is `tmp/sandbox-audits/`. Audit files include payload hash, reserved offer ID, endpoint names, task ID when acknowledged, bounded poll results, final state, and cleanup result. Credentials and authorization headers are neither printed nor intentionally persisted; sensitive response keys are redacted.

| Exit code | Meaning |
|---|---|
| `0` | Import completed successfully and no cleanup error was observed |
| `2` | Rejected, failed, partial failure, precheck failure, or cleanup failure |
| `3` | Submission or reconciliation outcome is `UNKNOWN`; automatic resubmission is forbidden |
| `64` | Safety gate, argument, payload, or usage contract rejected execution |

Review the audit JSON before deleting any local test artifact. Retain it beside the corresponding publish attempt and do not delete it ad hoc; apply the approved audit-retention policy once that policy is established.

## Offline Contract Test

The contract test makes no network request:

```bash
node --test scripts/ozon-source-listing-sandbox-contract.test.mjs
node --check scripts/sandbox/ozon-source-listing-contract.mjs
```
