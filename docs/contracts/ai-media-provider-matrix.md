# AI Media Provider Capability Matrix

Status: **adapter capability foundation implemented; the Unit 0B media acceptance gate remains open**

The server registry is a fail-closed operation/input guard. Text-to-image job creation checks it before quota reservation and the worker checks every job again before provider submission. It describes current adapter behavior only; it is not paid-provider sandbox acceptance.

| Provider         | Model scope                                                                  | Current operations                | Inputs                                                                    | Result                        | Evidence level                              |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `fake`           | local non-production lifecycle wildcard                                      | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `IMAGE_TRANSLATE` | zero references for text-to-image; owned reference(s) for derived operations | sync                          | local test only                             |
| `dashscope-wanx` | preset `wanx2.1-t2i-turbo`; legacy model wildcard retained for compatibility | `TEXT_TO_IMAGE`                   | no source asset                                                           | async task + URL download     | adapter characterized, not sandbox verified |
| `openai-images`  | exact `gpt-image-1`; legacy wildcard remains text-to-image compatibility only | `TEXT_TO_IMAGE`, `IMAGE_TO_IMAGE`, `FULL_EDIT`, `INPAINT` | multipart; up to 16 references, with one mask only for inpaint | sync JSON (`b64_json` or URL) | adapter characterized, **not sandbox verified** |
| `custom` | exact model configured per environment; wildcard is compatibility only | `TEXT_TO_IMAGE` | no source asset | OpenAI-compatible sync JSON (`b64_json` or URL) | adapter characterized, exact host/model not sandbox verified |
| `dashscope-qwen-mt-image` | exact `qwen-mt-image` model                                         | `IMAGE_TRANSLATE`                 | one owned HTTPS/public source URL; `imageSegment=false`                   | async task + immediate URL download | adapter characterized, **not sandbox verified** |

Wildcard model entries exist only to avoid breaking historical text-to-image jobs. A wildcard entry can never count as `sandbox-verified`. The normal routes and Workers reject every non-fake operation while its exact capability is below `sandbox-verified` or its verified cost is not positive; selecting `openai-images` cannot be used as an alias to send an arbitrary Base URL into the paid queue. The exact `gpt-image-1` multipart generation/edit transport is registered so its request, input and result contracts can be tested, but registration is not activation: image-to-image, full edit, masked inpaint and multi-reference execution remain dark until sandbox evidence is promoted. Future activation also requires a frozen normalized endpoint/config hash and non-secret credential revision on each job. Provider cancellation remains unsupported. The qwen-mt-image adapter is implemented as a resumable submit/poll contract with frozen positive/constraint Prompt provenance, bounded recovery, and cost reservation; paid dispatch remains blocked until Unit 0B sandbox evidence and a positive verified price upgrade its capability level.

## Required Evidence Before Enabling A Capability

- Exact provider, normalized endpoint digest, model, request profile, request shape, input transport, size, and verified reference-count limits.
- Result form and maximum fetch/poll window; temporary URLs must be internalized immediately.
- Cancellation and retry behavior, including accepted-but-unrecorded reconciliation.
- Measured cost or a bounded reservation estimate.
- Executable fixtures and recorded results for identity consistency, Russian readability, and Chinese-text residue. The current JSON files are threshold-policy scaffolds only.
- A route/worker preflight that rejects unsupported combinations before quota or cost reservation and revalidates before submission.

No localhost/private URL may be sent to a cloud provider. A signed URL is valid only when its TTL exceeds the documented provider fetch and polling window. Transport, timing, dimension and cost fields are intentionally absent from runtime acceptance until sandbox evidence exists.

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

## Controlled DashScope Translation A/B (2026-07-24)

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
