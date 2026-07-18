# Source-to-Ozon AI Workflow Rollout Runbook

## Scope And Safety State

This runbook covers the disabled rollout control plane and legacy publisher convergence. It does not authorize a real Ozon write. Unit 6C remains incomplete until every migrated boundary has real observations, reviewed evidence, an approved V2 adapter and controlled test-shop acceptance.

Current required defaults in every environment:

- `feature_source_listing_workflow=false`
- `feature_source_ozon_publisher_v2=false`
- all five `source_ozon_publisher_*_stage` rows are `off@0`
- `feature_ai_media_workflow_v2=false`
- `feature_ai_listing_copy_generation=false`
- `ai_media_workflow_v2_rollout_policy={"revision":0,"tenantIds":[]}`
- no readiness approval is connected to an external write unless the physical route consumes the exact rollout decision

## Release Evidence: `274f9c5`

This release adds the dark Unit 7B listing-copy execution path. It generates Russian title and description candidates from trusted Capture V2 and reviewed Ozon facts, freezes Prompt/Provider provenance, and requires an explicit audited apply before publish compilation. It does not enable paid generation or Ozon writes.

| Evidence | Result |
|---|---|
| Git | `274f9c5` (`feat(ai-media): add auditable listing-copy generation`) pushed to `origin/feat/ai-media-prompt-registry`; local, domestic and international environments use the exact commit |
| Automated verification | Server `2096 passed / 85 skipped`; workspace type checks and production builds passed; lint `0 errors / 22` existing warnings; preflight passed with `192 pass / 3` existing extension-permission warnings; Prisma validate/generate and all Web listing-copy contracts passed |
| PostgreSQL | All 79 migrations replayed from zero in an isolated schema before release; PostgreSQL AI Media integration passed; local, domestic and international databases report all 79 migrations current |
| Listing-copy boundary | Active Prompt Registry releases are resolved server-side; only owner-scoped verified Capture V2 and reviewed Ozon facts enter the request; candidates freeze template, request, Provider/model/config, source-profile and output provenance; public DTOs redact frozen Prompt bodies |
| Review and publish authority | Manual and generated candidates preserve explicit per-field coverage; apply is an audited user command; retained stale fields are not re-authorized; publish compilation verifies title and description against their own latest apply audits |
| Local ERP | API DB/Redis ready; all relevant rollout flags restored false; desktop and 390px mobile workbench QA passed without unexpected overflow; the UI showed the paid generator disabled and no Provider or Ozon write was attempted |
| Domestic VPS | `8.163.122.40` deployed `274f9c5` after a successful 96K database backup and quiesced API/Worker migration; API/Web/Worker, local/public `/ready`, 79 migrations, dark flags and unauthenticated 401 passed; cloud extension package `1.0.207` |
| Domestic infrastructure limits | Full verifier retains the four existing HTTPS/Cloudflare failures and two existing backup/IP-update warnings: no 443 listener/UFW rule, no Cloudflare real-IP/origin guard, no remote backup and no Cloudflare IP-update cron |
| International VPS | `45.76.49.64` deployed `274f9c5` after a successful 33M database backup and quiesced API/Worker migration; full runtime verifier passed with `0 failures / 1 warning`; `https://ss-erp.com` loaded with no browser console errors; cloud extension package `1.0.242`; unauthenticated listing-copy capability returned 401 |
| Rollout state | `feature_source_listing_workflow`, `feature_source_ozon_publisher_v2`, `feature_ai_media_workflow_v2` and `feature_ai_listing_copy_generation` are `false`; AI Media rollout remains revision `0` with zero tenant IDs in all three environments |
| Activation gate | Provider dispatch locking is process-local and daily quota reservation is not atomic; validation-rejected paid outputs are not yet charged to the request quota and quota exhaustion is not yet a typed 429. Paid tenant activation remains prohibited until those controls are transactional and tested with real Provider cost/quality evidence |
| External effects | No paid AI Provider call, real image generation/upload, commercial charge, tenant activation or Ozon write was executed |

## Release Evidence: `d27f0e1`

This release adds the dark Unit 7B operator reconciliation surface. It lets account-session super administrators inspect bounded evidence for ambiguous Provider submissions and record an audited `SETTLED` or `RELEASED` decision without enabling Provider execution or tenant rollout.

| Evidence | Result |
|---|---|
| Git | `d27f0e1` (`feat(ai-media): add operator cost reconciliation`) pushed to `origin/feat/ai-media-prompt-registry`; deployments used the exact clean commit |
| Automated verification | Server `2071 passed / 85 skipped`; workspace type checks and production builds passed; lint `0 errors / 22` existing warnings; preflight and extension verification passed with the same three permission warnings |
| PostgreSQL | A guarded runner created an isolated `ai_media_test_*` schema, replayed all 78 migrations, passed six real ledger/workflow tests including concurrent opposite decisions and exact-request replay, then dropped the schema in `finally` |
| Local ERP | 78 migrations current; API DB/Redis ready; Web `/admin/ops` returned 200; the super-admin cost queue rendered its empty state with no console errors and no page overflow at 375px; AI Media dark verification passed |
| Domestic VPS | `8.163.122.40` deployed `d27f0e1`; pre-deploy backup completed; 78 migrations current; API/Web/Worker, local/public `/ready`, Prisma and dark checks passed; cloud extension package `1.0.206`; unauthenticated reconciliation API returned 401 |
| Domestic infrastructure limits | Full verifier retained the four existing HTTPS/Cloudflare failures and two existing backup/IP-update warnings; bootstrap validation separately retains the two empty-Turnstile-key warnings |
| International VPS | `45.76.49.64` deployed `d27f0e1`; pre-deploy backup completed; 78 migrations current; full verifier passed with `0 failures / 1 warning`; cloud extension package `1.0.241`; unauthenticated reconciliation API returned 401 |
| Reconciliation safety | Evidence hash covers reservation and Job state; exact request replay is idempotent; changed evidence/reason or concurrent opposite decisions return 409; terminal ledger and public Job cost fields update in the same Serializable transaction |
| External effects | No paid AI Provider call, real image generation/upload, commercial charge, tenant activation or Ozon write was executed |

## Release Evidence: `a79e0e4`

This release hardens the dark Unit 7B provider-cost lifecycle. It fences paid-provider dispatch before submission, quarantines ambiguous outcomes without resubmission, supports operator reconciliation terminal states, and quiesces Worker/API execution around schema deployment. It does not enable a paid Provider, tenant rollout, image write or Ozon write.

| Evidence | Result |
|---|---|
| Git | `a79e0e4` (`feat(ai-media): harden provider cost lifecycle`) pushed to `origin/feat/ai-media-prompt-registry`; deployments used the exact clean commit |
| Automated verification | Server `2062 passed / 83 skipped`; all workspace type checks and production builds passed; lint `0 errors / 23` existing warnings; preflight `192 pass / 3` existing extension-permission warnings; Prisma validate/generate, all 77 migrations from zero, PostgreSQL integration and deployment safety contracts passed |
| Local ERP | All 77 migrations current; API `/ready` reports DB/Redis OK; Web returns HTTP 200; browser login page loaded with only the expected unauthenticated `/api/user/me` 401 |
| Domestic VPS | `8.163.122.40` deployed `a79e0e4`; pre-deploy database backup completed; 77 migrations current; API/Web/Worker, local/public `/ready`, Prisma and AI Media dark checks passed; cloud extension package `1.0.205`; browser setup page returned 200 |
| Domestic infrastructure limits | Full verifier retained four existing failures: no HTTPS listener, no UFW 443 rule, no Cloudflare real-IP restoration and no Cloudflare origin guard. It also retained warnings for local-only backup replication and missing Cloudflare IP update; bootstrap validation separately warns that Turnstile keys are empty |
| International VPS | `45.76.49.64` deployed `a79e0e4`; pre-deploy database backup completed; 77 migrations current; full runtime verifier passed with `0 failures / 1 warning`; `https://ss-erp.com` loaded with no browser console errors; cloud extension package `1.0.240` |
| Rollout state | AI Media master `false`, rollout policy revision `0` with zero tenant IDs, logistics distribution flags `false`, and extension auth remains `compat` in both VPS environments |
| External effects | No paid AI Provider call, real image generation/upload, commercial charge, tenant activation or Ozon write was executed |

## Release Evidence: `3b8460d`

This release adds the fail-closed PDD/Taobao/Tmall network-evidence boundary. It is a dark, provider-neutral capability and does not authorize marketplace interception, paid AI calls, image writes, or Ozon writes.

| Evidence | Result |
|---|---|
| Git | `3b8460d` deployed from `origin/feat/ai-media-prompt-registry`; the follow-up plan documentation is recorded separately in `f94cf45` |
| Automated verification | Server `1982 passed / 80 skipped`; server/Web typecheck and production builds passed; provider, evaluation, marketplace and extension lifecycle contracts passed; extension verification `192 passed / 0 failures` with three existing permission warnings |
| Network capture boundary | MAIN hook removed from the production manifest; local feature flags and page messages cannot enable capture; policy, nonce, sequence, TTL, identity, URL/port and byte-budget checks fail closed; only bounded, redacted diagnostics are persisted |
| Domestic VPS | `8.163.122.40` deployed `3b8460d`; 68 migrations current; API/Web/Worker active; local and public `/ready` passed; AI Media dark verification passed |
| International VPS | `45.76.49.64` deployed `3b8460d`; 68 migrations current; API/Web/Worker active; `https://ss-erp.com` `/ready` passed; AI Media dark verification passed; verifier reported `0 failures / 1 warning` for local-only backup replication |
| Rollout state | AI Media master `false`, rollout policy revision `0` with zero tenants, listing/publisher masters `false`, all publisher stages `off@0`, `feature_source_network_capture=false` in both VPS environments |
| External effects | No paid AI provider call, real Ozon write, production image upload, or enabled network interception was executed |

## Release Evidence: `9afeb68`

| Evidence | Result |
|---|---|
| Git | `9afeb68`; reviewed feature branch pushed to `origin/feat/ai-media-prompt-registry`; both VPS deployments were packaged from the exact commit in a clean detached worktree |
| Automated verification | Server `1962 passed / 80 skipped`; workspace typecheck and production build passed; lint `0 errors / 23` existing warnings; Web AI Media executable/static contracts and dark-deployment guards passed |
| Schema | 68 migrations current in local, domestic and international environments; all eight AI Media migrations applied successfully on both VPS deployments |
| Local ERP | API ready with DB/Redis OK, Web HTTP 200, AI Media master false, rollout tenant list empty, listing/publisher masters false and all five publisher stages `off@0` |
| Domestic VPS | `8.163.122.40` deployed `9afeb68`; pre-deploy backup completed; API/Web/Worker active; local and public HTTP `/ready` passed; Prisma and dark-rollout checks passed |
| Domestic infrastructure limits | Full verifier reports four existing infrastructure failures: no HTTPS listener, UFW does not allow 443, and Nginx lacks Cloudflare real-IP/origin-guard configuration. The deployment remains reachable over HTTP and has no initialized USER/ADMIN account, so browser canary lands on first-run setup |
| International VPS | `45.76.49.64` deployed `9afeb68`; pre-deploy backup completed; full VPS verifier passed with `0 failures / 1 warning`; the warning is that the latest backup remains local rather than remotely replicated |
| Browser canary | `https://ss-erp.com` returned 200, loaded in about 390 ms and had no console errors. Domestic HTTP returned 200 and the setup screen loaded in about 65 ms; the initial unauthenticated `/api/user/me` 401 is expected for the uninitialized environment |
| Rollout state | AI Media master `false`, rollout policy `revision:0` with zero tenant IDs, listing and publisher masters `false`, and all five publisher stages `off@0` in all three environments |
| External effects | No paid AI provider call, real Ozon write or production image upload was executed |

Deployment artifact note: the cloud extension package version is derived from each environment's previous build history, so this release produced `1.0.201` domestically and `1.0.236` internationally from the same application commit. Normalize cross-environment extension versioning before promoting extension artifacts as a single public release.

## Release Evidence: `d932a9a`

| Evidence | Result |
|---|---|
| Git | `d932a9a` pushed to `origin/feat/ai-media-prompt-registry`; deployment packaged from a clean detached worktree |
| Automated verification | Default preflight passed: server `1968 passed / 80 skipped`, server/Web typecheck, provider foundation contract and extension static verification all passed |
| Schema and rollout | Both VPS databases remained current at 68 migrations; AI Media master false, rollout policy revision 0 with zero tenants, listing/publisher masters false and all five stages `off@0` |
| Domestic VPS | `8.163.122.40` deployed `d932a9a`, backup completed, services and local/public HTTP `/ready` passed. The verifier retains the same four infrastructure failures recorded for `9afeb68` and two warnings for missing Turnstile keys and local-only backup |
| International VPS | `45.76.49.64` deployed `d932a9a`, backup completed, full verifier passed with `0 failures / 1 warning`; the warning is local-only backup replication |
| External effects | No paid AI call, real Ozon write or production image upload was executed |

## Release Evidence: `c704692`

| Evidence | Result |
|---|---|
| Git | `c704692` pushed to `origin/feat/ai-media-prompt-registry`; deployment packaged from a clean detached worktree |
| Automated verification | Default preflight passed: server `1972 passed / 80 skipped`, server/Web typecheck, Provider adapter characterization, AI evaluation policy contract, marketplace network contract and extension static verification all passed |
| Contract state | Six synthetic PDD/Taobao fixtures pass schema, signature, identity, SKU, price and recursive secret checks; three AI evaluation policies pass Draft-07 and semantic boundary checks, explicitly without image corpus or quality results |
| Domestic VPS | `8.163.122.40` deployed `c704692`; 68 migrations current, services and public HTTP `/ready` passed. Existing HTTPS/Cloudflare verifier failures remain unchanged |
| International VPS | `45.76.49.64` deployed `c704692`; 68 migrations current, full verifier passed with `0 failures / 1 warning` for local-only backup replication |
| External effects | No paid AI call, real Ozon write or production image upload was executed |

## Release Evidence: `50cc36b`

| Evidence | Result |
|---|---|
| Git | `50cc36b`; reviewed branch pushed and worktree clean at deployment |
| Automated verification | Server `1906 passed / 79 skipped`; PostgreSQL migration regression `8/8`; typecheck and production builds passed; lint `0 errors / 23` existing warnings |
| Schema | 60 migrations current in local, domestic and international environments |
| Local ERP | API ready with DB/Redis OK, Web HTTP 200, 17 authenticated read-only checks passed |
| Domestic VPS | API/Web/Worker active, public home and `/ready` passed; authenticated smoke remains pending because no USER/ADMIN account was initialized |
| International VPS | Full VPS verifier and 17 authenticated read-only checks passed; a roughly 33 MB database backup was created before deployment |
| Rollout state | Five stages `off@0`; listing and publisher master flags `false` |
| External effects | No real Ozon publish or image upload was executed |

Known operational follow-up: domestic HTTPS/firewall/origin protection and PostgreSQL listening restrictions remain open; international remote backup storage remains unconfigured.

The listing batch/import-by-SKU production decision and shadow-recorder wiring was implemented after `50cc36b`. It must receive its own review, commit, push and three-environment verification before being added to deployed release evidence.

## Verification Target Resolution

Deployment verification must derive the public target from the environment instead of assuming one domain. `scripts/verify-cloud-runtime.sh` and `scripts/verify-vps-deploy.sh` resolve the target in this order:

1. `VERIFY_READY_URL`
2. `VERIFY_PUBLIC_BASE_URL`, with `/ready` appended
3. `VERIFY_DOMAIN`, converted to `https://<domain>/ready`
4. `NEXT_PUBLIC_API_BASE_URL` loaded from the selected deployment env file, with `/ready` appended

The verifier exits with an error when none is available or when the resulting URL is invalid. The hostname used for Nginx and TLS checks is derived from the resolved ready URL when `VERIFY_DOMAIN` is not supplied.

## Entry-Point Migration Matrix

`T0` means the recorded time at which that exact writer/origin first completes an approved and verified V2 switch. Every removal date is currently `UNSCHEDULED` and must be a concrete calendar date at least 30 days after `T0`.

| Boundary | Current authority and evidence | Required before V2 | Rollback | Legacy removal |
|---|---|---|---|---|
| `/api/collect/publish-ozon`, DIRECT | Legacy authoritative; compile-only parity and recorder deployed dark | Physical rollout decision at the final Ozon boundary, real observation window, reviewed subjects and test-shop acceptance | CAS stage to `shadow` or `off`; disable masters; retain drafts, observations and attempts | `UNSCHEDULED`, not before `T0 + 30 days` |
| Browser one-click -> collect writer | Legacy worker forwards to collect; exact identity survives queue/restart; browser observations supported | Enforce both collect-writer and browser-origin decisions immediately before the external call | Set browser origin and collect writer to `off`; retain legacy job readers | `UNSCHEDULED`, not before both boundaries have passed `T0 + 30 days` |
| `/api/listing/batch`, DIRECT | Legacy `/v3/product/import` remains authoritative; exact identity is deployed; production decision and shadow recorder are implemented post-`50cc36b` | Deploy the wiring, collect evidence, then add a multi-draft V2 adapter with per-draft idempotency and immutable attempts | Stage `off`; legacy route and `SyncJob` reader remain available | `UNSCHEDULED`, not before `T0 + 30 days` |
| `/api/listing/ozon/import-by-sku`, DIRECT | Legacy `/v1/product/import-by-sku` remains authoritative; exact identity is deployed; production decision and shadow recorder are implemented post-`50cc36b` | Deploy the wiring, approve endpoint compatibility evidence, then add the V2 adapter and response projection | Stage `off`; retain `draftRefs`, task and reconciliation readers | `UNSCHEDULED`, not before `T0 + 30 days` |
| Extension `OZON_PUBLISH` | Device grant/consume/replay/receipt exists; publisher master remains off | Enforce the extension-origin rollout decision at execution, complete device/test-shop acceptance and keep generic account-token fallback disabled | Disable master, leave extension stage `off`, revoke grants/devices; receipts remain readable | New endpoint is not removed; any legacy extension fallback is `UNSCHEDULED` and follows collect/browser acceptance plus 30 days |

## Shadow Operation Rules

- Provision the exact writer/origin/revision gate before collecting evidence intended for readiness.
- Shadow mode keeps the legacy request authoritative. The comparator and recorder may not call Ozon.
- The exact legacy payload used for comparison must be the value sent by the legacy call.
- Diagnostic failure may not silently become a successful observation. Store a bounded failed outcome when an eligible attempt exists.
- Re-evaluate the rollout decision immediately before every external call. Revision, stage, gate-version or evidence-hash drift aborts the request.
- `BLOCKED` and `V2` without a physical adapter fail before Ozon client construction. Never fall back from V2 to legacy.

## Promotion And Rollback

Promotion remains `off -> shadow -> v2`; direct `off -> v2` is forbidden. A V2 transition requires an exact current READY gate binding, the real observation thresholds, immutable review decisions and the applicable external acceptance evidence.

Emergency rollback uses the super-admin CAS rollout API to move the affected boundary to `shadow` or `off`. Do not edit protected stage rows through generic SystemConfig routes. Rollback changes application authority only; it must not delete captures, drafts, publish attempts, observations, receipts or reconciliation data.

No real test-shop publish may run until the environment, tenant, shop, reserved offer prefix, expected draft revision, rollback command and responsible operator are explicitly recorded.
