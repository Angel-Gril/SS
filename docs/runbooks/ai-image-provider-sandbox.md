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

Before dispatch, the CLI writes an immutable `SUBMITTING` intent and a fail-closed request-fingerprint claim. The fingerprint binds the endpoint hash, model, credential revision, adapter revision, operation, fixed prompt, source and mask hashes, and other request fields. The same paid request is rejected even if an operator changes only the Operation ID.

Never delete an intent or `.fingerprints` claim to make a request runnable again. Never switch to a new Operation ID after a timeout, connection loss, malformed acknowledgement, or other ambiguous outcome. Resolve the original request with read-only evidence.

## Revision And Cost Evidence

Set both revisions from authoritative records:

- `credentialRevision` is a non-secret version label for the exact injected credential. Use a secret-manager version, controlled configuration revision, or key-rotation revision. Do not use the secret itself, its prefix, or a secret hash as the label.
- `adapterRevision` is the exact commit deployed with the CLI being executed. Use the full 40- or 64-character value from `DEPLOYED_COMMIT` or `git rev-parse HEAD`; abbreviated SHAs are rejected. On a packaged deployment the CLI also rejects a value that does not equal `DEPLOYED_COMMIT`. Do not use a planned or local-only commit.

Record the Provider account, pricing revision, currency, model, quoted charge, balance or usage counter, and observation time immediately before the call. Repeat the observation after the Provider has settled the charge.

`*_QUOTED_COST_CENTS` and `*_MAX_COST_CENTS` are positive integer audit fields, with quoted cost less than or equal to maximum cost. They do **not** limit the third-party or Alibaba bill, reserve a production budget, or prove the actual charge. Reports intentionally leave `actualCostCents` as `null`. Configure a Provider-side spending cap separately when one is available.

Do not promote a capability until the settled Provider bill can be reconciled to the request. When the Provider omits a request ID, correlate the narrow time window, account, endpoint, model, operation, and image count, and record the remaining uncertainty.

## Offline Verification

Run these from the repository root with paid confirmations and API keys unset. These tests use local fixtures or mocked transports and do not make a paid Provider request:

```bash
node --test scripts/ai-image-single-submit-contract.test.mjs scripts/ai-image-translation-single-submit-contract.test.mjs
pnpm --filter server exec vitest run scripts/ai-image-provider-single-submit.test.ts scripts/ai-image-translation-single-submit.test.ts src/__tests__/ai-image-sandbox-guard.test.ts src/__tests__/ai-image-translation-sandbox-guard.test.ts
pnpm preflight
```

Also confirm the worktree and executable revision:

```bash
git status --short
git rev-parse HEAD
```

Do not run a paid probe from an unreviewed or partially deployed worktree.

## International OpenAI-Compatible Probe

This lane accepts an operator-approved third-party endpoint. The configured base URL must use HTTPS, contain a DNS hostname, and contain no credentials, query, fragment, or `/images/generations` or `/images/edits` operation path. The CLI normalizes the base to `/v1`, requires `AI_IMAGE_SANDBOX_EXPECTED_HOST` to equal its hostname, validates public DNS, pins the resolved addresses, and permits one create POST.

Supported operations are:

| Operation        | Paid endpoint            | Input                                                                         |
| ---------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `TEXT_TO_IMAGE`  | `/v1/images/generations` | No source or mask variables                                                   |
| `IMAGE_TO_IMAGE` | `/v1/images/edits`       | One pinned PNG, JPEG, or WebP source                                          |
| `FULL_EDIT`      | `/v1/images/edits`       | One pinned PNG, JPEG, or WebP source                                          |
| `INPAINT`        | `/v1/images/edits`       | One pinned source and a same-size PNG mask with transparent and opaque pixels |

Prompts, requested count (`1`), and requested size (`1024x1024`) are fixed in the CLI. A Provider may return a different valid size; record that as a compatibility result, not automatic acceptance.

### Complete Environment Contract

Inject secrets without echoing them or retaining them in shell history. Use placeholders only in documentation and tickets.

| Variable                               | Requirement                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                             | Must be `sandbox`                                                                       |
| `AI_IMAGE_SANDBOX_CONFIRM`             | Must be exactly `I_ACCEPT_ONE_PAID_IMAGE_REQUEST` immediately before this one run       |
| `AI_IMAGE_SANDBOX_BASE_URL`            | Exact third-party OpenAI-compatible HTTPS base URL                                      |
| `AI_IMAGE_SANDBOX_EXPECTED_HOST`       | Exact lowercase hostname from the base URL                                              |
| `AI_IMAGE_SANDBOX_API_KEY`             | Secret injected for this process only                                                   |
| `AI_IMAGE_SANDBOX_MODEL`               | Exact third-party model identifier under test                                           |
| `AI_IMAGE_SANDBOX_OPERATION`           | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, or `INPAINT`                            |
| `AI_IMAGE_SANDBOX_OPERATION_ID`        | New one-use Operation ID                                                                |
| `AI_IMAGE_SANDBOX_CREDENTIAL_REVISION` | Non-secret revision of the injected key                                                 |
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`    | Exact deployed Git commit SHA                                                           |
| `AI_IMAGE_SANDBOX_QUOTED_COST_CENTS`   | Positive integer quote recorded before dispatch                                         |
| `AI_IMAGE_SANDBOX_MAX_COST_CENTS`      | Positive integer operator-approved exposure; not a Provider limit                       |
| `AI_IMAGE_SANDBOX_SOURCE_PATH`         | Required only for the three edit operations; absolute or repository-root-relative path  |
| `AI_IMAGE_SANDBOX_SOURCE_SHA256`       | Required with source path; lowercase SHA-256 of the exact local bytes                   |
| `AI_IMAGE_SANDBOX_MASK_PATH`           | Required only for `INPAINT`                                                             |
| `AI_IMAGE_SANDBOX_MASK_SHA256`         | Required with mask path; lowercase SHA-256 of the exact PNG bytes                       |

For `TEXT_TO_IMAGE`, leave all source and mask variables unset. For `IMAGE_TO_IMAGE` and `FULL_EDIT`, leave both mask variables unset. The CLI rejects extra conditional variables instead of ignoring them.

Relative source and mask paths are resolved from the repository/deployed app root, even though `pnpm --filter server` executes the package script with `apps/server` as its process working directory.

### Submit Once

1. Hash the reviewed source and mask, when applicable, and place their bytes under access-controlled temporary storage.
2. Take the pre-call billing snapshot and verify the dark state.
3. Inject the complete environment contract. Set the confirmation only after a second operator or recorded review has checked the endpoint, model, operation, revisions, hashes, and cost evidence.
4. Run exactly once from the repository root:

   ```bash
   pnpm --filter server sandbox:ai-image:single
   ```

5. Unset the confirmation and API key immediately after the process exits.
6. Inspect `tmp/ai-image-sandbox/<operation-id>.report.json`, the immutable intent under `tmp/ai-image-sandbox/intents/`, and the returned image. Verify image count, MIME type, dimensions, byte length, SHA-256, requested semantics, and absence of unexpected text, logos, watermarks, or product changes.
7. Take the settled billing snapshot and run the dark-state verifier again.

This lane has no automated reconciliation mode. If its report is `RECONCILIATION_REQUIRED`, use only the relay dashboard, billing ledger, request logs, or Provider support to resolve the original request. Do not call the submit command again.

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
| `AI_IMAGE_SANDBOX_ADAPTER_REVISION`                | Must match the original intent and deployed CLI          |
| `AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256`       | Must match the original source digest                    |

Do not set the paid `SUBMIT` confirmation. Quoted and maximum costs, language, terminology, and source URL evidence remain bound by the original intent. Source path, raw source URL, language, terminology, and cost variables are not read in `RECONCILE`; do not set replacements for them.

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
