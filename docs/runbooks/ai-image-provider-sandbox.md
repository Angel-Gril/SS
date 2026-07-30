# AI Image Provider Sandbox Acceptance

This runbook validates a real AI image Provider with one bounded paid request. It is an acceptance probe for code that remains unavailable to production users. It is not a tenant rollout, a load test, an Ozon publishing test, or permission to repeat an uncertain request.

Two Provider lanes are supported:

- International generation and editing through an explicitly configured third-party OpenAI-compatible HTTPS endpoint.
- Image translation through the official Alibaba Cloud DashScope endpoint with the fixed `qwen-mt-image` model.

The sandbox uses separate environment variables and `NODE_ENV=sandbox`. It must not read a production API key implicitly or change a production feature flag.

## Safety Boundary

Before and after every probe, keep all production entry points dark:

- `feature_ai_media_workflow_v2=false`
- `feature_ai_media_image_to_image=false`
- `feature_ai_media_suite=false`
- `feature_ai_media_full_edit=false`
- `feature_ai_media_inpaint=false`
- `feature_source_listing_web_media=false`
- `feature_source_listing_extension_workbench=false`
- `feature_source_ozon_publisher_v2=false`
- `ai_media_workflow_v2_rollout_policy` has an empty `tenantIds` array
- the `ai_image_generation_enabled` / `ai_image_provider` pair does not activate a paid production channel
- the `feature_image_translate` / `ai_image_translation_provider` pair does not activate a paid production channel
- all five `source_ozon_publisher_*_stage` values remain `off`

Run the deployed dark-state verifier before and after the probe:

```bash
bash scripts/verify-ai-media-dark.sh
```

The sandbox does not require a tenant ID, bucket name, shop credential, Ozon credential, or a production feature change. Do not put any of those values into its environment or evidence.

On an app-directory VPS deployment, both evidence roots are private persistent paths. The deployer links the CLI defaults to them before each release switch:

- `/opt/ss-erp/app/tmp/ai-image-sandbox` -> `/opt/ss-erp/shared/ai-image-sandbox`
- `/opt/ss-erp/app/tmp/ai-image-translation-sandbox` -> `/opt/ss-erp/shared/ai-image-translation-sandbox`

Verify that both links resolve under `/opt/ss-erp/shared` and that the shared directories have mode `0700`. Never relocate this evidence into `apps/server/public`.

## One-Use Request Identity

Create one unique Operation ID for one reviewed request. An Operation ID must be 8-80 characters and match `[A-Za-z0-9][A-Za-z0-9._-]*`. Treat it as permanently consumed once an intent or fingerprint claim exists.

Before dispatch, the CLI writes an immutable `SUBMITTING` intent and a fail-closed request-fingerprint claim. The replay fingerprint binds only actual Provider transport semantics: endpoint hash, model, image count, requested size, fixed Prompt hash, ordered source hashes, and mask hash. Audit-only labels, approval metadata, credential revision, adapter revision, and source dimensions remain in the intent but cannot create a new replay identity. The same paid request is therefore rejected even if an operator changes only the Operation ID, approval, profile label, credential, or deployment revision.

On Linux, claim and intent creation pins both the private `intents` and descriptor-relative
`.fingerprints` directories before either artifact is written. Both writes remain bound to those
handles through durability sync and final visible-path/handle identity checks. Replacing the parent
keeps subsequent writes in the held tree; replacing only `.fingerprints` cannot redirect the claim
into the replacement. Either detected change returns `SANDBOX_EVIDENCE_DIRECTORY_CHANGED` before
Provider dispatch. Other platforms use canonical paths plus final identity checks under the
documented local ACL trust boundary and do not claim the same descriptor-relative guarantee.

Run the descriptor and final-entry boundary tests on an actual Linux filesystem before relying on
that guarantee:

```bash
pnpm --filter server exec vitest run \
  src/__tests__/ai-image-sandbox-guard-filesystem.test.ts \
  src/__tests__/ai-image-sandbox-media.test.ts
```

A Windows run intentionally skips the `/proc/self/fd`, directory-replacement, and final-entry
symlink cases; passing only the Windows projection is not Linux execution evidence.

Never delete an intent or `.fingerprints` claim to make a request runnable again. Never switch to a new Operation ID after a timeout, connection loss, malformed acknowledgement, or other ambiguous outcome. Resolve the original request with read-only evidence.

## Revision And Cost Evidence

Set revisions from authoritative records:

- `credentialRevision` is a non-secret version label for the exact injected credential. Use a secret-manager version, controlled configuration revision, or key-rotation revision. Do not use the secret itself, its prefix, or a secret hash as the label.
- `pricingRevision` is a non-secret version label for the backend pricing policy that supplies the
  exact quote and single-request maximum. It must bind the model alias, operation, quality, size,
  image count and currency. A live Provider pricing API lookup is not required for this sandbox.
- `adapterRevision` is the exact commit deployed with the CLI being executed. Use the full 40- or 64-character value from `DEPLOYED_COMMIT` or `git rev-parse HEAD`; abbreviated SHAs are rejected. `HEAD` must match `DEPLOYED_COMMIT`, each paid CLI/security module must be tracked and byte-identical to that revision, the tracked worktree must be clean, and HEAD is verified again after inspection. The official direct CLI rejects a marker-only release archive because it cannot reconstruct Git blob membership. On a VPS, use a private clean checkout of the deployed revision and point its evidence root to the private shared sandbox directory. The direct submit process captures and removes its paid confirmation/API Key from `process.env` before Git inspection; Git receives only a minimal OS environment with hooks, fsmonitor, and recursive submodules disabled. Any Git verification error fails closed. If no trustworthy code identity is available, the probe fails closed. Do not use a planned or local-only commit.

Record the Provider account, backend policy revision, currency, model, quoted charge, balance or
usage counter, and observation time immediately before the call. Repeat the observation after the
Provider has settled the charge.

New international approvals use exact money through `AI_IMAGE_SANDBOX_CURRENCY`,
`AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT`, `AI_IMAGE_SANDBOX_MAX_COST_AMOUNT`, and
`AI_IMAGE_SANDBOX_COST_SCALE`. Amounts are canonical positive integers and the shared scale is an
integer from `0` through `8`; for example, `CNY amount=119 scale=4` means `CNY 0.0119`. Quote and
maximum must use one currency and minimal shared scale, and the maximum is bounded to `100,000`
major currency units. Do not use floats or mix these variables with legacy cents.

Historical international evidence may still use `AI_IMAGE_SANDBOX_QUOTED_COST_CENTS` and
`AI_IMAGE_SANDBOX_MAX_COST_CENTS`; the DashScope translation lane continues to use its own integer
cents variables. These fields are compatibility paths, not the format for a new sub-cent
international approval. The quote/maximum fields do **not** limit the Provider bill or prove the
actual charge; they bind the backend policy and this one-request approval. Exact submit reports
leave `actualCost` as `null`; legacy
reports leave `actualCostCents` as `null`. Settled cost is recorded later through the append-only
[billing finalizer](ai-image-provider-sandbox-billing.md). Configure a Provider-side spending cap
separately when one is available.

Do not promote a capability until the settled Provider bill can be reconciled to the request. When the Provider omits a request ID, correlate the narrow time window, account, endpoint, model, operation, and image count, and record the remaining uncertainty.

## Offline Verification

Run these from the repository root with paid confirmations and API keys unset. These tests use local fixtures or mocked transports and do not make a paid Provider request:

```bash
node --test scripts/ai-image-single-submit-contract.test.mjs scripts/ai-image-translation-single-submit-contract.test.mjs
pnpm --filter server exec vitest run scripts/ai-image-provider-approval-draft.test.ts scripts/ai-image-provider-single-submit.test.ts scripts/ai-image-translation-single-submit.test.ts src/__tests__/ai-image-sandbox-guard.test.ts src/__tests__/ai-image-translation-sandbox-guard.test.ts
pnpm preflight
```

Also confirm the worktree and executable revision:

```bash
git status --short
git rev-parse HEAD
```

Do not run a paid probe from an unreviewed or partially deployed worktree.

The private [approval runbook](ai-image-provider-sandbox-approval.md) includes an optional
`sandbox:ai-image:approval:draft` command that binds the non-secret request into a private canonical
file without DNS, intent creation, or Provider access. Its rejection sentinels require a separate
human review and cannot authorize a request.

After the private international approval file is final, run the no-key/no-confirmation exact-request
preflight before any paid submit:

```bash
pnpm --filter server sandbox:ai-image:approval:verify
```

This command performs no DNS lookup, intent/fingerprint claim, or Provider request. An exact-money
approval emits a v3 verification event; a legacy cents approval retains the v2 event. Both report
separate `apiBaseSha256` and `operationEndpointSha256` values, the approved cost exposure, and the
sanitized approval validity window without exposing either URL. It rejects a non-HTTPS endpoint.
Approval freshness is checked again throughout the submit path and immediately before the single
Provider POST.

## International OpenAI-Compatible Probe

This lane accepts an operator-approved third-party endpoint. The configured base URL must use HTTPS, contain a DNS hostname, and contain no credentials, query, fragment, or `/images/generations` or `/images/edits` operation path. The CLI normalizes the base to `/v1`, requires `AI_IMAGE_SANDBOX_EXPECTED_HOST` to equal its hostname, validates public DNS, pins the resolved addresses, and permits one create POST.

Supported operations are:

| Operation        | Paid endpoint            | Input                                                                         |
| ---------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `TEXT_TO_IMAGE`  | `/v1/images/generations` | No source or mask variables                                                   |
| `IMAGE_TO_IMAGE` | `/v1/images/edits`       | One pinned PNG, JPEG, or WebP source                                          |
| `FULL_EDIT`      | `/v1/images/edits`       | One pinned PNG, JPEG, or WebP source                                          |
| `INPAINT`        | `/v1/images/edits`       | One pinned source and a same-size PNG mask with transparent and opaque pixels |

Prompts and requested count (`1`) are fixed in the CLI. The required request profile freezes the request dimensions and the single-reference multipart shape:

| Request profile                  | Requested size | Intended evidence scope                                      |
| -------------------------------- | -------------- | ------------------------------------------------------------ |
| `OPENAI_SQUARE_SINGLE_V1`        | `1024x1024`    | Square generation or one-source edit compatibility           |
| `OZON_PORTRAIT_SINGLE_V1`        | `1024x1536`    | 2:3 Provider canvas composed crop-safe for final 3:4 normalization; does not prove native 3:4 transport |

Neither profile proves multi-reference compatibility. A Provider may return a different valid size; record that as a compatibility result, not automatic acceptance. Any promoted capability must be limited to the exact tested profile, operation, endpoint digest, model, adapter revision, credential revision, and verified reference count.

### Complete Environment Contract

Inject secrets without echoing them or retaining them in shell history. Use placeholders only in documentation and tickets.

Before setting the paid confirmation, create and review the private
[one-request approval record](ai-image-provider-sandbox-approval.md). The CLI hashes that file and
fails before DNS, intent creation, or Provider dispatch when any exact request field differs.

| Variable                               | Requirement                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                             | Must be `sandbox`                                                                       |
| `AI_IMAGE_SANDBOX_CONFIRM`             | Must be exactly `I_ACCEPT_ONE_PAID_IMAGE_REQUEST` immediately before this one run       |
| `AI_IMAGE_SANDBOX_BASE_URL`            | Exact third-party OpenAI-compatible HTTPS base URL                                      |
| `AI_IMAGE_SANDBOX_EXPECTED_HOST`       | Exact lowercase hostname from the base URL                                              |
| `AI_IMAGE_SANDBOX_API_KEY`             | Secret injected for this process only                                                   |
| `AI_IMAGE_SANDBOX_APPROVAL_PATH`       | Private closed-schema approval JSON for this exact one paid request                     |
| `AI_IMAGE_SANDBOX_APPROVAL_SHA256`     | Lowercase SHA-256 of the final reviewed approval file                                   |
| `AI_IMAGE_SANDBOX_MODEL`               | Exact third-party model identifier under test                                           |
| `AI_IMAGE_SANDBOX_OPERATION`           | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, or `INPAINT`                            |
| `AI_IMAGE_SANDBOX_REQUEST_PROFILE`     | `OPENAI_SQUARE_SINGLE_V1` or `OZON_PORTRAIT_SINGLE_V1`                                 |
| `AI_IMAGE_SANDBOX_OPERATION_ID`        | New one-use Operation ID                                                                |
| `AI_IMAGE_SANDBOX_CREDENTIAL_REVISION` | Non-secret revision of the injected key                                                 |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`    | Exact deployed Git commit SHA                                                           |
| `AI_IMAGE_SANDBOX_CURRENCY`            | Uppercase three-letter currency for both exact amounts                                  |
| `AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT`  | Canonical positive integer quote in the shared exact-money scale                        |
| `AI_IMAGE_SANDBOX_MAX_COST_AMOUNT`     | Canonical positive integer operator-approved maximum; not a Provider limit              |
| `AI_IMAGE_SANDBOX_COST_SCALE`          | Shared decimal scale from `0` through `8`; must be minimal for the quote/maximum pair    |
| `AI_IMAGE_SANDBOX_SOURCE_PATH`         | Required only for the three edit operations; absolute or repository-root-relative path  |
| `AI_IMAGE_SANDBOX_SOURCE_SHA256`       | Required with source path; lowercase SHA-256 of the exact local bytes                   |
| `AI_IMAGE_SANDBOX_MASK_PATH`           | Required only for `INPAINT`                                                             |
| `AI_IMAGE_SANDBOX_MASK_SHA256`         | Required with mask path; lowercase SHA-256 of the exact PNG bytes                       |

For a new international request, set all four exact-money variables and leave both legacy cents
variables unset. Historical v2 approvals require the two legacy cents variables instead and cannot
be combined with any exact amount/scale variable. For `TEXT_TO_IMAGE`, leave all source and mask
variables unset. For `IMAGE_TO_IMAGE` and `FULL_EDIT`, leave both mask variables unset. The CLI
rejects extra conditional variables instead of ignoring them. One source, or the combined
`INPAINT` source and mask, must not exceed the shared `50 MiB` edit-request limit. The offline draft
and exact-request approval preflight use the same bounded media verifier and reject oversized or
unsupported media before DNS, intent creation, or Provider dispatch.

Relative source and mask paths are resolved from the repository/deployed app root, even though `pnpm --filter server` executes the package script with `apps/server` as its process working directory.

### Submit Once

1. Hash the reviewed source and mask, when applicable, and place their bytes under access-controlled temporary storage.
2. Take the pre-call billing snapshot, verify the dark state, and finalize the private approval
   record with its exact billing references.
3. Hash the unchanged approval file and inject the complete environment contract. Set the
   confirmation only after a second operator or recorded review has checked the approval digest,
   endpoint, model, operation, revisions, source/mask hashes, and cost evidence.
4. Run exactly once from the repository root:

   ```bash
   pnpm --filter server sandbox:ai-image:single
   ```

5. Unset the confirmation and API key immediately after the process exits.
6. Inspect `tmp/ai-image-sandbox/<operation-id>.report.json`, the immutable intent under
   `tmp/ai-image-sandbox/intents/`, and the returned image. Exact-money requests produce a
   `schemaVersion: 3` intent and `schemaVersion: 5` submit report; historical cents requests retain
   intent v2/report v4. Verify `apiBaseSha256`, `operationEndpointSha256`, request profile,
   source/mask dimensions and digests, image count, MIME type, output dimensions, byte length,
   SHA-256, requested semantics, exact quote/maximum values, and absence of unexpected text, logos,
   watermarks, or product changes. `apiBaseSha256` hashes the normalized Provider API Base;
   `operationEndpointSha256` hashes the exact `/images/generations` or `/images/edits` POST target.
7. Save the settled billing snapshot as a private bounded file, create the private closed-schema
   billing attestation that names and hashes both the before/settled snapshot files, and run
   `pnpm --filter server sandbox:ai-image:billing:finalize`. The finalizer performs no Provider call,
   verifies the snapshot bytes, preserves the original intent/report byte-for-byte, and writes one
   sanitized append-only billing settlement sibling.
8. Run the dark-state verifier again.

This lane has no automated reconciliation mode. If its report is `RECONCILIATION_REQUIRED`, use only the relay dashboard, billing ledger, request logs, or Provider support to resolve the original request. Do not call the submit command again.

### Recorded International Relay Observation (2026-07-25)

The configured international relay/model produced one earlier text-to-image result, but the evidence did not reconcile settled billing. Two independently claimed `IMAGE_TO_IMAGE` requests were definitely rejected with HTTP 400; the second used the current single-image multipart field and frozen square request profile. `FULL_EDIT` and `INPAINT` were not dispatched because they share the rejected edits transport.

Treat this exact relay/model as text-to-image-only and still unverified for production. Model-catalog access is not generation acceptance, and generation acceptance is not edit acceptance. Do not repeat the rejected requests or enable reference generation, full edit, inpaint, suites, or tenant rollout unless the operator selects an edit-capable endpoint/model and completes a new bounded acceptance.

### Recorded `gpt-image-2-count` edit rejection (2026-07-30)

The exact catalog-visible alias was separately tested once under explicit approval as
`IMAGE_TO_IMAGE`, `OPENAI_SQUARE_SINGLE_V1`, `1024x1024`, `n=1`, using the already accepted mug
source SHA-256 `481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`.
The private policy quoted exact `CNY 0.0119` and authorized a maximum of `CNY 1.0000`.

Operation `qa02-i2i-20260730-083710-01` made exactly one guarded `/v1/images/edits` POST. Its v5
report is a definite `REJECTED` result with `createRequests=1`, `providerRequestIdHash=null`,
`failureCode=PROVIDER_REQUEST_FAILED`, and elapsed time `155 ms`. It was not retried. Independent
raw-quota and displayed-usage snapshots both had zero delta, and the authenticated Token log had no
matching consume entry. The append-only exact receipt v3 therefore records `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; receipt SHA-256 is
`c05aaa7e31a545e0be6a5107a7300e30d4d10f2ef634d7472a51dd064f5db855`.

This exact endpoint/model is now directly evidenced as generation-capable but edit-transport
incompatible. Do not dispatch `FULL_EDIT` or `INPAINT` against it: both share the rejected
`/images/edits` transport, neither has a separate authorization, and another paid attempt would not
repair the demonstrated capability gap. Select a different edit-capable endpoint/model and restart
the bounded approval sequence there.

The international database may still contain a legacy `openai-images` selection with a third-party
Base URL. Current admin validation and paid runtime contracts reject that identity: official OpenAI
Images is restricted to `https://api.openai.com/v1`, while a relay must be labeled `custom`. Use the
admin one-click correction only to fix configuration identity; it does not authorize or re-test
`gpt-image-2`. A 2026-07-29 bounded `/models` check listed only that already rejected model, so a new
edit sandbox still requires a different endpoint/model rather than another request to the same one.

The runtime identity canonicalizes the bare official origin `https://api.openai.com` to
`https://api.openai.com/v1`. It applies the same effective transport rule to `custom` relays: a bare
origin receives `/v1`, and a custom prefix receives a trailing `/v1`. A paid v1 contract frozen by
older code from the pre-normalization raw text will not match the new hash. Treat it as a closed
historical operation: do not retry it, inspect and release or reconcile any reservation, then create
a fresh quote only after the Provider remains authorized. Contracts originally frozen with their
effective `/v1` API Base keep their existing hash.

Do not promote a Provider by changing only `evidenceLevel`. For every operation that will be marked
`sandbox-verified`, add a reviewed `sandboxEvidence` record with the report's `apiBaseSha256`, exact
operation, actual input transport, and actual sync/async result mode. `apiBaseSha256` is the only
direct-submit field eligible for Registry `sandboxEvidence.endpointSha256`; it hashes the same
normalized Provider API Base used by runtime contracts. `operationEndpointSha256` instead binds the
specific guarded POST and must not be copied into the Registry. Historical `schemaVersion: 3`
reports used the ambiguous name `endpointSha256` for that operation endpoint, so they are still
eligible for billing finalization but cannot by themselves supply Registry API-base evidence.
Evidence is not portable between API Bases, operations, multipart/base64/public-URL modes, or
sync/async adapters. The static Provider contract requires complete bindings for every operation
advertised by a verified entry, while final dispatch rechecks the single operation actually being
executed.

## DashScope `qwen-mt-image` Translation Probe

This lane accepts only the default-port official origin `https://dashscope.aliyuncs.com` (optionally with the exact `/api/v1` path) and the exact `qwen-mt-image` model. Custom ports, path prefixes, credentials, queries, and fragments are rejected. The CLI normalizes the base to `/api/v1`, pins public DNS, submits once to the official image-synthesis service, and polls a bounded task endpoint.

A synthetic source is preferred but not mandatory. A real product image may be used when the operator has explicit authorization to send it to Alibaba Cloud and has checked the image and metadata for personal data, credentials, private supplier data, or other prohibited content. Record that approval outside the public report.

### Pin Local And Public Source Bytes

DashScope must fetch a public HTTPS source URL asynchronously. Prepare one local PNG, JPEG, or WebP file of at most 20 MiB and 4096 pixels per edge, then publish those exact bytes at a dedicated temporary URL.

Before setting the paid confirmation:

1. Compute the local lowercase SHA-256.
2. GET the public URL independently and confirm its bytes have the same SHA-256 and MIME type.
3. Make the object immutable for the entire submit and reconciliation window. Prefer a content-addressed object name, overwrite protection, and `Cache-Control: immutable`.
4. Record the object version and ETag privately. The CLI stores only `etagSha256` and `cacheControlImmutable` in its intent/report.
5. Give a signed URL enough lifetime for the bounded poll and later manual reconciliation. Do not put the URL into a ticket, chat, or public report.

The CLI repeats the GET and byte-hash check before the paid POST. A matching ETag alone is not proof of matching content. ETag and `Cache-Control: immutable` are recorded evidence, not an automatic dispatch gate. If the resulting evidence reports `cacheControlImmutable=false` or lacks the expected ETag evidence, fail the acceptance review even if the Provider returned an image.

### Complete `SUBMIT` Environment Contract

| Variable                                           | Requirement                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                         | Must be `sandbox`                                                                              |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODE`                | Must be `SUBMIT`                                                                               |
| `AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM`             | Must be exactly `I_ACCEPT_ONE_PAID_IMAGE_TRANSLATION_REQUEST` immediately before this one run  |
| `AI_IMAGE_TRANSLATION_SANDBOX_BASE_URL`            | Official DashScope HTTPS base, without an operation path                                       |
| `AI_IMAGE_TRANSLATION_SANDBOX_EXPECTED_HOST`       | Must identify the official DashScope hostname                                                  |
| `AI_IMAGE_TRANSLATION_SANDBOX_API_KEY`             | Alibaba Cloud secret injected for this process only                                            |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODEL`               | Must be `qwen-mt-image`                                                                        |
| `AI_IMAGE_TRANSLATION_SANDBOX_OPERATION_ID`        | New one-use Operation ID                                                                       |
| `AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION` | Non-secret revision of the injected Alibaba key                                                |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`                | Exact deployed Git commit SHA; this variable is intentionally shared with the generation probe |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_PATH`         | Absolute or repository-root-relative path to the reviewed source bytes                          |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256`       | Lowercase SHA-256 shared by the local file and public object                                   |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_URL`          | Temporary public HTTPS URL for those exact bytes                                               |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_LANGUAGE`     | Source language code                                                                           |
| `AI_IMAGE_TRANSLATION_SANDBOX_TARGET_LANGUAGE`     | Different target language code                                                                 |
| `AI_IMAGE_TRANSLATION_SANDBOX_DOMAIN_HINT`         | Reviewed translation context; maximum 16,000 UTF-8 bytes                                       |
| `AI_IMAGE_TRANSLATION_SANDBOX_TERMINOLOGIES_JSON`  | Optional JSON array of at most 50 unique `{\"src\",\"tgt\"}` entries; defaults to `[]`         |
| `AI_IMAGE_TRANSLATION_SANDBOX_QUOTED_COST_CENTS`   | Positive integer quote recorded before dispatch                                                |
| `AI_IMAGE_TRANSLATION_SANDBOX_MAX_COST_CENTS`      | Positive integer operator-approved exposure; not an Alibaba billing limit                      |

### Submit Once

After the source, revisions, dark state, and cost snapshot pass review, run exactly once:

```bash
pnpm --filter server sandbox:ai-image-translation:single
```

Unset the confirmation, API key, and source URL after exit. Inspect the submit report, result image, immutable intent, and private recovery journal under `tmp/ai-image-translation-sandbox/`. Do not resubmit when polling or download is incomplete.

### Recorded Quality Observation (2026-07-24)

A controlled synthetic `en` to `ru` A/B completed against the official `qwen-mt-image` lane. The reviewed semantic request inputs kept the source bytes, language pair, model, adapter and domain context fixed; only the terminology glossary changed.

- The no-glossary result mistranslated the product and capacity labels.
- The glossary-constrained result used the correct Russian product and capacity wording and retained the reviewed layout.
- The reports retained `actualCostCents: null`, so this run did not close the billing evidence gate.
- No production-equivalent `zh` to `ru` marketplace image and category glossary has passed the same review.

Treat this as a narrow quality observation, not capability promotion. `dashscope-qwen-mt-image` remains `adapter characterized`, Unit 0B remains open, and all production translation switches remain dark. Before promotion, run a separately approved `zh` to `ru` acceptance corpus with trusted category terminology, reconcile the settled charge, and review Russian readability, Chinese-text residue, layout preservation and product identity. Never reuse the earlier Operation IDs or repeat either paid request.

### `RECONCILE` With GET Only

Use reconciliation only for an existing translation Operation ID whose submit report is `RECONCILIATION_REQUIRED`. It loads the original immutable intent and private recovery journal. The network guard permits task polling and result download GETs but blocks a new submit POST.

Set exactly these variables for a reconciliation attempt:

| Variable                                           | Requirement                                              |
| -------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                                         | Must be `sandbox`                                        |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODE`                | Must be `RECONCILE`                                      |
| `AI_IMAGE_TRANSLATION_SANDBOX_BASE_URL`            | Same official base bound to the original intent          |
| `AI_IMAGE_TRANSLATION_SANDBOX_EXPECTED_HOST`       | Same official hostname                                   |
| `AI_IMAGE_TRANSLATION_SANDBOX_API_KEY`             | Credential authorized to read the original task          |
| `AI_IMAGE_TRANSLATION_SANDBOX_MODEL`               | Must remain `qwen-mt-image`                              |
| `AI_IMAGE_TRANSLATION_SANDBOX_OPERATION_ID`        | The original Operation ID; never a replacement ID        |
| `AI_IMAGE_TRANSLATION_SANDBOX_RECONCILIATION_ID`   | New one-use ID for this read-only reconciliation attempt |
| `AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION` | Must match the original intent                           |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`                | Full Git SHA of the currently deployed reconciliation CLI; must equal `DEPLOYED_COMMIT` |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256`       | Must match the original source digest                    |

Do not set the paid `SUBMIT` confirmation. Quoted and maximum costs, language, terminology, and source URL evidence remain bound by the original intent. Source path, raw source URL, language, terminology, and cost variables are not read in `RECONCILE`; do not set replacements for them.

The immutable intent retains the SHA of the code that performed the original submit. A later deployment may safely reconcile that task: the runner validates the stored SHA as `submissionAdapterRevision`, independently requires the current `AI_IMAGE_SANDBOX_ADAPTER_REVISION` to equal `DEPLOYED_COMMIT`, and records the latter as `reconciliationAdapterRevision` (and the backward-compatible `adapterRevision`) in the reconciliation evidence. Do not copy the old submit SHA into the current environment after a deployment.

The raw result URL in the private journal is only a download hint. If it is expired or fails the current HTTPS/host/DNS policy, reconciliation preserves that raw evidence, sends no request to the rejected URL, and continues bounded GET-only polling through the durable Provider task ID. This fallback never authorizes another submit POST.

Run:

```bash
pnpm --filter server sandbox:ai-image-translation:single
```

One reconciliation attempt is bounded to 30 polls and 10 minutes. If it remains `RECONCILIATION_REQUIRED`, stop. Wait for external state to change, inspect the Alibaba task and billing records, and approve a later read-only reconciliation explicitly. Never change the Operation ID and return to `SUBMIT`.

## Outcome Handling

The report state, request counters, intent, recovery evidence, and Provider billing record are authoritative. The generic terminal error text is not.

| State                     | Meaning                                                                    | Required action                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRE_DISPATCH_FAILED`     | No guarded create/submit POST was sent                                     | Preserve the intent and fingerprint. Confirm the request counter is zero, fix the root cause, and review a genuinely new request. A new Operation ID alone is not a retry mechanism.                      |
| `REJECTED`                | The Provider returned a definite rejection after dispatch                  | Do not assume zero cost. Preserve evidence, inspect the Provider bill and rejection, then require a new reviewed request for any later attempt.                                                           |
| `RECONCILIATION_REQUIRED` | Dispatch, acknowledgement, polling, or download is ambiguous or incomplete | Never resubmit. For translation, use the same Operation ID with `RECONCILE`; for the third-party lane, use only external read-only evidence. Keep the source object available.                            |
| `FAILED`                  | DashScope reported a terminal failed or cancelled task                     | Stop polling, preserve evidence, and reconcile billing. Any later submission must be a separately approved request based on a diagnosed cause.                                                            |
| `SUCCEEDED`               | One output was downloaded and passed structural checks                     | Perform visual, semantic, dimension, source-preservation, and billing review. Success proves only this endpoint/model/operation/revision combination; it does not authorize tenant or production rollout. |

Provider HTTP `408`, `409`, `425`, `429`, 5xx responses, transport loss, malformed acknowledgements, and poll/download uncertainty are reconciliation cases, not definite rejections.

Configuration, local source, revision, and DNS failures can happen before an immutable claim/report exists. The direct CLI emits one sanitized `SANDBOX_COMMAND_FAILED` JSON event containing only `failureCode`, followed by a generic message. If the operation has no intent, fingerprint claim, or report, treat that as a pre-claim failure; correct the cause only after confirming all three are absent. Never infer dispatch state from the generic terminal message alone.

## Evidence, Recovery, And Cleanup

Sandbox directories and files are created with Unix modes `0700` and `0600` where the platform supports them. Claims, intents, recovery entries, result files, and renamed reports are synced together with their parent directory before the next state transition. Verify the mode and persistent shared path on the execution host. Windows permission emulation is best effort and requires an equivalent ACL.

Retain together:

- immutable intent and fingerprint claim;
- the private one-request approval file and its reviewed SHA-256 digest;
- sanitized submit or reconciliation report;
- source and mask SHA-256 evidence;
- generated result and its SHA-256 until visual review completes;
- pre-call and settled billing evidence;
- exact deployed commit and credential revision;
- the operator decision for the final acceptance result.

The translation recovery journal contains the **raw Provider task ID and raw result URL**. Keep it `0600`, restrict it to operators performing reconciliation, and never attach it to a ticket, commit, chat, or public report. Sanitized reports replace raw task IDs, request IDs, endpoints, source URLs, ETags, prompts, sources, masks, and results with hashes where applicable, while retaining bounded metadata needed for review. Remove local filesystem paths before sharing a report outside the operations team.

Do not delete or revoke the public translation source while a task is pending or reconciliation is required. After a terminal result, visual review, billing reconciliation, and evidence backup:

1. delete the temporary public source object or revoke its public/signed access;
2. verify the URL no longer serves the bytes;
3. retain or delete local source bytes according to the approved data-retention policy while preserving the recorded digest;
4. retain audit evidence for the approved security and financial retention period;
5. never upload sandbox output to a production listing or Ozon as part of this runbook.

Promotion is a separate change. It requires endpoint-bound capability evidence, operation-specific quality acceptance, verified pricing, budget controls, credential and adapter revisions, an approved tenant scope, review, deployment, and post-deploy monitoring.
