# Source-to-Ozon AI Workflow Rollout Runbook

## Scope And Safety State

This runbook covers the disabled rollout control plane and legacy publisher convergence. It does not authorize a real Ozon write. Unit 6C remains incomplete until every migrated boundary has real observations, reviewed evidence, an approved V2 adapter and controlled test-shop acceptance.

Current required defaults in every environment:

- `feature_source_listing_workflow=false`
- `feature_source_ozon_publisher_v2=false`
- all five `source_ozon_publisher_*_stage` rows are `off@0`
- `feature_ai_media_workflow_v2=false`
- `ai_media_workflow_v2_rollout_policy={"revision":0,"tenantIds":[]}`
- no readiness approval is connected to an external write unless the physical route consumes the exact rollout decision

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
