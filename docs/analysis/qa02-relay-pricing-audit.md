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
The request count proves HTTP dispatch and response only; it is not evidence that Packy created an
edit task. The zero consumption log is therefore consistent with this rejected, unbilled outcome.

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

Packy's public instructions require a `sora`-group token. The retained authenticated GET evidence
shows token name/quota and model visibility but does not expose the token group, so the non-secret
credential revision label cannot independently prove that account setting. A future Packy test
must first confirm the exact group and use either Provider-confirmed route support or a materially
different reviewed request contract.

The operator has since confirmed through MOSS that the active credential belongs to the Sora group.
This closes the group-identification question as an operator assertion only. It does not turn the
HTTP 400 into an accepted task or independently establish that `/v1/images/edits` is enabled for
this account.

The follow-up offline implementation also closes a false-positive evidence path: returned images
must fully decode as one bounded frame and exactly match the approved dimensions before the runner
writes `SUCCEEDED`; candidate review independently cross-checks `requestedSize` against reported
width and height. A post-acceptance media failure remains reconciliation-required and preserves the
known Provider request-ID hash.

This is negative Provider evidence: public Packy documentation and model visibility did not produce
an accepted edit request for this account/model/transport. Do not retry the consumed Operation ID or
reuse its approval for `FULL_EDIT` or `INPAINT`, which share `/v1/images/edits`. A future positive
QA-02 sequence requires a Provider-confirmed request-contract/account correction or another
edit-capable endpoint, followed by new operation-specific policies and approvals.

## Packy documented edit-profile preparation

The rejected request used `OPENAI_SQUARE_SINGLE_V1` and omitted Packy's documented edit-specific
fields. A new offline-only `PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` profile now binds exact API Base
`https://www.packyapi.ai/v1`, endpoint `/v1/images/edits`, model `gpt-image-2`, `1024x1024`, `n=1`,
and multipart values `quality=high`, `output_format=png`, and `response_format=url`; optional
`input_fidelity` stays omitted. Provider adapter, sandbox guard, approval drafting and submission
reject profile/endpoint/model mixing before dispatch, and the immutable adapter revision includes
the profile module.

At this preparation checkpoint, this was a materially different candidate request, not a retry or
renamed copy of the consumed operation. It had not been sent and had incurred no charge. It still
required a new clean implementation commit, new Operation ID, new private policy and non-approval
draft, fresh pre-call meters, and a new explicit source-bound single-request maximum approval before
any Provider POST.

Implementation commit `9b6cc058091837aa17641871c94138e9c164c0a6` is pushed. From a detached
private checkout, proposed operation `qa02-packy-i2i-documented-20260801-9b6cc05-01` produced
pricing-policy SHA-256 `8744574db12812666ba16b4a7725d8dd617fcddb03b7f98bd722ae4dd002977c`
and schema-v3 non-approval draft SHA-256
`1bad6cdb203914f54dfb1935b6c50b977cd2b0f9e8c6f4427e9bc253bd061da1`. The draft binds source
SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`, keeps its statement and
timestamp sentinels, and fails official no-key verification with `SANDBOX_APPROVAL_SCHEMA_INVALID`.
Private ACL and digest checks pass. The credential was not read and no Provider request or charge
had occurred at that point; USD `0.08`/USD `1.00` remained proposed values pending a new exact
approval.

## Packy documented edit-profile outcome

The operator subsequently approved that exact request. Final approval SHA-256 was
`791cced1ebf2cffd37d750c6a99c45d3b1efe4f76fb6e2fac65f7ba26d580198`, and fresh pre-call manifest
SHA-256 was `0916cb23af6d79034de743574bdfade8b16cb98199d9914b2e482608360cab42`.
Operation `qa02-packy-i2i-documented-20260801-9b6cc05-01` sent exactly one
`PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1` multipart POST and was not retried. The request included
`quality=high`, `output_format=png`, and `response_format=url`, omitted `input_fidelity`, and used
the operator-confirmed Sora-group credential. Packy returned HTTP 400 after `991 ms`. Report v5
SHA-256 `2ce500d9eb064e324216320d5f972bcdeb1748aeeb2242be68c3f2d1960460ae` records `REJECTED`,
`createRequests=1`, `PROVIDER_REQUEST_FAILED`, no Provider request-ID hash, and no image.

The settled seven-GET manifest SHA-256 was
`57c33eb2e05eab8687cabac92d80162361e3bd8f96e9e530cd4e59a084c0b954`. Raw quota, displayed total
usage, and the empty Token log remained byte-identical to the pre-call values. Exact attestation
SHA-256 `9bfcbf8d4de39772a5d3a3fe966be6b9c677d2a00ee11f1d907c0bbf93ce3dff` therefore recorded
`NO_CHARGE`. Official receipt v3 SHA-256
`c62bbc576368df51e72406023ff9e2a4be2551498d0fd3f7f5ef7d5a6e342d36` records `REJECTED`,
`billingGate=PASS`, actual USD `0.00`, zero billed units, and `sameRequestRetryAllowed=false`.
Exact replay returned the same receipt bytes.

The sanitized six-file archive manifest SHA-256 is
`3a59161e3fd4da8e9b6aa9b4054189513bff076591c1eb006063e8232f7c97cc`; private run-summary SHA-256
is `4c0c402ad872b13dd2204c1f0fc6b54d1e42fd9884542378abb9ccf5e9ac81fa`. Exact Token and generic
credential scans found zero matches, while all private ACL and reparse-point checks passed.

This outcome removes the earlier ambiguity about omitted documented fields: the documented Packy
contract also failed before an accepted task or charge. It does not establish that edits are
unsupported for every Packy account, but it is conclusive negative evidence for this account,
credential revision, model, endpoint, and contract. Do not retry this Operation ID, rename the same
request, or send `FULL_EDIT`/`INPAINT` through the same route. The next positive QA-02 attempt needs
a Provider-confirmed material route/account/contract change or a different edit-capable Provider,
followed by a new operation-specific price policy, approval, settlement, and human quality review.

## Xiaoyi edit candidate public preflight

The replacement candidate publishes a first-party image API guide at
`https://xiaoyiapi.xyz/docs/api/images/`. It explicitly documents synchronous multipart
`POST /v1/images/edits` and asynchronous `POST /v1/images/edits/async` at API Base
`https://image.xiaoyiapi.xyz`, with `gpt-image-2` in the synchronous edit example. Its public
status independently identifies `https://image.xiaoyiapi.xyz/v1` as the long-running image API
Base. Public resolvers returned one A record, `23.144.68.169`, and no AAAA record. TLS hostname
validation exposed a certificate for `image.xiaoyiapi.xyz` valid through 2026-10-03.

Public pricing revision `a42d372ccf0b5dd13ecf71203521f9d2` lists `gpt-image-2` at USD `0.07`
before account-group adjustment. The listed groups have different ratios, so this is planning
input rather than authorization or proof of the selected Token's charge. The status record uses
USD display and `500000` quota units per currency unit. As with earlier candidates, live Provider
price synchronization is unnecessary: a paid request still needs a private exact quote, explicit
single-request maximum, and post-call reconciliation.

The image subdomain intentionally rejects account-meter routes. Token quota, displayed usage and
Token log live on `https://xiaoyiapi.xyz`, while model and image routes live on
`https://image.xiaoyiapi.xyz`. The read-only preflight now supports this exact reviewed dual-origin
identity with independent DNS/SSRF validation and fixed seven-GET routing. It does not accept an
arbitrary billing origin and preserves the historical Packy v1 manifest.

The offline billing finalizer now applies the same bidirectional closed mapping: the Xiaoyi image
API digest can use only the Xiaoyi main-site Token log, and the main-site Token log cannot settle a
different API digest. Existing Providers remain same-origin. The shared identity module is bound by
both executable revision allowlists. Focused preflight, settlement and finalizer tests pass `137`
with five platform skips, including positive Xiaoyi dual-origin settlement and mixed-origin
rejection cases. Full Server tests pass `4616` with 199 platform skips; workspace and sandbox
typechecks, target lint, the static contract and `git diff --check` pass. The complete repository
preflight passes `446` checks with zero failures and two existing extension-permission warnings.

Private public-preflight summary SHA-256 is
`720e0f1273ca4f52db3158ad8afb465ccb9249b9679c363947f1006412628757`. It records no credential
read, Provider POST or charge; generic secret scanning and private ACL checks passed. The credential
pasted into chat is exposed and was not used. It must be revoked and replaced in a separate local
DPAPI record before authenticated GET-only preflight. Positive edit capability remains unproved.

## Xiaoyi authenticated preflight and bounded I2I profile

The exposed credential was revoked and replaced under non-secret revision
`xiaoyi-image-key-rotation-20260801-01`. From clean pushed commit
`f8ee687dbe0faceb73b26a60f9af2543ad003b8d`, operation
`qa02-xiaoyi-readonly-20260801-f8ee687-01` completed the fixed seven authenticated Provider GETs.
The image catalogue returned exactly `gpt-image-2`; raw quota, displayed usage and Token log were
byte-identical before and after. Private manifest SHA-256 is
`db10c7505118ea3c89517e18ae344151a036f36cad720ab7468a3c1797bf1c33`, with no POST or charge.

The paid runner now has a closed `XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1` profile for one synchronous
`IMAGE_TO_IMAGE` request. It binds API Base `https://image.xiaoyiapi.xyz/v1`, endpoint
`/v1/images/edits`, model `gpt-image-2`, one source, `1024x1024`, `n=1`, and multipart fields
`model`, `prompt`, `n`, `size`, and `image`. It does not add Packy fields. The profile and exported
adapter reject request-model override, generic-profile downgrade, legacy cents, `FULL_EDIT`, and
`INPAINT` before dispatch. Offline settlement separately validates exact generation, profile,
operation, model, endpoint/API digests, fingerprint and the reviewed billing origin.

Pricing revision `a42d372ccf0b5dd13ecf71203521f9d2` gives base USD `0.07`; the largest
published ratio among its enabled groups is `2.86`, yielding USD `0.2002`. The proposed backend
policy sets the quote to USD `0.210001` and the separately reviewed maximum to USD `1.000000` at
scale `6`. The one-microdollar increment keeps the pair at its canonical minimum shared scale while
representing the published `500000` quota units per USD exactly. This remains
planning input until the clean implementation commit, private policy and non-approval draft are
reviewed and the operator explicitly authorizes the one request. No live Provider price sync is
required.

The final implementation gate passes `302` focused tests with two platform skips and `4646` full
Server tests with `199` platform skips. Sandbox and workspace typechecks, the static contract and
diff checks pass. Repository lint has zero errors and only the existing `20` Server plus one shared
warning. The complete repository preflight passes `446` checks with zero failures and the two
existing local-extension permission warnings. These are offline implementation results only; no
edit POST or charge occurred.

An independent security review found that coupling route identity to the operation allowlist could
make a generic-profile `FULL_EDIT` or `INPAINT` request evaluate both sides of the profile identity
check as false. The final implementation separates exact route/model identity from the
`IMAGE_TO_IMAGE` allowlist in approval, execution, claim and settlement, with internally consistent
downgrade fixtures at all four boundaries.

## Xiaoyi bounded I2I result

The operator approved operation `qa02-xiaoyi-i2i-20260801-f189dfa-01` from clean pushed commit
`f189dfab715ac60e8b168b10c13ac9557a091e29`, with source SHA-256
`5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`, the frozen profile prompt,
quote USD `0.210001`, and maximum USD `1.000000`. The official verifier accepted final approval
SHA-256 `35822efa228a1d04832c720c79f37675243312265c061da6bac5c1694ccfa7ae`.

The guarded runner sent one synchronous multipart `/v1/images/edits` POST and did not retry. The
Provider returned definite HTTP 400 after `1858 ms`. Intent SHA-256 is
`aa38b2eb6a8e63970c1ede9942ecae3d5b6772d0f42bf8c146afe5c6176e386a`; report SHA-256 is
`0457ffa6e5baf87e9127c6de174191dff0e4cf889dddc738ea2849ddbef682d5`. The report records one create
request, `REJECTED`, no Provider request-ID hash and no image, so no human image-quality result can
be claimed.

Pre-call and settled manifest SHA-256 values are
`7c2733516cb08d639a8c2a2099285bbb537448e5d22ff87d9a41650a19e63a30` and
`e845170aa7edc113d488608f7c024fb906ad2464e413e22afb6e642f7f73759e`. Raw quota, displayed usage
and Token log were byte-identical over the `272.716` second exclusive window. Exact no-charge
attestation SHA-256 `c22c5729c1d2a9f611b3abffa79439ce6d9a619c69d55216a6400b1d4b14dfe7` produced v3 receipt
SHA-256 `98bb603e775e0935e8bc2af4f2151f9bcfafdb73be9535516ba049b6ccbb5ad7`. It records
`billingGate=PASS`, zero billed units and `sameRequestRetryAllowed=false`; replay was byte-identical.
Six sanitized execution files are retained under archive manifest SHA-256
`f4fa78fc0b35b29acf9b9ecd9184eafaeb8255f9e70f2fa68d11441eb5e3c656`; private run-summary SHA-256
is `f5b3e8a0d1c2ae775b13b849ef7c021ed2266e3de61fc38d4de166ae2ee9aaf5`. Exact Token and generic
secret scans found zero matches, and private ACL/reparse checks passed.

This is conclusive negative evidence for the exact endpoint, account credential revision, model and
profile. Do not retry the Operation ID, rename the same request, or use this route for `FULL_EDIT`
or `INPAINT`. A later Xiaoyi paid test requires a Provider-confirmed material route/account/contract
change and a new profile, policy and approval. `QA-02` remains incomplete.

## Xiaoyi documented minimal V2 result

The first-party synchronous curl contract was isolated as
`XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2`, with logical `1024x1024`, `n=1`, one source, and exactly three
wire fields: `model`, `prompt`, and `image`. The operator approved operation
`qa02-xiaoyi-minimal-i2i-20260801-78fe4c7-01` from clean pushed commit
`78fe4c748fd7c5b6c1c4974467d3342ff6b9cc6a`, using the same source SHA-256
`5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`, quote USD `0.210001`, and
maximum USD `1.000000`. Pre-call manifest SHA-256 was
`8021ef614b8658f3b080a648ff3b31970a11fb7e64ca4dc9a2de0e8ce7cbcc72`; final approval SHA-256 was
`792d75870bd711f210ae565dd49ea1c24eac4bde7678889fb2c15c615a6c28a2`.

The guarded adapter sent exactly one synchronous `/v1/images/edits` POST and did not retry. Xiaoyi
returned definite HTTP 400 after `795 ms`. Intent SHA-256 is
`70177c26fc06a9f339e14660261b4df72e13d0a330330deb0817c75662d19e90`; request-fingerprint claim
SHA-256 is `2893c5db2f5e2623c42f880ff1fb197e831a085bdf3455d46d181d14dd69df61`; report SHA-256 is
`a46f67fbd30dcf0bfc74f64efb5a67af83a625ce8f7c3f5c8b7e09f048b85516`. The report records one
create request, `REJECTED`, no Provider request-ID hash, and no image. This proves that zero usage in
the Provider dashboard did not mean the POST was skipped.

Settled manifest SHA-256 was
`f86ba3b90c7b93ebfcb26bb1b60c885990304fee5cc7e57f1fce0d649de5a3c3`. Raw quota, displayed usage,
and Token log were byte-identical over the `336.430` second exclusive window. Exact no-charge
attestation SHA-256 `06598b9bc6f20e93d0ed20314d42b06475146a88224e86a6bcc89a057ad62218`
produced v3 receipt SHA-256
`5fe9b606e5839b8fe71305e6a48d72b834eb7e697aeb4b1bed68d8853e24f887`. It records
`billingGate=PASS`, zero billed units, and `sameRequestRetryAllowed=false`; offline replay was
byte-identical. Six sanitized execution files are retained under archive manifest SHA-256
`d436381bdff60e751962f44755f2159673d07101582a45f276237ce249cc2b1d`; private run-summary SHA-256
is `5a286b63e1b5b03a28d9403e9c7c1109d4710d241d63e6ad95f1af4b85d7c542`. Exact credential scans
found zero matches, and private ACL/reparse checks passed.

This closes the documented three-field V2 request as negative evidence for the exact Xiaoyi
endpoint, account credential revision, model, and synchronous contract. It must not be retried or
renamed, and it cannot authorize `FULL_EDIT`, `INPAINT`, or async testing. The next paid edit attempt
requires Provider-confirmed account permission or a materially different route/contract, or a
different edit-capable Provider, followed by a new policy, approval, and billing window. `QA-02`
remains incomplete.

## Alibaba Wanx 2.1 async edit implementation checkpoint

The Xiaoyi V1 and minimal V2 HTTP 400 results above remain immutable negative evidence. Selecting
Alibaba Cloud Wanx does not reinterpret, delete, or satisfy them. It provides a materially different
Provider and transport for the next positive capability attempt.

The offline sandbox implementation now has a closed Wanx 2.1 edit identity for legacy Beijing API
Base `https://dashscope.aliyuncs.com/api/v1`, exact model `wanx2.1-imageedit`, and asynchronous JSON
submit/poll flow:

```text
POST /api/v1/services/aigc/image2image/image-synthesis
GET  /api/v1/tasks/<task_id>
```

The single submit uses `X-DashScope-Async: enable`, sends the source as a bounded data URL, polls
only the accepted task, and downloads exactly one reviewed result URL without forwarding Provider
Authorization. It requires one successful image through `task_metrics.TOTAL=1`,
`task_metrics.SUCCEEDED=1`, `task_metrics.FAILED=0`, and `usage.image_count=1`. Any accepted-task
uncertainty is retained for read-only recovery and never causes a second POST.

The three operation identities are intentionally separate:

| Operation        | Profile                                                | Wanx function                 |
| ---------------- | ------------------------------------------------------ | ----------------------------- |
| `IMAGE_TO_IMAGE` | `DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1`             | `description_edit`            |
| `FULL_EDIT`      | `DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1`                  | `description_edit`            |
| `INPAINT`        | `DASHSCOPE_WANX21_INPAINT_ASYNC_V1`                    | `description_edit_with_mask`  |

The claim and offline finalizer recompute a transport-semantic fingerprint that includes
`DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1`, the exact operation/profile, Provider function, Prompt,
source, and mask evidence. `IMAGE_TO_IMAGE` and `FULL_EDIT` cannot share approval merely because
both map to `description_edit`. `INPAINT` converts the local alpha mask deterministically to Wanx
white=edit/black=preserve semantics; the guarded JSON request separately binds the derived
transport-mask digest.

Alibaba's [official Wanx image-edit reference](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference)
reviewed on 2026-08-01 lists `CNY 0.14` per image. This is planning input only, not an
account-specific quote, an operator-approved maximum, a Provider-side spending cap, or
actual-charge evidence. The backend does not need to synchronize a Provider price. Before each of
the three paid operations, retain a separate private pricing-policy revision and obtain explicit
approval for that operation's exact CNY quote and independently selected single-request maximum.
Afterward, reconcile the real before/settled meter; `usage.image_count=1` alone does not prove the
CNY amount.

The Alibaba credential pasted into chat was exposed and was not used by this implementation. No
authenticated Wanx preflight, submit, poll, image download, Provider charge, VPS access,
deployment, feature-flag change, ERP mutation, or Ozon write occurred at this checkpoint. Any
future live validation requires revoking that value, injecting a newly rotated credential only
from private local storage, a clean reviewed implementation revision, and a fresh one-request
approval containing the exact operation, endpoint, model, Prompt, source/mask hashes, quote, and
maximum.

Mocked focused tests cover the async submit/poll/download success path, task recovery without
resubmit, operation/profile rejection, mask conversion, and Wanx request-fingerprint settlement.
This permits downstream offline implementation and rehearsal to continue without fabricating
Provider evidence. It does not complete `QA-02`, does not promote a capability, and does not remove
the positive live-evidence dependency from later release gates. Overall progress therefore remains
`32/37` until real operation-specific Provider, billing, privacy, and human quality evidence is
retained.

### DashScope Wanx catalog-only preflight implementation

The shared read-only helper now has an isolated schema v3 branch for the reviewed legacy
`https://dashscope.aliyuncs.com/api/v1` identity and exact `wanx2.1-imageedit` model. It performs
exactly one credential-bearing GET:

```text
GET /api/v1/models?model=wanx2.1-imageedit&page_no=1&page_size=1
```

The branch retains the existing stdin-only credential, public DNS validation, DNS pinning,
no-redirect, no-cookie, bounded-response, secret-reflection, private-evidence, and clean-revision
controls. It binds each DoH Question, rejects truncated or non-IN responses, and compares the full
A/AAAA CNAME paths. An accepted A or AAAA response must contain a bounded, complete CNAME chain from
the requested host to the terminal address owner. Loops, unrelated records, a missing terminal,
mismatched targets, and chains longer than eight hops fail before credential input. It accepts only
the reviewed DashScope success envelope, fixed single-row pagination, `request_id`, and
`output.models[].model` field, and requires the exact model ID. It rejects workspace-specific hosts,
an injected billing origin, OpenAI-style catalogue envelopes, failed success envelopes, inconsistent
totals, multiple rows, legacy `model_id`/`id` substitutions, and wrong models before they can become
evidence.

The private manifest and sanitized completion event record authentication and exact catalogue
visibility, but also record `billingMeterStatus=SEPARATE_EVIDENCE_REQUIRED`,
`providerPostSent=false`, `chargeObserved=false`, and `editCapabilityVerified=false`. No guessed
DashScope billing endpoint or arbitrary task lookup is used. A successful preflight therefore does
not prove edit permission, price, balance, billing, or positive capability; separate before/settled
Alibaba billing evidence and a successful paid edit remain mandatory.

The first real catalogue-preflight attempt failed before credential input with
`SANDBOX_READONLY_DNS_FAILED` because the original resolver rejected DashScope's legitimate DoH
CNAME owner chain. The proposed evidence ID was not consumed. No credential was decrypted, no
authenticated Provider GET or POST was sent, and no charge occurred. A subsequent credential-free
resolver observation returned public DashScope A and AAAA answers. That observation validates only
the public resolver path; an authenticated catalogue GET has not yet succeeded.

Focused tests pass `95` with four platform skips. Target lint, sandbox TypeScript compilation, the
static contract, diff checks, and the full Server suite (`4735` passed, `199` skipped) pass.
Full repository preflight passes `446/0` with the two existing local-extension permission warnings.
`QA-02` remains `4/5`, overall progress remains `32/37`, and no deployment, flag, ERP ingest, or
Ozon mutation occurred.

### Authenticated catalogue response-shape checkpoint

From clean pushed revision `7001a43e8531f44a3428ec757c63194098f816af`, the repaired DNS path
decrypted credential revision `dashscope-wanx-beijing-rotation-20260801-01` only in the bounded
launcher and sent the fixed catalogue GET exactly once. DashScope returned HTTP 200. The helper
rejected it with `SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID` before evidence persistence because the
live catalogue row uses `model`, whereas the first offline contract required `model_id`. No evidence
directory was created, and no task, synthesis, image download, billing path, or POST was contacted.

A second GET-only diagnostic used the same reviewed URI and a current validated public pin
`39.96.198.249`. It wrote the raw response and headers only to protected local private files. The
1022-byte response SHA-256 is
`a30c5462e64fd10ad118231784569c8f2deb3f9500283c25ebe30ec87e5cf2cb`; header SHA-256 is
`7fe7fe49163ae328bd0fd415d57bae4f7a04c2fbad009a4efdeab017179528ed`. Credential scans of both
files found no match. Sanitized inspection found `success=true`, null `code`/`message`, page `1`,
page size `1`, total equal to one row, and exactly one row whose `model` equals
`wanx2.1-imageedit`. This confirms authentication and model visibility as a response-shape fact, but
it is not an official v3 completion manifest and does not prove edit permission, price, balance, or
billing.

The parser now requires that exact closed envelope and rejects failed success flags, non-null error
fields, extra top-level/output fields, inconsistent pagination/totals, multiple rows, and any row
that mixes `model` with `model_id`, `id`, or error fields. An empty page with total zero passes schema
validation but is rejected as exact-model unavailable. The endpoint/query are corroborated by the
official DashScope SDK; the success envelope and `model` row field are explicitly a versioned live
response-shape contract bound to the retained body hash, not a generalized SDK schema. `total` equal
to this zero-or-one filtered page is intentionally required; any Provider drift fails closed and
requires a new observation/schema revision.

Focused tests pass `109` with four platform skips; the full Server suite passes `4749` with `199`
skips. Sandbox typecheck, target lint, the static contract, and diff checks pass. Full preflight is
`446/0` with the two existing local-extension permission warnings. A new clean revision and evidence
ID may now execute the official one-GET preflight. `QA-02` remains `4/5`, overall progress remains
`32/37`, and no paid Provider call or production mutation occurred.

### Completed Wanx v3 catalogue preflight

From clean pushed revision `6948460a41a2038e3a5c48b589b291ce179ab407`, the bounded launcher read
credential revision `dashscope-wanx-beijing-rotation-20260801-01` from current-user DPAPI and passed
it only through child stdin. Official v3 evidence ID `qa02-wanx-readonly-20260801-6948460-01`
completed exactly one authenticated GET to the reviewed model URI. Private manifest SHA-256 is
`d30992953eed5218818e54146d70a0d9897de7bf1b60a993051ad0e23bf43c5f`. The sole retained
1022-byte response SHA-256 is
`5d2dd214e9eb01aebe9f16d7ab29538f869ab140a42345af531d1d7b2611d578`; its hashed request ID is
`a7598f5df0d0164e3e136c0a59288ca708bc7a8d33c89f3b1e090dc683918dbc`.

The manifest binds operation `qa02-wanx-i2i-20260801-6948460-01`, exact API Base/model/revision,
one GET record, and matching response hash. It records `authenticationVerified=true`,
`exactModelListed=true`, `billingMeterStatus=SEPARATE_EVIDENCE_REQUIRED`,
`providerPostSent=false`, `chargeObserved=false`, and `editCapabilityVerified=false`. Credential
scans across both files found zero matches. The evidence directory and files use protected explicit
current-user/SYSTEM/Administrators ACLs, contain no reparse point, and retain the same hashes after
ACL hardening.

Private pricing-policy SHA-256 is
`e6b4d5a6c0d338411cbcd89740e73b91d6dbc21e4b7eb609b354a1a0d6e6c4f6`. It proposes quote CNY
`0.14` and maximum CNY `1.00`, but its status remains pending a separate billing snapshot and
operator maximum authorization. Approval-draft SHA-256 is
`b2f3e0c092b57cacdf868e14a5a62fcb6e55c035658a1c45f088d22ef941369e`; it still says
`DRAFT_REVIEW_REQUIRED_NOT_APPROVED`. No Provider price synchronization is required, but the exact
Prompt and an independent pre-call billing snapshot must be retained before asking for explicit
one-request approval. No task, synthesis, poll, image download, paid operation, deployment, flag,
ERP ingest, VPS, or Ozon mutation occurred. `QA-02` remains `4/5` and overall progress remains
`32/37`.

### Positive Wanx IMAGE_TO_IMAGE capability-only result

Operation `qa02-wanx-i2i-20260801-3ac48e4-01` used the reviewed legacy API Base, exact
`wanx2.1-imageedit` model, `DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1`, one pinned 1024x1024 source,
and the fixed warm-beige marketplace Prompt. The operator approved one request with quote CNY
`0.14` and maximum CNY `1.00`. Before dispatch the operator disclosed that the DPAPI Key's billing
account differs from the authenticated Bailian console account. The console snapshot manifest
`151dc6d0...fdffde` was therefore marked excluded. Capability-only policy, pre-call, and approval
SHA-256 values are `d4a1f162...561a7f`, `28163310...bdcda`, and `0dff1d18...9654a`.

The guarded runner made one create request. DashScope accepted the task, returned `SUCCEEDED` after
eight polls, and exposed one metered result that was downloaded once without Provider
Authorization. Report SHA-256 `a0671f5c...caed42` and async-evidence SHA-256
`97776d79...ca3194` bind one 1024x1024 PNG, 951,543 bytes, SHA-256
`f6d90b58d722376bde094c7fcc7308a7f60683877d080be28038473f7c19da24`. Source corner mean RGB
`[203,203,202]` changed to output `[214,189,171]`; visual inspection confirmed the warm-beige
background, preserved mug identity/shape/handle/proportions/camera angle, and absence of text,
logos, watermarks, or extra objects. Technical review SHA-256 is `9fb8c7fd...83cb98`; human
quality was later approved under private confirmation SHA-256 `b140ce02...d367b5`.

Billing remains deliberately unresolved. No unrelated console value was treated as actual cost,
no finalizer or formal receipt ran, and sidecar SHA-256 `9150eb29...6bec93` records
`UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH`, `actualCost=null`, and no same-request retry. The result is
positive operation-specific technical evidence, not a price or billing claim.

### Positive Wanx FULL_EDIT capability-only result

After the operator approved I2I image quality under private confirmation SHA-256
`b140ce02...d367b5`, operation `qa02-wanx-full-edit-20260801-d077795-01` received its own exact
authorization. Private pre-call and approval SHA-256 values are `ed8f8990...95db8d` and
`a64c4d96...2dc5df`. The clean private `d077795` checkout sent one create request, polled only the
accepted task nine times, and downloaded one result without forwarding Authorization.

Report SHA-256 `9e1ee9e3...a912cd` and async-evidence SHA-256 `fd56c94d...612fed` record
`SUCCEEDED`, one 1024x1024 PNG of 910,556 bytes, and output SHA-256
`4638848afd8409c2cfa3db3d74235062794567593b4a5f604f4d429c7439e85e`. The output is not a copied
source: mean absolute channel difference is `3.089`, and `14.14%` of pixels differ by more than five
RGB levels. Visual inspection found a complete but restrained neutral-gray studio rerender that
preserves the mug identity, shape, handle, proportions, camera angle, and no-text/no-logo rules.
Technical-review SHA-256 is `7568c39e...d41ddd`; the operator later approved FULL_EDIT image
quality under private confirmation SHA-256
`6ca5ce2674d7ff223e90ec299e7c6d4b168350ca6fd6a5eec3d07d548317ae59`.

Billing again remains deliberately unresolved because the Key's account is not the authenticated
console account. Sidecar SHA-256 `62a2b8d6...f0f449` records `actualCost=null`, no formal receipt,
and no same-request retry. This is positive FULL_EDIT capability and quality evidence with billing
still unresolved.

### Positive Wanx INPAINT capability-only result

Operation `qa02-wanx-inpaint-20260801-d077795-01` received a separate exact authorization for the
reviewed source, mask, Prompt, profile, quote CNY `0.14`, and maximum CNY `1.00`. Private pre-call
SHA-256 is `ed0788bc5f108cfcbddc3857662e352e69cea3b8d71d606747c11dc6fae6b465`; approval SHA-256 is
`c2de393f55ac49c859e0065f7ae17a591da06b9c7dbd73a8f66461a404f95827`. The original 1024x1024 PNG
mask SHA-256 is `f5a5d6945d37b0616f9606d1832f48dcf47710b37fda494bd5ce115bfb14fe3b`; its deterministic Wanx
transport mask SHA-256 is `ebd90e94ba683f52f52f8199e312cd43b024380986151520df0d3c715abcfe02`.

The guarded runner sent one create request and did not retry. Wanx reached `SUCCEEDED` after six
polls and one result download. Report SHA-256
`51060c57b2c39bf4d6d02f40336b1e1c588011d490799d394e41815408778f6d` and async-evidence SHA-256
`e4bdb4a0c5db86de58fe3e2c410600e3c7c527647cb69e95c8ff43382749ee6f` bind one 1024x1024 PNG,
923,461 bytes, SHA-256 `8fb828558e9bf35da5534b769af8de21442d54d42edd99dd8ea4a3c6e7735284`.

Pixel review found that the 25,600-pixel transparent edit region changed with mean absolute channel
difference `3.418`, with `37.54%` of edit pixels changing by more than five RGB levels. The
1,022,976-pixel preserve region had mean difference `0.015`, with only `0.07%` changing by more than
five levels. Technical-review SHA-256
`e44ee59f07111b18c78aad22a559a17810bef516636a11705a1abe60e9976526` therefore records positive
mask transport, masked-region modification, unmasked preservation, product preservation, and no
unexpected text, logo, watermark, or object. The requested blue change is visually subtle blue-gray
and the hard boundary of the deliberately rectangular test mask remains visible. Human visual
quality confirmation is pending and must not be inferred from the technical locality result.

Billing remains deliberately unresolved. Sidecar SHA-256
`2c788c1978538f35bc7908cd39a7a262aa066a841a0d147e2923d19fdf0cc7c9` records
`UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH`, `actualCost=null`, no formal receipt, and no same-request
retry. This is positive INPAINT technical evidence only. It does not promote the Wanx candidate or
change the `4/5` Phase 3 and `32/37` overall counts.

## PicPi public no-credential preflight

At the public-preflight checkpoint on 2026-08-01, the operator supplied `https://api.picpi.top` as
another OpenAI-compatible edit candidate. The Token pasted into chat was exposed and was not used.
The resumed CLI process had
neither `AI_IMAGE_SANDBOX_API_KEY` nor `AI_IMAGE_SANDBOX_CREDENTIAL_REVISION`, so no authenticated
request was possible or attempted.

The candidate API Base canonicalizes to `https://api.picpi.top/v1`. The local proxy resolver
returned fake-IP `198.18.0.29`, which the sandbox public-DNS guard correctly rejects. Independent
Cloudflare and Google DNS-over-HTTPS answers agreed on public IPv4 addresses `104.21.13.92` and
`172.67.167.234`. A future local run therefore requires excluding `api.picpi.top` from proxy
fake-IP DNS or running the reviewed CLI in an environment that resolves those public records; the
sandbox guard must not be weakened to accept `198.18.0.0/15`.

Bounded anonymous requests with redirects disabled observed:

| Request | Result |
| --- | --- |
| `GET /` | HTTP 200 HTML, title `picpi 皮皮工艺站 - AI API Gateway` |
| `GET /v1` | HTTP 200 HTML |
| `GET /v1/models` | HTTP 401 JSON requiring Bearer, `x-api-key`, or `x-goog-api-key` authentication |
| `GET /api/status` | HTTP 404 plain text |
| `GET /api/pricing` | HTTP 404 plain text |
| `OPTIONS /v1/images/edits` | HTTP 403 with no body |

These observations prove a reachable authenticated API gateway, not an edit route, model
entitlement, price, or positive Provider capability. No POST was sent and no charge occurred.
At that checkpoint, the next step was one authenticated GET-only model-catalog and billing-meter
preflight using a new private credential revision, followed only then by a fresh
operation-specific policy, quote, maximum, approval, and one-POST `IMAGE_TO_IMAGE` attempt. Existing
Packy, Xiaoyi, CentOS, or Wanx approvals could not be reused. The resulting attempt is recorded
below.

## PicPi authenticated preflight and bounded I2I result

After the exposed PicPi Token was revoked, replacement credential revision
`picpi-sub2-20260801-r2` remained only in current-user DPAPI storage. With system DNS returning
public addresses `104.21.13.92` and `172.67.167.234`, an authenticated read-only model request
returned HTTP 200 and 13 model IDs, including `gpt-image-2`. Guessed legacy billing endpoints were
404; the deployed Sub2 frontend identified authenticated `GET /v1/usage` as the API-key usage
endpoint.

The operator approved exactly one request:

| Field | Bound value |
| --- | --- |
| Operation ID | `qa02-picpi-i2i-20260801-de951b7-01` |
| API Base | `https://api.picpi.top/v1` |
| Operation endpoint | `https://api.picpi.top/v1/images/edits` |
| Model/profile | `gpt-image-2` / `OPENAI_SQUARE_SINGLE_V1` |
| Operation/size/count | `IMAGE_TO_IMAGE` / `1024x1024` / `n=1` |
| Source SHA-256 | `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32` |
| Quote/maximum | USD `1.00` / USD `1.00` |
| Approval SHA-256 | `2c48bfe635105a78fc23c9a102fff8ce88bd6a9ec3634c68ae0a7bad005f0576` |

From clean pushed submission revision `de951b79655ecb32c9d44c4d748b38f48a28dc42`, the guarded
runner sent exactly one synchronous multipart POST. It did not retry. PicPi returned definite HTTP
400 after `2025 ms`. Intent, fingerprint claim, report and sanitized diagnostic SHA-256 values are
`c85423b4...62ae4`, `2f8c59af...8aa57`, `87a574b0...f239f`, and `74d45944...2ab15`.
The v5 report records `REJECTED`, `createRequests=1`, response request-ID hash
`f4cfe87f...de017`, `usage=null`, and no image.

The retained authenticated `/v1/usage` body has SHA-256 `654b930e...3efcf`. It reports
`usage.today.requests=0`, `usage.today.actual_cost=0`, `usage.total.requests=0`, and
`usage.total.actual_cost=0` for this API Key. Subscription-level historical usage is a different
scope and was not used. Upstream Sub2 commit `b22f73e725236790f97d89bf0c3b908a48e591d5` confirms that
`/v1/usage` filters by the authenticated API Key; lifetime requests are `COUNT(*)` over its usage
logs and lifetime actual cost is their sum. Logged failed requests also contribute to the count.

The existing exact-money v2 attestation could not honestly represent this evidence: it requires a
Relay raw-quota delta and raw response request ID, while the runner intentionally retained only the
request-ID hash. Finalizer revision `0d42a87d75980ead4a4806a188e6d26f9f5b7aa9` therefore added a
closed v4 cumulative-zero contract. It accepts only this exact PicPi route/model/operation/profile,
one definite rejected request, a response-ID hash, and machine-parsed Key-level today/lifetime zero
usage. It cannot settle a charge, success, unresolved outcome, another Provider, or another
operation, and it does not fabricate a pre-call snapshot.

Attestation SHA-256 `a82fded6935f7b4e9013a1ad034083bb13bd1ed0553c4081b08374bc5fb0764f`
produced v5 receipt SHA-256
`e2ed71a3a7dfbdb5ef9cc292fb7bc881fb27f616ac432ab0ec99d0965d6465cd`. It records
`NO_CHARGE`, `billingGate=PASS`, USD `0`, zero billed units, resolved rejection, and
`sameRequestRetryAllowed=false`; offline replay returned byte-identical evidence. Nine private
files were retained under archive manifest SHA-256
`a91d81050c37580e002d4cf8b70e251fbb59ef35b27116bfa5725953fd403476`; private run-summary
SHA-256 is `3708060fb9932a1fbc92b1ae177517098299b9acceb75cdf478a381082a4fe36`.

This is a closed negative result for the exact PicPi account/route/model/generic multipart
contract. It proves one POST was sent and no usage or charge was recorded, not that editing works.
Do not retry the Operation ID, rename the same request, or infer `FULL_EDIT`/`INPAINT` support. No
Registry, deployment, flag, ERP ingest, Ozon, or VPS mutation occurred. Phase 3 remains `4/5` and
overall progress remains `32/37`.
