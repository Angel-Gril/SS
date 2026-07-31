# QA-02 Relay Pricing Audit

Audit date: 2026-07-30 (Asia/Shanghai)

## Scope and verdict

The public portion of this audit used only unauthenticated first-party `GET`/`HEAD` requests to
the relay, its documentation site, and its published frontend assets. A later secret-safe
follow-up used the private credential only for bounded authenticated read-only endpoints. No Key,
raw account response, or private billing log is stored here. No paid image request or `POST`
endpoint was used during those pre-call audit steps. The later authorized outcome is recorded in a
separate section below.

**Verdict: the public and authenticated read-only evidence does not establish the Provider's
account-specific price for `gpt-image-2-count`, but that missing Provider record does not by itself
block the selected QA-02 policy.** The relay publishes reference prices for the different model
name `gpt-image-2`, and the account can see the `-count` alias. QA-02 will instead use a private,
versioned backend pricing policy for one bounded request and will reconcile the actual Provider
meters afterward. The unknown Provider pricing facts must not be presented as advance proof of the
charge.

## First-party evidence

### Published GPT-Image-2 documentation

Source: <https://docs.big-model-api.top/api/gpt-image-2>

The page identifies the API base as `https://ai.big-model-api.top/v1` and says the
`model` parameter is **fixed to `gpt-image-2`** for both generations and edits. Its
Generations section states:

> 以下是当前单张图片参考价格

and publishes this table:

| Quality | Published reference price | Published unit |
| --- | ---: | --- |
| `low` | `¥0.007` | one image |
| `medium` | `¥0.06` | one image |
| `high` | `¥0.26` | one image |

The same page says `n` defaults to `1`. The table is under the Generations section.
The Edits section documents full-image editing and mask editing, but does not publish a
separate edit price or explicitly say that the generation table also governs edits.

The exact string `gpt-image-2-count` is absent from this page. It is also absent from all
54 documentation routes enumerated by the documentation site's own VitePress hash map at
<https://docs.big-model-api.top/>.

The page response reported `Last-Modified: Tue, 09 Jun 2026 07:33:34 GMT`. Its immutable
page-data asset is
<https://docs.big-model-api.top/assets/api_gpt-image-2.md.BWxm-dtQ.lean.js>. These are
transport/build identifiers, not a stated pricing effective date or pricing revision.
The page itself does not state when the prices took effect or when they were last revised.

### General pricing documentation

Source: <https://docs.big-model-api.top/guide/pricing>

The official guide says:

> 最新价格请查看：官网模型广场

and:

> 具体的价格信息请访问官网查看最新定价。

It also explains that charges can be affected by a billing-group multiplier. The guide
therefore does not establish that the static GPT-Image-2 reference table is the exact
price applicable to a particular authenticated account, group, or alias.

### Live public status

Source: <https://ai.big-model-api.top/api/status>

The live status response reports:

- pricing is enabled with `requireAuth: true`;
- `quota_display_type` is `CNY`;
- `display_in_currency` is `true`;
- the official documentation link is `https://docs.big-model-api.top`;
- the running gateway version is `v1.0.0-rc.20`.

Together with the documentation's use of `¥` and `元`, this supports interpreting the
published `gpt-image-2` reference prices as CNY/RMB. It does **not** establish a CNY price
for `gpt-image-2-count`. The status response also contains a generic system `price` field,
but it is not labelled as a model price and must not be repurposed as one.

### Live pricing endpoints and frontend source

Sources:

- <https://ai.big-model-api.top/api/pricing>
- <https://ai.big-model-api.top/api/ratio_config>
- <https://ai.big-model-api.top/static/js/index.8e79f50e09.js>

Observed unauthenticated behavior:

- `/api/pricing` returned HTTP `401` with `Unauthorized, not logged in and no access token provided`.
- `/api/ratio_config` returned HTTP `403` with `倍率配置接口未启用`.
- The relay's first-party frontend bundle identifies `/api/pricing` as its pricing data
  source. The exact alias `gpt-image-2-count` was absent from all five first-party JavaScript
  bundles referenced by the relay homepage.

This confirms that the live, account-relevant pricing source is gated and that the static
frontend does not supply an exact price for the candidate alias.

### Authenticated read-only follow-up

A single authenticated `GET /v1/models` returned HTTP `200`, listed one model, and included the
exact identifier `gpt-image-2-count`. The raw catalogue remains outside the repository under the
private QA-02 evidence root. Its retained SHA-256 is
`a9c6be5ec39d9764ce6d04fe89be106de8101fd733ce4e394ae08fef38033c4d`.
This proves only that the account can see the alias; it does not prove generation, edit, inpaint,
async, or pricing behavior.

Read-only account endpoints also established the relay's billing display configuration as CNY,
with `quota_per_unit = 500000` and `usd_exchange_rate = 1`. `/api/usage/token/` can provide an
integer quota observation, while `/v1/dashboard/billing/usage` provides a decimal
`total_usage` observation. Private before/after snapshots must bind both meters during finalization.
For a charge of `CNY 0.0119`, the expected paired evidence is a raw quota delta of `5950` and a
displayed total-usage delta of `1.19`; this is a reconciliation expectation, not advance proof of
the model's price.

The operator supplied `CNY 0.0119 per image` as planning input. `/api/pricing` requires a logged-in
session plus its user header; the API Key alone did not expose the account-specific pricing record.
That Provider endpoint is not a prerequisite under the selected policy. Before a paid request, the
backend/operator must retain a private policy revision that binds the exact alias/account reference,
operation, quality, size, image count, currency, quote and single-request maximum. The policy must
be explicitly reviewed and its revision copied into the approval; it does not become a Provider-side
hard cap, so the paired before/after meter reconciliation remains mandatory.

## Provider facts versus backend policy controls

| QA-02 control | Provider evidence / policy source | Status |
| --- | --- | --- |
| Exact model identity `gpt-image-2-count` | Authenticated model catalogue lists the exact alias | Present for catalogue visibility only |
| Exact model-to-upstream/alias mapping | Not published; exact alias is bound in the backend policy | Policy-controlled; Provider mapping remains unknown |
| Currency | Authenticated billing configuration and public status both use CNY display | Policy must bind CNY |
| Generation billing unit | Per image reference exists for `gpt-image-2`, not the alias | Policy supplies the bounded quote; actual meters settle it |
| Reference-image/full-edit/inpaint price | No explicit Provider price is published | Each operation must be explicitly priced or left unsupported in policy |
| Size-dependent pricing | Provider interaction is not specified | Policy binds one exact size/profile per request |
| Account/group multiplier | Exact applicable group is unavailable publicly | Policy binds the account reference and post-call reconciliation catches variance |
| Pricing effective date/revision | Provider revision unavailable | Backend policy revision is required |
| Binding maximum charge for one request | Provider cap unavailable | Backend policy and approval must bind the maximum |

## QA-02 decision

Do not use the `gpt-image-2` reference table as authorization to charge
`gpt-image-2-count`. No Provider pricing synchronization is required. Before any paid request,
retain a private, timestamped backend pricing-policy record for the exact proposed request that
states:

1. the exact model identifier and account reference;
2. the quote and currency for the selected operation;
3. the fixed `quality`, `size`, and `n`;
4. the backend policy revision/effective time;
5. the resulting single-request maximum charge.

Until that policy is reviewed and the operator explicitly approves the maximum, QA-02 remains
blocked. A successful settlement must still prove the actual paired meter deltas; if they exceed
the approved maximum, retain `COST_LIMIT_EXCEEDED` and do not promote the capability.

## Post-audit text-to-image outcome

After the pre-call audit, the backend retained pricing policy SHA-256
`27894dfcb1bfd43cd18d1873f3d7484e726fe55bc273b910874ea8d733ea2335`, and the operator explicitly
approved one `TEXT_TO_IMAGE` request for `gpt-image-2-count`, `1024x1024`, `n=1`, with quote and
single-request maximum both exact `CNY 0.0119`. The request was submitted once and was not retried.
It returned one accepted 1024x1024 PNG.

The retained before/after account snapshots showed raw quota delta `5950` and displayed usage delta
`1.19`. The authenticated Token-log snapshot identified exactly one matching consume entry. The
network-free finalizer recorded a sanitized v4 receipt with `billingOutcome=CHARGED`,
`billingGate=PASS`, and actual/quoted/maximum exact `CNY amount=119 scale=4`; its SHA-256 is
`83ec0e913baefe0cfb5145d983ce48bf237865d0479725354d792c1e8b9b0423`.

This outcome validates the private quote and maximum for that one request. It does not establish a
Provider-published list price, future price, reference-edit price, full-edit price or inpaint price,
and it does not authorize another POST. Live Provider pricing synchronization remains unnecessary;
each later edit operation still requires its own versioned backend price/limit record, explicit
maximum approval and post-call reconciliation.

## Post-audit image-to-image outcome

The operator later authorized one separate `IMAGE_TO_IMAGE` request for the same alias/profile and
the accepted mug source, with quote `CNY 0.0119` and maximum `CNY 1.0000`. The private policy SHA-256
was `012c98966d76c55ed7c3874d974396742b4b942d942b1929b5f569d65821979b`. The request was submitted
exactly once and was not retried.

The Relay returned a definite `REJECTED` result after `155 ms`, without a Provider request-ID hash.
Raw quota and displayed usage both remained unchanged, and the retained Token log had no matching
consume entry. Exact receipt v3 SHA-256
`c05aaa7e31a545e0be6a5107a7300e30d4d10f2ef634d7472a51dd064f5db855` records `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`.

The outcome supplies negative compatibility evidence, not an edit price. The current
endpoint/`gpt-image-2-count` pair must be treated as text-to-image-only. Full edit and inpaint share
the rejected edit transport and should not be dispatched without selecting a different
edit-capable endpoint/model and beginning a new bounded approval sequence.

## Alternate candidate public preflight

The operator supplied `https://ai.centos.hk` as a different candidate endpoint. Its API Base
canonicalizes to `https://ai.centos.hk/v1`. Local DNS returned proxy/TUN fake-IP addresses in
`198.18.0.0/15` and `fdfe::/16`, so those local answers were not treated as Provider evidence.
Independent lookups from the international VPS and public resolvers `1.1.1.1` and `8.8.8.8`
returned the same three Cloudflare public IPv4 addresses: `104.26.14.134`, `104.26.15.134`, and
`172.67.70.185`, with no AAAA or CNAME answer. The repository URL/SSRF validator accepted the
canonical API Base from clean checkout `5f6d3dd8ccac5e060189bec427400cc06c3a97ec` on that VPS.

TLS 1.3, SNI, and hostname verification passed for all three public addresses. The observed leaf
certificate covers `*.centos.hk` and `centos.hk`, is issued by Let's Encrypt `YE2`, and is valid
from `2026-06-20T02:06:57Z` through `2026-09-18T02:06:56Z`. Unauthenticated bounded GET checks made
no redirects: `/` returned `200`, `/v1` returned the expected JSON `404`, `/v1/models` returned
`401`, and `/api/status` plus `/api/pricing` returned `200`.

The public pricing response has pricing revision `a42d372ccf0b5dd13ecf71203521f9d2`. Under the
site's CNY display configuration it lists `gpt-image-2` with `quota_type=1` and
`model_price=0.1`, but its advertised endpoint metadata includes only
`image-generation -> POST /v1/images/generations` and `openai -> POST /v1/chat/completions`.
It does not advertise `/v1/images/edits`. Therefore the public record is neither an edit-capability
claim nor a cost authorization. Provider pricing synchronization remains unnecessary; any paid
probe still requires an exact private backend quote and one-request maximum.

The first-party frontend asset
`https://ai.centos.hk/static/js/index.b91aa80891.js` does contain one generic
`/v1/images/edits` route constant alongside other gateway routes. The observed asset SHA-256 is
`8af9a0524dc9724e4c6c96acb5ef93377747103b21710ef6f0ee8100cff0a243`. That proves only that the
gateway UI knows the route name; it does not bind the route to this account, `gpt-image-2`, or an
enabled upstream channel. The public evidence therefore justifies a later bounded capability probe
after credential rotation, but cannot promote edit support by itself.

Raw public status/pricing snapshots and a closed preflight manifest remain outside the repository
under the private QA-02 evidence root. The manifest SHA-256 is
`92d0bf08298d0c9254687ca1e0369200f99dc68c5451180ccf2182937dc3b6b4`; the retained files contain no
credential. The separate frontend-route observation SHA-256 is
`514329392fd9c88cb28f1e95edf010ce19324bef7d7ba681fb2f82af53a9c419`. The credential pasted into
the conversation was considered exposed and was never used. The operator revoked/rotated it and
stored the replacement in a separate current-user DPAPI file outside the repository under the
non-secret revision label `centos-key-rotation-20260730-01`.

One bounded authenticated read-only sequence then used only credential-bearing GET requests with
redirects disabled, no request body, and a 1 MiB response cap. `/v1/models` returned exactly
`gpt-image-2` and `gpt-image-2-2k`; both advertise only `image-generation` and `openai` endpoint
types. The Token's model limit permits exactly those two identifiers. `/api/usage/token/`,
`/v1/dashboard/billing/usage`, and the canonical `/api/log/token` route are readable with the API
Token. The Token log contained zero entries.

After the catalogue/account checks, the Token-usage, displayed-usage, and Token-log response bytes
were each identical to their corresponding pre-check response. The GET-only sequence therefore
made no Provider image operation and consumed no quota. The closed private read-only summary v3 has
SHA-256 `6ae534108272abcc84fef7f75abf8114d73304ea7ccca2bdb0283c771c1b510a`; exact and generic
credential scans were clean. This proves credential validity, catalogue visibility, model limits,
and usable reconciliation endpoints. It still does not prove that either listed model is accepted
by `/v1/images/edits`, so a separately priced and explicitly authorized one-request edit probe is
required before capability promotion.

## Alternate candidate image-to-image outcome

The operator separately authorized exactly one `IMAGE_TO_IMAGE` request against
`https://ai.centos.hk/v1` using `gpt-image-2`, profile `OPENAI_SQUARE_SINGLE_V1`, `1024x1024`,
`n=1`, and source SHA-256
`481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`. The backend quote was
exact `CNY 0.1` and the approved single-request maximum was exact `CNY 1.0`. Private policy SHA-256
was `f517567b88b83c67fac20d349af1353f9f6f28e65bd3cc74e1b6939a07a13684`; final approval SHA-256
was `e04bddb16a3cd531c0401e4f72bf3a33bec39d28a8d57b51b9353d265f02609f`.

Operation `qa02-centos-i2i-20260730-094857-01` passed the source, checkout, dark-state, billing
snapshot and official no-key approval preflight. The rotated Key was decrypted from DPAPI only in
memory and injected over SSH standard input; it was never placed in a command argument, file or
artifact. The runner made exactly one `/v1/images/edits` POST and did not retry it.

The Provider returned a definite `REJECTED` v5 report after `302 ms`, with `createRequests=1`, no
Provider request-ID hash, and `failureCode=PROVIDER_AUTH_FAILED`. This differs from catalogue
authentication: the same Token still successfully reads `/v1/models`, its Token quota, displayed
usage and Token log. The result therefore establishes that the current Token/model/route is not
accepted for image edits; it does not invalidate the read-only credential evidence and does not
prove generation behavior.

The before/after raw-quota and displayed-usage response bodies were byte-identical, and the Token
log remained empty. Exact attestation SHA-256
`0fd3c0e041db9dc04a3c9e2a829d79856ecccabcdf53af195231a6e70523d4a9` therefore recorded
`NO_CHARGE`. Official receipt v3 SHA-256
`9d1e5db49dc5b76e7de70e36cad88a7429e426b3e93de4207ad62a46c040e2d2` records `REJECTED`,
`NO_CHARGE`, `billingGate=PASS`, `billedUnits=0`, actual `CNY 0.0`, and
`sameRequestRetryAllowed=false`; exact replay returned the same receipt bytes. Both VPS dark
verifiers passed, and exact/generic credential scans of the private retained artifacts were clean.
Private run-summary SHA-256 is
`70c11cbb27e38120781810773cf06c142d59e0b82896abd88f6da32d560fd2dc`.

Do not send `FULL_EDIT` or `INPAINT` using this endpoint/Token/model combination: both would reuse
the same rejected edit transport without new capability evidence. Do not retry the closed request
or substitute a new Operation ID. Full QA-02 still requires another Provider endpoint/credential,
or a Provider-side configuration change that explicitly enables image edits followed by a new
catalogue review, price policy and one-request approval.

## Packy replacement credential read-only outcome

Replacement credential revision `packy-sora-key-rotation-20260801-02` completed the official
GET-only Packy preflight from clean commit
`e4503e9253b15eea5540dd436bf027c713cd3739`. The fixed sequence used seven bounded authenticated
GETs only: before/after raw quota, displayed usage and Token log, with one exact model-catalogue
check. The private eight-file manifest SHA-256 is
`9f3dbc30bf2b78b99ede50bdfd285d3f932580cab1ddc5a52812ae7cbacb7b0f`. Independent verification
confirmed the fixed routes, response hashes and lengths, HTTP 200 JSON records, exact
`gpt-image-2` visibility, byte-identical meter pairs, private ACLs and clean credential scans. The
manifest records no Provider POST and no observed charge.

The private proposed `IMAGE_TO_IMAGE` policy supplies quote USD `0.08` and maximum USD `1.00`
without requiring Provider price synchronization. Policy SHA-256 is
`9b91a0fa1f3e98177ea5d085e3201e9146b617af7368c351f9e1080324f980cb`; the resulting non-approval
schema-v3 draft SHA-256 is
`1f2d3bb6389856ed63c0ea443a6196a250bd8e1606a3aa2d327129aca71976e4`. The draft binds local
prepared source SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`.
It does not reuse the earlier Centos request's source SHA-256
`481527b89ed2e3da85ea1517a10d6227d89c0d17271c92950a98f51a7e044f0b`; those exact bytes are not
present in the local retained evidence. The statement and timestamps remain review sentinels, and
the official offline verifier rejects the draft with `SANDBOX_APPROVAL_SCHEMA_INVALID`. No paid
request is authorized until an operator reviews this exact source-bound request, retains fresh
pre-call meters, and replaces only the three sentinels within a new bounded approval window.

## Packy image-to-image outcome

The operator explicitly approved one `IMAGE_TO_IMAGE` request against
`https://www.packyapi.ai/v1` using `gpt-image-2`, `OPENAI_SQUARE_SINGLE_V1`, `1024x1024`, `n=1`,
source SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`, quote USD `0.08`, and
single-request maximum USD `1.00`. Fresh pre-call manifest SHA-256 was
`e9cef9fb0a2efeefae62646f6bd32345e1782e28982e02d3db1608402ae172df`; final approval SHA-256
was `de530a1d7f4258b713e909d91c444ffa0faf3832f42ad7639b9153a4d8438da4` and passed the official
no-key verifier from clean commit `e4503e9253b15eea5540dd436bf027c713cd3739`.

Operation `qa02-packy-i2i-20260801-e4503e9-01` made exactly one multipart `/v1/images/edits` POST
and was not retried. The Provider returned HTTP 400 after `1118 ms`; authoritative v5 report
SHA-256 `02ab909a2dc4d8cda2858f7291f41ebacb2e3e686f5583419bbdd1d8907a4c3e` records `REJECTED`,
`createRequests=1`, `failureCode=PROVIDER_REQUEST_FAILED`, no Provider request-ID hash, and no image.

The settled GET-only capture had manifest SHA-256
`b64bb39aa4d55cfb38a4c1ba44a1601cc9de605e0823a1e8b226c9e2c2eaf5b4`. Raw quota and displayed
usage both had zero delta, while Token log remained the same canonical empty envelope. Exact v2
attestation SHA-256 `3ce448fe0dfc21d25d4862c03aa0d7c2198da9d3676e4fdee8d27f05fae83e70`
used the exclusive `329871 ms` account window. Official v3 receipt SHA-256
`0107a287f45e6b74e185ea4669057b9b5264f8617d4cc59facaa1ad8950cb363` records `REJECTED`,
`NO_CHARGE`, `billingGate=PASS`, actual USD `0.00`, zero billed units, and
`sameRequestRetryAllowed=false`; exact replay returned identical bytes.

The six-file execution archive manifest SHA-256 is
`43a2a316ba75055442553d4f8d9983f0b9c0d51878c56bb08e7d014bf2e31eaf`, and private run-summary
SHA-256 is `e1e2c54583fd25f817b6d5021b024503303b15db74fbe259738a07ec9dc1c896`. Exact and generic
credential scans across 38 retained files were clean; private ACL checks and the offline dark
deployment guard passed.

This is negative Provider evidence: public Packy documentation and model visibility did not produce
an accepted edit request for this account/model/transport. Do not retry the consumed Operation ID or
reuse its approval for `FULL_EDIT` or `INPAINT`, which share `/v1/images/edits`. A future positive
QA-02 sequence requires a Provider-confirmed request-contract/account correction or another
edit-capable endpoint, followed by new operation-specific policies and approvals.
