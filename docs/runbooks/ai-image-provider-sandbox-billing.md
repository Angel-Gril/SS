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
report v5 require a compatible exact billing attestation; legacy generations cannot be mixed with
them even when the numeric amount is equivalent. For v4/v5 reports the finalizer validates the explicit
`operationEndpointSha256` against the immutable intent while retaining `apiBaseSha256` as the exact
Registry-promotion digest. Exact v3 intents independently bind that same API Base digest.
Historical v3 report `endpointSha256` is read only as an operation-endpoint digest and is never
reinterpreted as an API Base. The finalizer recomputes the transport-semantic request fingerprint
rather than trusting matching values copied among the artifacts.

For Xiaoyi, the finalizer derives the multipart dialect from the versioned request profile. V1
recomputes the historical five-field/default-dialect fingerprint; minimal V2 recomputes the distinct
three-field dialect that omits `n` and `size` from the wire body while retaining them as logical
request constraints. An intent, claim, report, or attestation that mixes either profile with the
other dialect/fingerprint is ineligible even when endpoint, model, Prompt, source, and money match.

For Wanx 2.1 editing, the finalizer accepts only the reviewed legacy API Base
`https://dashscope.aliyuncs.com/api/v1`, model `wanx2.1-imageedit`, the async image-synthesis
endpoint, and submit provider `dashscope-wanx21-image-edit`. It requires one of these exact
operation/profile pairs:

| Operation        | Request profile                                      | Provider function             |
| ---------------- | ---------------------------------------------------- | ----------------------------- |
| `IMAGE_TO_IMAGE` | `DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1`           | `description_edit`            |
| `FULL_EDIT`      | `DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1`                | `description_edit`            |
| `INPAINT`        | `DASHSCOPE_WANX21_INPAINT_ASYNC_V1`                  | `description_edit_with_mask`  |

The recomputed fingerprint binds transport
`DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1`, the operation-specific Provider function, profile,
logical `1024x1024`, `n=1`, Prompt digest, source digest, and mask digest when applicable. It is not
a multipart fingerprint. Sharing `description_edit` does not allow an `IMAGE_TO_IMAGE` approval,
claim, or report to settle a `FULL_EDIT` operation; all three operations retain separate approval
and evidence chains.

Wanx asynchronous technical evidence is retained beside the normal artifacts. The private
`<operation-id>.wanx.provider-task.json` stores the accepted raw task ID, and
`<operation-id>.wanx.result-url.json` stores the temporary raw result URL for recovery. The
guard and Provider adapter use the same idempotent task-file writer. The guard reads at most the
same `32 MiB` JSON budget as the adapter and never waits for cancellation of a cloned response
branch, preventing an accepted task from stalling before its recovery identity is persisted. The
sanitized `<operation-id>.wanx.async-evidence.json` stores task and response-ID hashes, transport,
function, status, request counts, and `usage.imageCount`, but no raw task ID, result URL, or Key.
These sidecars prove technical submission/poll/download facts and support read-only recovery; the
billing finalizer does not consume these sidecars and cannot treat them as proof of price or charge.
It independently validates the immutable intent, fingerprint claim, report, and billing
attestation. An accepted task followed by poll, validation, or download uncertainty remains
`RECONCILIATION_REQUIRED` and must not be resubmitted.

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

### Sub2 API-key cumulative-zero attestation

Attestation v4 is a narrow `NO_CHARGE` contract for the reviewed PicPi Sub2 deployment. It exists
because Sub2 does not expose the Relay raw-quota meter used by v2/v3, while a definite HTTP 4xx may
carry a response request-ID header whose raw value is intentionally not retained. V4 machine-checks
the exact authenticated `GET /v1/usage` response instead of relabeling request counts as quota.

```json
{
  "schemaVersion": 4,
  "settlementId": "qa02-picpi-i2i-20260801-de951b7-01-billing-01",
  "statement": "I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT",
  "operationId": "qa02-picpi-i2i-20260801-de951b7-01",
  "preCallObservedAt": "2026-08-01T08:43:29.325Z",
  "settledObservedAt": "2026-08-01T09:04:23.000Z",
  "reconcilerRef": "operator-picpi-sub2-20260801",
  "providerAccountRef": "picpi-sub2-project",
  "pricingRevision": "operator-cap-usd1-20260801-r1",
  "preCallBillingSnapshotRef": "picpi-sub2-dashboard-before-qa02-picpi-i2i-20260801-de951b7-01",
  "billingReconciliationRef": "picpi-sub2-dashboard-after-qa02-picpi-i2i-20260801-de951b7-01",
  "settledBillingSnapshotPath": "C:\\private\\qa02-picpi.after-usage.json",
  "settledBillingSnapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "providerBillingEntryRef": "picpi-sub2-api-key-cumulative-zero",
  "intentSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "submitReportSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "fingerprintClaimSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "requestFingerprint": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "approvalId": "approval-qa02-picpi-i2i-20260801-de951b7-01",
  "approvalSha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "correlationMethod": "API_KEY_CUMULATIVE_ZERO_USAGE",
  "providerRequestId": null,
  "billingOutcome": "NO_CHARGE",
  "actualCost": {
    "currency": "USD",
    "amount": 0,
    "scale": 0
  },
  "cumulativeUsageEvidence": {
    "schemaVersion": 1,
    "kind": "SUB2_API_KEY_CUMULATIVE_ZERO_USAGE_V1",
    "totalRequests": 0,
    "totalActualCost": {
      "amount": 0,
      "scale": 0
    }
  }
}
```

V4 deliberately has no `preCallBillingSnapshotPath` or pre-call snapshot digest. The approval-bound
pre-call reference and observation time remain part of the chronology, but lifetime cumulative zero
is sufficient without reconstructing or copying a missing before file. The settled file is the exact
nonempty response body retained from authenticated `GET /v1/usage`; it may use the Provider's compact
JSON representation and must not contain the Key or request headers.

Rules:

- Exact attestations v2/v3/v4 use one closed `actualCost` object. `CHARGED` requires a positive
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
- For Wanx, the submit report's `providerRequestIdHash` is the SHA-256 of the accepted Provider
  `task_id`; therefore a `PROVIDER_REQUEST_ID` attestation must supply that exact private task ID.
  DashScope response `request_id` values have separate hashes in the async evidence and are not
  interchangeable with the task ID. If the settled Provider bill cannot be correlated to the task
  ID or a valid unique account/time window, do not invent a correlation or finalize the operation.
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
- `API_KEY_CUMULATIVE_ZERO_USAGE` is valid only in attestation v4. It requires the exact PicPi
  `https://api.picpi.top/v1` API Base, `/images/edits`, `gpt-image-2`, `IMAGE_TO_IMAGE`, profile
  `OPENAI_SQUARE_SINGLE_V1`, report v5, one create request, a definite `REJECTED` state, a retained
  response request-ID hash, `usage: null`, and a settlement observation window no longer than 30
  minutes. The longer v4 window does not affect the 15-minute before/after delta rule: lifetime
  cumulative zero, not an unbounded account-window guess, is the correlation evidence.
  `providerRequestId` remains null. It cannot settle `SUCCEEDED`, `RECONCILIATION_REQUIRED`, Wanx,
  legacy evidence, a charge, another route/model/operation, or another Sub2 deployment.
- The v4 settled body must say `isValid: true`, use the approved currency in `unit`, and contain
  zero `requests` and `actual_cost` in both `usage.today` and `usage.total`. The finalizer parses and
  compares the lifetime values with the closed cumulative evidence object. Sub2 upstream commit
  `b22f73e725236790f97d89bf0c3b908a48e591d5` defines `/v1/usage` as current-API-key statistics;
  `total.requests` is the lifetime `COUNT(*)` of that Key's usage logs and `total.actual_cost` is the
  lifetime sum. A logged failed request contributes to the count, so zero proves this Key has no
  recorded request or actual cost. Subscription-level usage fields are unrelated and are not used.
- `preCallObservedAt` must be no later than submit `startedAt`; `settledObservedAt` must be no
  earlier than submit `completedAt` and no more than five minutes in the future. The pre-call
  observation must be at or before approval, no more than 15 minutes old when approved, and the
  submit must have started no more than 15 minutes after that observation and inside the stored
  approval window (allowing only the existing five-minute future-clock skew at its lower boundary).
- For v1-v3, both snapshot paths are opened with bounded, private, no-symlink semantics and their
  actual bytes must match the two attested SHA-256 values. The before and settled paths must be
  distinct files, not aliases or hard links to the same file. Filesystems that cannot provide a
  stable canonical path plus device/inode identity are rejected.
- V4 opens only the settled cumulative snapshot with the same bounded, private, no-symlink and
  stable-identity checks. Do not copy the settled response and mislabel it as a pre-call snapshot.
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

Alibaba's public reference reviewed on 2026-08-01 lists `CNY 0.14` per image; it is planning input
only. No live Provider pricing synchronization is required, and the finalizer performs none. Each
Wanx operation still requires a separately approved exact CNY quote and single-request maximum,
followed by private before/settled billing evidence that proves the actual charge.
`usage.imageCount=1` proves one successful output, not its price. If the selected DashScope account
does not expose evidence compatible with the exact meter and correlation rules above, QA-02 remains
open until the attestation contract is explicitly extended and reviewed; the public list price must
not be copied into `actualCost` as a substitute.

## Xiaoyi Console Bill And Account-Credit Review

Attestation v5 is a separate, opt-in evidence contract for a successful Xiaoyi `TEXT_TO_IMAGE`
request. It supports the exact image API/model and the square or portrait single-image profile.
It cannot settle another Provider, an edit, a rejection, or an unresolved technical outcome.
The existing v1-v4 contracts are unchanged.

Use this only when the account owner supplies the request-specific console bill and explicitly
confirms that one displayed USD credit costs one CNY. A dollar symbol or the platform's general
exchange-rate setting does not establish this account-specific recharge rule. Preserve the raw
displayed charge and the CNY cash cost separately. This contract does not support arbitrary exchange
rates, discounts inferred from token counts, or a zero-cost claim from unchanged cumulative meters.

Start from the v3 attestation fields, set `schemaVersion: 5` and
`correlationMethod: PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW`, remove `meterEvidence`, and add the
following object. `actualCost` is the confirmed CNY amount. Keep all original approval, pricing,
account, intent, report, fingerprint, observation and Token-log bindings unchanged:

```json
{
  "schemaVersion": 1,
  "kind": "XIAOYI_ACCOUNT_CREDIT_CONSOLE_V1",
  "displayedCurrency": "USD",
  "displayedCharge": { "amount": 5, "scale": 2 },
  "loggedQuota": 25000,
  "cashUnitsPerDisplayedUnit": { "amount": 1, "scale": 0 },
  "screenshotPath": "/secure/ai-image-sandbox/private/console-bill.png",
  "screenshotSha256": "<reviewed-screenshot-sha256>",
  "userConfirmationPath": "/secure/ai-image-sandbox/private/user-confirmation.json",
  "userConfirmationSha256": "<reviewed-confirmation-sha256>"
}
```

The confirmation is a separate private canonical JSON record:

```json
{
  "schemaVersion": 1,
  "kind": "AI_IMAGE_SANDBOX_USER_BILLING_CONFIRMATION",
  "statement": "I_CONFIRM_THIS_REQUEST_BILL_AND_ACCOUNT_CREDIT_CASH_VALUE",
  "operationId": "<same-operation-id>",
  "confirmedAt": "<actual-post-request-review-time-in-UTC>",
  "reconcilerRef": "<same-trusted-reconciler-reference>",
  "providerAccountRef": "<same-approval-bound-account-reference>",
  "billingRequestIdSha256": "<sha256-of-the-private-relay-request-id>",
  "screenshotSha256": "<same-reviewed-screenshot-sha256>",
  "displayedCurrency": "USD",
  "displayedCharge": { "amount": 5, "scale": 2 },
  "cashCost": { "currency": "CNY", "amount": 5, "scale": 2 },
  "cashUnitsPerDisplayedUnit": { "amount": 1, "scale": 0 }
}
```

All placeholders require an actual review. The screenshot must be bounded PNG/JPEG bytes; it and
the confirmation must reside under the private evidence root and be distinct from each other and
the before/after and Token-log files. The finalizer checks file integrity and request/account/time
bindings; it does not OCR the screenshot, authenticate a bank transfer, or prove the operator's
statement. The named reconciler owns the visual and account-rule review. Never assert that a user
performed a review merely because these files were generated.

The authenticated Token-log entry must still be the unique model/path/quota/time/duration match,
with the same reviewed user and token identifiers. `loggedQuota / 500000` must exactly equal the
displayed charge and, under this specific 1:1 rule, the CNY cost. Before/after snapshots remain
immutable observation evidence; they are not described as proving a cash delta in this mode.
No new Provider call or management-console login is performed by finalization.

V5 produces a schema v6 receipt and uses the existing global billing-entry claim and append-only
operation settlement. It preserves both request-ID hashes, the original quote/maximum and the
unchanged submit report. An old USD approval paired with confirmed CNY cost yields
`billingGate: COST_BASIS_MISMATCH`, even if its numeric limit is higher; this is not `PASS` and never
rewrites the old approval. The receipt separately records whether the displayed number exceeded the
original numeric maximum. A correctly CNY-denominated approval retains normal exact-scale and
maximum-cost checks.

The capability-candidate consumer deliberately does not accept v6 receipts for promotion, including
ones with a cash-budget `PASS`. Recording this reviewed bill alone does not close all QA-02 operations,
change capability policy, authorize another paid request, or satisfy release gates.

## Inspect Native Alibaba Bills Without Finalizing

Keep the normal ERP cost ledger separate from native Provider billing. The hosted pipeline's
`actualCostCents` is calculated from its frozen pricing configuration and recorded by
`ai-cost-ledger.ts` in `AiCostSettlement` for ERP budget accounting. That path does not read an
Alibaba bill or debit a user's balance. Its `SETTLED` state is not proof of an Alibaba cash debit
or final bill. Isolated Wanx trials retain `actualCost:null`; only a separately supported,
reviewed native association and finality contract could close their external billing evidence.

Use `sandbox:ai-image:billing:inspect-alibaba` to inspect a previously captured native Alibaba
`QueryBill` JSON response offline. This is a separate observation contract, not an extension of
attestation v1-v5. It cannot settle a Wanx operation, write a billing claim or receipt, promote a
capability, approve a request, or contact Alibaba. Its output always contains
`state: RECONCILIATION_REQUIRED`, `actualCost: null`, and `canFinalize: false`; it has no
`billingGate` field. Exit code zero means only that the observation was read and validated, not that
a request's billing gate passed.

The [official QueryBill reference](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-querybill)
reviewed on 2026-09-10 defines `RecordID` as an order/bill identifier and `RequestId` as the bill-query
request identifier. Neither is the Wanx `task_id`. `Data.AccountID` is the queried account;
`OwnerID` is a separate resource/delegated-payment owner, not proof of the API Key creator or a RAM
identity. A `PayFinish` row, a single returned row, zero cash payment, or an empty response does not
establish the charge for one image request.

Keep the native monetary meanings separate:

| Native field | Meaning retained by inspection |
| --- | --- |
| `PretaxGrossAmount` | Original amount |
| `InvoiceDiscount` | Discount amount |
| `PretaxAmount` | Amount due, not automatically the cash paid |
| `PaymentAmount` | Cash payment including credit-refund offset |
| `CashAmount` | Cash payment excluding credit-refund offset |
| `AdjustAmount` | Credit-refund offset |
| `DeductedByCashCoupons`, `DeductedByCoupons`, `DeductedByPrepaidCard` | Distinct deduction categories |
| `OutstandingAmount`, `RoundDownDiscount` | Outstanding amount and rounding discount |

Prepare one private canonical JSON observation, with two-space indentation and a trailing newline:

```json
{
  "schemaVersion": 1,
  "kind": "ALIBABA_NATIVE_BILLING_OBSERVATION_V1",
  "observedAt": "2026-09-10T02:00:00.000Z",
  "collectorRef": "reviewed-billing-capture-01",
  "request": {
    "action": "QueryBill",
    "version": "2017-12-14",
    "billingCycle": "2026-09",
    "productCode": "<reviewed-product-code>",
    "productType": null,
    "subscriptionType": "PayAsYouGo",
    "billType": "PayAsYouGoBill",
    "hideZeroCharge": false,
    "pageNumber": 1,
    "pageSize": 20,
    "billOwnerId": null
  },
  "response": {
    "httpStatus": 200,
    "contentType": "application/json; charset=utf-8",
    "bodySha256": "<sha256-of-exact-response-bytes>",
    "bodyBase64": "<base64-of-exact-response-bytes>"
  }
}
```

The request object records the capture scope: `billType` maps to native `Type`, `hideZeroCharge`
to `IsHideZeroCharge`, `pageNumber` to `PageNum`, and the remaining filters to their native
PascalCase names. `null` means the optional ProductType/BillOwnerId filter was omitted, not that a
literal null was sent. Record the real query, not a reconstructed narrower subset. V1 supports
only CNY postpaid `PayAsYouGoBill` rows and an explicit `IsHideZeroCharge=false` query. It does not
accept CSV, console screenshots, telemetry, `QuerySettleBill`, or `DescribeInstanceBill` bodies
under the QueryBill label. These sources have different fields and finality rules.

The raw body is the exact captured response, including normal account and bill fields; retain it
only in a private file with mode `0600` on Linux or equivalent Windows ACLs. Never put keys,
Authorization, Cookie, AccessKey credentials, signed query URLs, or sessions in the wrapper.
`collectorRef` identifies the responsible capture review; it is not an Alibaba signature. Byte
integrity and matching an independently supplied account digest do not authenticate the capture.
No real QueryBill capture or Wanx product-code mapping is established by synthetic tests.

The reader verifies the wrapper/file and response digests, UTF-8/base64, duplicate decoded JSON
keys, closed schemas, response scope, page cardinality, date syntax and calendar validity. A raw
body is capped at 4 MiB, a wrapper at 16 MiB, a page at 300 rows and nesting at 12 containers.
It reads native numeric literals before JavaScript rounding and uses the existing exact-money
contract with BigInt arithmetic; precision beyond that contract is rejected, not rounded.
Missing optional deduction fields remain null rather than becoming zero. Dates remain native
local strings; inspection does not invent their timezone or use them to correlate a task.

Only a first page containing the entire declared result is marked `pagination.complete=true`.
Other valid pages remain explicitly incomplete and are not extrapolated into account totals.
Even a complete empty query remains unresolved. The inspector does not infer billing-period
finality from age, payment status or a fixed delay, nor distribute an aggregate bill among tasks.

Use a clean checkout of the exact inspected revision and an existing private evidence directory:

```bash
export NODE_ENV=sandbox
export AI_IMAGE_SANDBOX_ADAPTER_REVISION="<full-reviewed-clean-commit>"
export AI_IMAGE_SANDBOX_EVIDENCE_ROOT=/secure/ai-image-sandbox
export AI_IMAGE_SANDBOX_BILLING_OBSERVATION_PATH=/secure/ai-image-sandbox/private/native-bill.json
export AI_IMAGE_SANDBOX_BILLING_OBSERVATION_SHA256="<reviewed-file-sha256>"
export AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256="<independently-reviewed-account-uid-sha256>"
pnpm --filter server sandbox:ai-image:billing:inspect-alibaba
```

The account digest is a UID digest from separate account review, never an API Key digest or an
arbitrary account-label digest. Keep all Provider/cloud secrets, paid confirmation, Operation ID,
approval inputs and finalization inputs unset. Inspection rejects these mixed inputs, verifies
tracked executable membership and the clean Git revision before and after reading, and emits only
hashes, enums, bounded dates, pagination and exact observed amounts. It never emits raw account,
bill, query-request or product identifiers, account names, raw responses or local paths.

An inspection result is deliberately ineligible for the finalizer and capability-candidate reader.
Actual request settlement still needs separately reviewed evidence linking the accepted Wanx task
to the bill and establishing the applicable amount/finality. Do not rename this observation as a
settlement or loosen the historical 15-minute no-request-ID correlation rule to make it pass.

### Inspect Native Console Consume Details

Use `pnpm --filter server sandbox:ai-image:billing:inspect-alibaba-console` with the same
offline environment, pinned file digest, independently reviewed account digest and clean
revision as the QueryBill command above. This separate mode accepts the observed
`BssOpenAPI-V3 / ListConsumeDetails` detail response. It does not accept QueryBill,
ListConsumeSummary or a screenshot under a different source label.

The private wrapper uses `schemaVersion:1`,
`kind:ALIBABA_CONSOLE_BILLING_OBSERVATION_V1`, `observedAt`, `collectorRef` and exactly two
`captures`. Each capture retains `capturedAt`, `request` and `response`. The response fields
are `httpStatus:200`, JSON `contentType`, `bodySha256` and the exact original `bodyBase64`.
The request fields are `path:/data/api.json`, `method:POST`, `product:BssOpenAPI-V3`,
`action:ListConsumeDetails` and the native `params` object:

| Scope | Required native parameters |
| --- | --- |
| Both captures | `Nbid:{sha256}`, `BillingCycle`, `BillingMonth`, `TableType:consumeDetailBillV2`, `Granularity:HOURLY`, `JumpPageSize`, `QueryMode` |
| Count capture | `QueryMode:COUNT_ONLY`; no data-page parameters |
| Data capture | `QueryMode:DATA_ONLY`, `MaxResults`, `current:1`, `currentPage:1`, `primaryKeys:[]`, `Console:true` |

Preserve the captured parameter values. Only the native Nbid is replaced with its SHA-256;
that navigation/query scope is not the billing account UID. The two requests must have the
same cycle, month and shared scope. This version admits only the observed first-page
request contract. It retains the returned NextBatchToken and PrimaryKeys as separate hashes,
checks Count/Data cardinality, and marks a partial page incomplete. It does not invent or
execute a later-page query. Separate Count/Data responses are not an atomic account snapshot.

The reader independently checks `ResourcePurchaseAccountId` and `ResourceOwnerAccountId`
against the reviewed UID digest. It preserves native bill/detail/instance identities and the
AssistExtend ApiKeyID, workspace, model, region and charge-item mapping as hashes. These are
not Wanx task IDs and do not prove task association or capture authentication. The wrapper
and response bounds, duplicate-key and exact-money rules above also apply; embedded native
JSON is checked separately. Known credential keys are rejected without confusing API key IDs
or pagination tokens with secrets.

The sanitized result is `ALIBABA_CONSOLE_BILLING_ASSESSMENT_V1`. It retains native dates,
`QuantityBeforeDeduction`, `ResourcePlanDeductQuantity`, `BillingQuantity`, and exact observed
amounts including `RequireAmount`. A free-quota label and zero payable remain observations;
`cashPaidAmount` and `actualCost` are always null, `canFinalize` is always false, and the state
remains `RECONCILIATION_REQUIRED`. Neither a synthetic nonzero fixture nor successful parsing
is proof of a real debit. The inspector writes no settlement, changes no original report,
contacts no Provider and grants no capability promotion.

### Native Wanx Task Association And Settlement Boundary

The official [billing and cost guide](https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management)
checked on 2026-09-10 distinguishes minute-level inference billing, usually visible 2–10 minutes
after a call ends, from actual payment. Pay-as-you-go uses reservation followed by monthly
settlement; a visible bill is not a cash-debit receipt.

The documented instance ID format is
`ApiKeyID;workspace ID;model;input/output type;call channel;stop-when-free-quota-exhausted flag`.
It has no Wanx `task_id`. This is a general documented format, not proof of the actual Wanx product
code, charge item or instance representation for the current account. Wanx submit/task IDs, each
API request ID, a BSS query request ID and `RecordID` must remain separate identities.

[QuerySettleBill](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-querysettlebill)
states that current-month results are for reference rather than reconciliation, that final bills
are available after 12:00 on the second day of the next month, and that fee/status updates may lag
by five hours. An empty current query, `PayFinish`, a zero cash component, the catalog unit price,
or `usage.image_count` cannot establish final per-task cost.

Keep the source-specific finality rules separate. On 2026-09-11, the authenticated
[monthly overview](https://billing-cost.console.aliyun.com/finance/month-bill/account) displayed
the second-day/noon and five-hour rules above, while the
[bill-detail page](https://billing-cost.console.aliyun.com/finance/expense-report/expense-detail-by-instance)
displayed final details after 12:00 on the **third** day of the next month, 24-hour fee-data delay,
and 48-hour delay for instance metadata. The observed detail page used
`BssOpenAPI-V3 / ListConsumeSummary` with `consumeDetailBillV2MonthSummary`, including separate
`COUNT_ONLY` and `DATA_ONLY` requests. These console responses are not `QueryBill` bodies and are
not accepted by the existing native-bill inspector. Preserve their actual method, query scope,
response bytes, and finality notice in private evidence; do not relabel them or infer an actual
cost from an empty result. A console usage-query `asyncTaskId` is also separate from a Wanx image
generation `task_id`.

A future native settlement contract needs an authentic account/ApiKeyID/workspace/model/region/
charge-item mapping, complete native billing bytes and the applicable payment/finality basis.
Assigning an aggregated billing interval to one task additionally needs complete evidence that
the interval contains only that task. Multiple tasks in the same interval must not be divided
into invented per-task actual costs. A round-level bill alone may support round-level review,
not an individual settlement receipt.

The QueryBill and ListConsumeDetails inspectors and isolated trial execution do not satisfy this association.
Trial execution records its scope in a report-bound `wanx.trial-evidence.json` file and keeps
`actualCost:null`; neither its execution claims nor a v4 approval is a native settlement proof.
Do not adapt the old `UNIQUE_ACCOUNT_TIME_WINDOW` rule, whose no-request-ID/15-minute boundary
does not describe this asynchronous, delayed native billing path.

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
for attestation v2, a v4 receipt for Token-log attestation v3, or a v5 receipt for cumulative-zero
attestation v4. All retain exact `actualCost`,
`quotedCost`, and `maximumCost` objects plus explicit `apiBaseSha256` and
`operationEndpointSha256`. The v4 receipt also retains separate upstream-response and Relay
billing-entry request-ID hashes, their bridge status, a globally claimed billing-entry key, a
hashed Relay user/Token identity, and the Token-log snapshot digest. A legacy v4 submit produces a
v2 receipt, while a historical v3 submit
keeps the byte-stable v1 receipt whose `endpointSha256` means the operation endpoint. Only a
receipt field explicitly named `apiBaseSha256` may be copied into Registry evidence. The settlement
never stores raw meter deltas, raw account/billing references, the raw Provider request ID, API
keys, Authorization, Provider responses, URLs, free-form reasons, or local paths.
The v5 receipt retains the cumulative evidence kind and settled snapshot digest, but not the raw
Sub2 response or a nonexistent pre-call snapshot digest.

For Wanx, the receipt retains the legacy API Base digest and async image-synthesis submit-endpoint
digest. It does not retain the raw task ID, poll URL, temporary result URL, or DashScope response
IDs. Preserve the private async sidecars with the receipt for audit and recovery, but do not treat
their `usage.imageCount` as a billing amount.

## Interpret The Result

- `billingGate: PASS`: the settled cost is within the approved maximum.
- `billingGate: COST_LIMIT_EXCEEDED`: the real bill exceeded the approved maximum. The amount is
  still recorded faithfully and capability promotion remains blocked.
- `billingGate: COST_BASIS_MISMATCH`: the reviewed account-credit cash cost and the original approval
  use different currency bases. Both are retained; no cross-currency amount comparison or automatic
  capability promotion is performed.
- `submitState: RECONCILIATION_REQUIRED`: billing is closed but the technical outcome is still
  unknown. Never retry the same request.

This settlement closes only the billing-evidence portion of QA-02. Exact operation compatibility,
result quality, privacy review, and rollout approval remain separate gates.
