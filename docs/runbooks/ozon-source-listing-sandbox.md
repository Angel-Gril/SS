# Ozon Source Listing Sandbox Probe

This runbook executes a real create/update request against a **dedicated Ozon test shop**. It is an opt-in acceptance probe, not a normal test and not a production recovery tool. The script sends at most one item and one `/v3/product/import` request per process.

## Preconditions

1. Use credentials belonging only to a dedicated test shop. Never use a production shop, even temporarily.
2. Compile and review one immutable V2 listing payload with exactly this shape: `{ "items": [<one complete compiled item>] }`.
3. Give the item a new lowercase offer ID beginning with `ss-erp-sbx-`, for example `ss-erp-sbx-20260715-a1b2c3`. Never reuse an offer ID from an earlier probe.
4. Confirm all images are intentionally public test assets and that the item contains no real customer, supplier, credential, or personal data.
5. Choose a new audit path. Existing audit evidence is never overwritten intentionally.

The script performs a pre-submit offer lookup and fails closed if the reserved offer already exists. It accepts exactly one item to limit blast radius.

## Credential Setup

Credentials are read only from dedicated environment variables. They must not be written to the payload, audit file, shell history, or issue tracker. Prefer a temporary secret-injection mechanism provided by the operator environment.

Bash example using values already injected into the shell environment:

```bash
export OZON_SANDBOX_TEST_SHOP=true
export OZON_SANDBOX_CONFIRM=CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING
node scripts/sandbox/ozon-source-listing-contract.mjs \
  --execute \
  --payload tmp/sandbox/compiled-ozon-item.json
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
  --payload tmp/sandbox/compiled-ozon-item.json \
  --audit tmp/sandbox-audits/ozon-source-listing-20260715-a1b2c3.json
```

Optional polling controls are `--poll-interval-ms` (1-60 seconds) and `--poll-timeout-ms` (10 seconds-30 minutes). Read polling may retry. The `/v3/product/import` write never retries.

The script:

1. Validates both explicit opt-ins, the test-shop marker, dedicated credential variables, payload bounds, and reserved offer prefix.
2. Verifies the offer does not already exist in the test shop.
3. Calls `/v3/product/import` exactly once.
4. Polls `/v1/product/import/info` only when a durable task ID is returned.
5. Records bounded item results and errors in a redacted audit JSON file.
6. Uses known `product_id` values or `/v3/product/info/list` offer lookup, then attempts `/v1/product/archive` cleanup.

Archival is best effort. A failed cleanup must be completed manually in the test shop and recorded beside the audit artifact.

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
