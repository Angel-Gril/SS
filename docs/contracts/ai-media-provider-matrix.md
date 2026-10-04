# AI Media Provider Capability Matrix

Status: **normal generation uses configured adapter contracts; supplier billing evidence is separate (2026-09-15)**

The server registry describes implemented operation/input contracts. Normal routes, workflow services and workers share `canRunAiImageProviderOperation`; configured standard adapters do not wait for a supplier invoice or a separate manual sandbox promotion. The independent sandbox evidence fields record actual transport observations and do not guarantee visual quality. Feature flags, tenant authorization, credentials, frozen prices, quotas and media/network limits still apply.

| Provider         | Model scope                                                                  | Current operations                | Inputs                                                                    | Result                        | Evidence level                              |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `fake`           | local non-production lifecycle wildcard                                      | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `IMAGE_TRANSLATE` | zero references for text-to-image; owned reference(s) for derived operations | sync                          | local test only                             |
| `dashscope-wanx` | preset `wanx2.1-t2i-turbo`; legacy model wildcard retained for compatibility | `TEXT_TO_IMAGE`                   | no source asset                                                           | async task + URL download     | adapter characterized, not sandbox verified |
| `dashscope-wanx` | exact `wanx2.1-imageedit` | `FULL_EDIT`, `INPAINT` only | one owned 1024x1024 source; one matching mask only for inpaint; bounded JSON/data URLs and a complete 800-character prompt | async task + bounded polling + URL download | official Beijing edit transport verified; per-image visual review remains required |
| `openai-images`  | exact `gpt-image-1`; legacy wildcard remains text-to-image compatibility only | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, `INPAINT` | multipart; up to 16 references, with one mask only for inpaint | sync JSON (`b64_json` or URL) | adapter characterized, **not sandbox verified** |
| `custom` | exact model configured per environment; wildcard is compatibility only | `TEXT_TO_IMAGE` | no source asset | OpenAI-compatible sync JSON (`b64_json` or URL) | adapter characterized, exact host/model not sandbox verified |
| `dashscope-qwen-mt-image` | exact `qwen-mt-image` model                                         | `IMAGE_TRANSLATE`                 | one owned HTTPS/public source URL; `imageSegment=false`                   | async task + immediate URL download | sandbox verified transport; mandatory candidate review |

Normal single-image admission supports registered operations at the official OpenAI endpoint, implemented operations at the official Beijing Wanx endpoint, and text-to-image through an administrator-configured custom OpenAI-compatible endpoint. Custom text models may use the declared compatibility wildcard; that wildcard does not claim `sandbox-verified` status or enable reference/masked editing. Unknown providers, unsupported operations, mismatched transports and unregistered custom editing remain rejected. Selecting `openai-images` cannot route credentials to a relay. Registration does not enable feature flags or tenant rollout. Suite/batch and image-translation gates retain their separate contracts.

## Normal Task Admission And Charging

The exact Wanx edit model does not inherit the text-to-image wildcard or enable suite/reference generation.
Its normal manual-edit path selects the explicit `ai-image-wanx21-edit-prompt/v1` rendering contract,
preserves custom template text, and binds the complete resolved prompt and rendering metadata in the
workflow snapshot. Admission and dispatch reject non-square or non-1024 canvases; there is no automatic
resize or crop. A wrong-sized Provider result remains unreviewable and retains its accepted task identity
for reconciliation. The hosted logical Provider name is `dashscope-wanx`; the low-level adapter name
`dashscope-wanx21-image-edit` is not an alias for reusing historical sandbox capability evidence.
The configured base must canonicalize to the exact API base used by the adapter (including `/api/v1`),
and capability evidence must match that endpoint, model, operation and `base64/async` transport.
Revision-bound Wanx manual edits now support read-only restart recovery: one task GET and, on success,
one bounded image GET, using the original task identity and a deadline no later than 24 hours after
the original dispatch. Versioned runtime contracts bind non-secret SystemConfig record ID, revision and
update time from the same snapshot as the Wanx credential; missing bindings, empty credentials, legacy
Wanx v1 jobs and credential rotations fail closed. New explicit-currency quotes use runtime v3; legacy
v1/v2 quotes retain their original USD interpretation.
Recovery reuses the foreground raw/composite/normalization/review path, preserves the original
invocation and acceptance evidence, and fences writes by current workflow attempt and unexpired
reconciliation lease. Cancellation retains only raw output. Existing terminal billing decisions
remain authoritative. UNKNOWN, expired lookup records and HTTP 404 do not prove an empty result and
never authorize blind resubmission. A stable task confirmed to have failed with no output releases its
ERP task reservation at zero, without claiming anything about the supplier's invoice. Valid successful
images are charged once at the task's confirmed unit price times its successful image count; Provider
money fields and later price changes cannot override that quote. New Wanx prices use CNY minor units
(CNY 0.14 is 14), and budgets are evaluated within each quote currency without inventing exchange rates.
Supplier free quotas and final invoices are independent from ERP task charging.

- Exact provider, normalized endpoint digest, model, request profile, request shape, input transport, size, and verified reference-count limits.
- Result form and maximum fetch/poll window; temporary URLs must be internalized immediately.
- Cancellation and retry behavior, including accepted-but-unrecorded reconciliation.
- A confirmed positive per-image price, explicit quote currency and bounded reservation; successful image count drives the final task fee.
- Executable fixtures and recorded results for identity consistency, Russian readability, and Chinese-text residue. The current JSON files are threshold-policy scaffolds only.
- A route/worker preflight that rejects unsupported combinations before quota or cost reservation and revalidates before submission.

No localhost/private URL may be sent to a cloud provider. A signed URL is valid only when its TTL exceeds the documented provider fetch and polling window. Normal task snapshots bind transport-relevant identity, dimensions and price before dispatch; external billing observation is not a prerequisite for those fields or for successful task charging.

## Local Single-Submit Smoke (2026-07-21)

One explicitly confirmed local request characterized the configured custom OpenAI-compatible relay with exact model `gpt-image-2-count` for `TEXT_TO_IMAGE` only:

- exactly one `POST /v1/images/generations` with `n=1`; no queue, retry, object-storage upload or SystemConfig mutation;
- one synchronous normalized result, PNG, `1024x1024`, 1,175,118 bytes;
- 62,410 ms elapsed; output SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`;
- local visual inspection confirmed one nonblank, text-free studio product image;
- the image and sanitized local report remain under ignored `tmp/`; API credentials and the raw response were not persisted.
- the reusable sandbox now claims an immutable operation intent, fingerprints the complete normalized API Base, verifies the exact endpoint plus prompt hash/size/allowed body fields, pins the validated public DNS records for the actual connection, and rejects a second POST across retries.
- the current sandbox profiles distinguish `1024x1024` square from a `1024x1536` (2:3) Provider portrait canvas that is normalized crop-safe to the final 3:4 Ozon slot, and single-image multipart fields from unverified multi-reference requests.

This is a transport smoke, not `sandbox-verified` capability evidence. It used a different model from the current international configuration. Actual price, repeated success rate, Ozon portrait quality, image-to-image, edits, masks, async tasks and image translation remain unverified and disabled.

## Configured International Relay Observation (2026-07-24 to 2026-07-25)

The current international third-party OpenAI-compatible relay and exact model `gpt-image-2` were checked while every production entry point remained dark.

- One bounded `TEXT_TO_IMAGE` request returned one nonblank PNG (`1254x1254`, 1,382,065 bytes). Its private schema-v1 evidence records one create request and a stable output hash, but `actualCostCents` is still `null`; it is not sufficient for capability promotion.
- `IMAGE_TO_IMAGE` was definitely rejected with HTTP 400 on both the earlier adapter and commit `9e62d86809a138fb8c8b26c08af119f6af5b5ee4`. The current request used the corrected single-image multipart field (`image`, not `image[]`) and the frozen `OPENAI_SQUARE_SINGLE_V1` profile.
- Because `FULL_EDIT` and `INPAINT` use the same rejected `/images/edits` transport, no additional paid requests were sent. Neither operation is supported by current evidence.
- The relay's model catalog lists `gpt-image-2`, but its model-detail route returns an HTTP-200 `model_not_found` envelope. Connection checks now validate the exact model against `/models` and explicitly state that catalog access does not verify generation or editing.

The current relay is therefore a text-to-image-only candidate. Reference generation, full-image editing, masked inpaint, suite execution, tenant rollout and billing settlement remain blocked. Do not add a `sandbox-verified` registry entry or enable a production feature flag for this host/model until a compatible edit-capable model or endpoint passes a separately bounded acceptance.

A sanitized read-only audit on 2026-07-29 found both VPS environments on deployed revision
`c98a2e42479cd7f67050e31434724df720fec0fc`. International still had the third-party relay stored
under the legacy `openai-images` label with model `gpt-image-2`, a configured credential, zero price,
generation disabled, and every AI media/extension rollout flag off. Domestic had no configured image
Provider or credential. One bounded authenticated `GET /models` on the international relay returned
HTTP 200 and exactly one model ID, `gpt-image-2`; it exposed no alternate edit-capable candidate and
performed no generation or edit request. The runtime contract now independently rejects a
third-party base labeled `openai-images`, including a matching legacy v1 frozen contract, before
generation/edit Provider resolution. Relays remain valid only under the explicit `custom` identity;
changing that label does not upgrade the already rejected model's editing capability.

The official bare origin `https://api.openai.com` now canonicalizes to its effective transport base
`https://api.openai.com/v1`. A pre-existing v1 contract frozen by older code from the bare-origin
text therefore fails closed and must be recreated; contracts already frozen from the normal `/v1`
base keep the same endpoint hash. Do not release or silently retry any historical paid reservation
that fails this check. Reconcile it explicitly before enabling a paid media flag.

Sandbox capability promotion is now operation-specific. A `sandbox-verified` registry entry must
carry one or more `sandboxEvidence` bindings containing the canonical `endpointSha256`, exact
operation, input transport, and result mode. The generation, edit, translation, and paid-suite
dispatch boundaries compare the active endpoint and request mode against that binding before any
Provider request. The top-level `evidenceLevel` string alone is not authority, and evidence for
`TEXT_TO_IMAGE` cannot unlock `IMAGE_TO_IMAGE`, `FULL_EDIT`, `INPAINT`, or `IMAGE_TRANSLATE`.
The static provider contract also rejects wildcard, malformed, duplicated, or operation-incomplete
sandbox evidence.

## Controlled DashScope Translation A/B (2026-07-24)

The observation below is historical. On 2026-10-04, seven synthetic Chinese product
images exercised the exact official `qwen-mt-image` public-URL/async transport, one
submission per image. All tasks returned decoded results; five passed manual image
review and two were rejected for title fidelity or Chinese residue in a size table.
The transport capability is registered for `IMAGE_TRANSLATE` only. This registration
does not claim error-free translation or enable a feature flag. Every result remains
subject to review before draft application. The controlled rollout retains the
existing owner/shop/device scope and explicitly enables translation as a third
operation; CN stays dark. Task fees use the confirmed server single-image price,
reservation and success settlement. Provider invoices were not read or required to
claim these ERP task-fee semantics. Private source/results and reports are indexed
only by the current internal acceptance owner.

One controlled synthetic `en` to `ru` A/B exercised the official DashScope `qwen-mt-image` adapter while every production entry point remained dark. The reviewed semantic request inputs used the same source bytes, language pair, model, adapter and domain context; the terminology glossary was the only changed translation input.

- Without a glossary, the model changed the meaning of the product and capacity labels.
- With exact product terminology, the output used the correct Russian product and capacity wording while preserving the reviewed layout.
- Both reports still recorded `actualCostCents: null`; quoted and maximum audit fields are not settled billing evidence.
- This A/B covered `en` to `ru` only. The production-equivalent Chinese marketplace `zh` to `ru` path, category terminology, representative quality corpus and settled charge remain unverified.

The result demonstrates that glossary control is required for this tested sample. It does not promote `dashscope-qwen-mt-image` beyond `adapter characterized`, does not satisfy Unit 0B, and does not authorize tenant or production dispatch. The translation feature and paid Provider path must remain dark until the missing `zh` to `ru`, quality and billing evidence passes review.

## Listing-Copy Prompt Foundation

`listing-copy.title` and `listing-copy.description` use versioned Prompt revisions with template-specific variable schemas. Their non-editable safety prefix requires supplied source facts and confirmed attributes, prohibits invented claims, and labels the output as `listing_copy_candidate`. Managed system bootstrap releases upgrade to the current richer Ozon defaults, while any administrator-published release remains authoritative and is never replaced by bootstrap reconciliation.

Fact JSON is parsed as an object, recursively checked for sensitive transport/account fields, bounded by UTF-8 bytes, depth and node count, then serialized deterministically before template rendering. Text variables and the combined variable set have separate byte limits. Admin preview, PASS testing and runtime resolution all enforce the final compiled Prompt limits. The frozen resolution snapshot records the candidate-only output mode and variable-schema version.

The admin API exposes explicit response DTOs. Internal variable `token` names are returned only as `placeholder`; unknown service fields, actor IDs and provider details are not copied into responses.

This registry slice does not call a text Provider and does not apply a candidate to listing or Ozon publish fields. Provider execution, candidate persistence, review and explicit application remain separate Unit 7B work.
