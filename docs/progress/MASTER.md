# Dual-Mode Extension AI Image Workflow: Master Progress

## Task

Build one SS ERP browser-extension image workbench with two explicit execution modes:

- `ERP_HOSTED`: ERP owns Provider execution, pricing, quota, queue, storage, candidate
  review, draft application, and Ozon publishing.
- `BYOK`: the extension background calls the user's approved AI Provider with a session-only
  API key, the user reviews results locally, ERP normalizes and binds accepted media, and the
  existing ERP publisher performs the final Ozon submission.

The workbench recreates the useful reference workflow in original SS ERP code and visual
language. It does not copy reference source, assets, branding, strings, identifiers, unsafe
credential storage, or direct Ozon calls.

## Analysis

- [Project overview](../analysis/project-overview.md)
- [Module inventory](../analysis/module-inventory.md)
- [Risk assessment](../analysis/risk-assessment.md)

## Plan

- [Task breakdown](../plan/task-breakdown.md)
- [Dependency graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Project Skill

- [Develop dual-mode AI workbench](../../.codex/skills/develop-dual-mode-ai-workbench/SKILL.md)

## Implementation Phases

- [x] Phase 0: Contract and regression baseline (3/3 tasks) [details](./phase-0-contract-baseline.md)
- [x] Phase 1: Default-off security foundation (7/7 tasks) [details](./phase-1-security-foundation.md)
- [x] Phase 2: Secure single-image BYOK vertical slice (10/10 tasks) [details](./phase-2-byok-vertical-slice.md)
- [x] Phase 3: Edit operations and batch engine (5/5 tasks) [details](./phase-3-edits-batch-engine.md)
- [x] Phase 4: Complete dual-mode workbench (5/5 tasks) [details](./phase-4-dual-mode-workbench.md)
- [x] Phase 5: Publishing closure and product quality (4/4 tasks) [details](./phase-5-publish-quality.md)
- [ ] Phase 6: Pilot and release (2/3 tasks) [details](./phase-6-pilot-release.md)

Overall: 36/37 tasks complete (97%).

## Current Status

Current checkpoint (2026-08-05): replacement release
`ad4b8714b53d0826ffe470f6db97b6906dcc52c0` / `1.0.284` completed the authorized dark
pre-release chain. Target-bound QA-04 passed all nine gates in `809.5s`; canonical acceptance
SHA-256 is `de3082ab834d43d7241e1b19fc62db7c139fef0128e80b5aa4254742d0e24f37`.
Independent `.com` and `.cn` 190-file Cloud/Local candidates passed detached Ed25519 signature
verification, signed MV3 restart smoke, and `1.0.283 -> 1.0.284` upgrade smoke. Signed restart
receipt SHA-256 values are `290a12b132803880dc5d39c31e16ffbee8a8ce22612d08c762874a1e520b4202`
and `36fadeb64bbd65c140e70d2efe8f26bf2008af3e3bbef7e3798ea55731c65800`.

Both regions completed fresh target/database/restore-bound backup validation, migration, service
restart, topology-correct runtime verification, final dark verification, and `7/7` pre-enable
canaries. Canary receipt SHA-256 values are
`ed36f43294c0ea06f7e7d22213258cead939c44ed036cff273c2b79721808376` for `.com` and
`b8750b48c19df39e2c2b87610f400938da9de1e0290e95ba79151707d08ca540` for `.cn`.
Temporary account/device sessions were removed, and both receipts prove no Provider dispatch, ERP
ingest, or Ozon mutation. Every AI Media, Extension BYOK, ingest, publish, and Ozon publisher flag
remains off.

Fresh two-VPS public DNS quorum rejected the local proxy fake-IP and pinned only the agreed public
address sets; quorum evidence SHA-256 is
`b4685b108dd4bc0a2097ce5a5ee4973da5d518672f63fd29bf5a17d76df800c1`. First-party website
latest/Cloud/Local GET probes and offline publication verification passed in both regions.
Distribution receipt SHA-256 values are
`09df3e9c7eb4b59e62c543269945d12622e1d28d028b4ba42d0428c627764aa7` for `.com` and
`dfd475bac5d0e0e7baf4ba82738a949057d06e78cc2f2caf25d55207d28b1d72` for `.cn`.

BINI upgraded atomically on its original managed path from `1.0.283` to `1.0.284` under unchanged
extension ID `nkkemglcckgmhmcfnjjmcfbdhciafahl`. Its 190 installed files match tree SHA-256
`c75ffe17ebba367a0320fa5ab0d2b98d68c30fbd263b6e46c07799b4ea676313`; upgrade receipt
SHA-256 is `875d634b50329b1f2d3af4d7dbb9daec23352a0a59c072e7b0d6e87064b04062`.
The first pre-switch snapshot correctly failed closed on browser session residue without changing
the managed tree; one controlled restart cleared it, and the only atomic switch then passed. The
non-secret Provider profile was preserved while session Key, capability, dispatch, vault, batch
recovery, and device-access state remained absent.

A trusted `chrome://extensions` reload recorded `event.isTrusted=true`, changed the Worker target,
and proved the old target gone; reload receipt SHA-256 is
`24e18c9b3aea70acd68811c33713d6c2c65cbf41467a12225ca0a75e7c806ddb`. The read-only
attestor matched active and disk Worker SHA-256
`c9a70e7eff1a9dedc991105864ff9771bc19978e3e181582da0ad9c4aa9f5aa6` at `279878` bytes and
observed runtime manifest `1.0.284`; attestation SHA-256 is
`7ba7bffa2f1ea416e1d9ffeb41d4a45d7fbe4f17ac1727125de238f103018456`. The live Unicode
slot smoke passed with receipt SHA-256
`500270b1b0e2a443127266cdfca6937d38d26dd4b9948c9d1a027ba7ce5131e0`. Final replacement
release reconciliation SHA-256 is
`28df1dd7d39477d582e28cc33347593b2c03cfcd456c3bde2abfa13fafb90d1c`.

This replacement chain made zero Provider POSTs, incurred zero Provider cost, and made no ERP
media ingest, ERP publish, or Ozon write. `REL-03` and `REL-04` remain complete; Phase 6 remains
`2/3`, overall progress remains `36/37`, and only `REL-02` is open. BINI is idle with all
session-only state cleared. Resuming the pilot requires a freshly loaded Key plus a new exact
owner/shop/device-scoped Provider POST count and single/cumulative cost ceilings; no previous
Provider authorization carries forward.

Historical checkpoint (2026-08-05): the live `1.0.283` `.com` BINI scoped sandbox pilot consumed
its separately authorized two Provider POSTs exactly once: one `TEXT_TO_IMAGE` capability probe
and one formal generation, with no automatic retry. The formal status-v2 record reached
`SUCCEEDED`; its 1,804,392-byte PNG result SHA-256 is
`82b77095a9674d7d960d2fc59ce855c527fbea4c000f597dbc431c9d995b07bd`. Workbench screenshot
SHA-256 is `8319769612dbe0f43fb71062cbd07bbec4a349621b14af71d0a1f6918460820d`.
A trusted `保留此图` action committed local `KEPT` review state while ingest remained
`NOT_STARTED`.

An actual MV3 worker stop/wake then exposed that `1.0.283` kept the device-authority epoch only in
worker memory. The new worker reset its epoch to `0`, so exact lifecycle-authority validation
rejected the still-encrypted candidate and finalized the local batch as
`FAILED_FINAL / SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST`; ingest finalized as
`SS_ERP_BYOK_BATCH_WORKER_RESTART_UNRESOLVED`. The ten-minute escrow TTL later expired, so the
original result is not recoverable and must never be ingested. Append-only private reconciliation
SHA-256 is `34f2464c9b73601e488a5d4ba16e237501619b97b07d85bfcd15e1bbfd921307`.

Fix commit `4632a9e17f9617ec6bd0e979d491324734677467` persists the lifecycle epoch in
`chrome.storage.session`, serializes cross-worker read/modify/write with Web Locks, retains
fail-closed pending invalidation, and proves Worker A epoch `1` -> Worker B epoch `1` review-only
restore without Provider dispatch while stale epochs remain rejected. The combined focused
contracts passed `81/81`; full `pnpm preflight` passed in `642.1s`; source extension verification
passed `450` checks with zero failures and the two existing local-package permission warnings.
Independent compatibility and security reviews found no blocking issue. At that checkpoint the fix
was pushed but not yet released; it was subsequently included in the completed `ad4b8714` /
`1.0.284` replacement release recorded above.

After the `2/2` authorization was exhausted, all six `.com` BINI rollout rows were atomically
returned to dark state and the official dark verifier passed. Dark-disable and verification receipt
SHA-256 values are `01db8e79942c23938fdcdd93cbace37f920bfeb3d4ce34c3fa9c4b0d71dc2edb` and
`971a64e3fec064aa5227f36fdb03aa01a9cac00fd0ffa0192756318d502b700f`. The BINI session Key,
exact Provider-origin permission, and capability evidence were then cleared; cleanup receipt
SHA-256 is `b0a664622c91cd0031ed53843c8d93e543972ba1baf5c6046e5e3ea3b2c13cd4`. No Provider
request followed the formal generation, actual Provider cost was not observed, and no ERP ingest,
ERP publish, or Ozon write occurred. `REL-02` remains open, Phase 6 remains `2/3`, and overall
progress remains `36/37`. At that checkpoint the next dependency was the dark `1.0.284`
replacement pre-release; it is now complete, and a fresh scoped live-pilot authorization may be
considered under the current checkpoint above.

Historical checkpoint (2026-08-05): replacement release
`7202b5971571d1debbacc76540f311e7dd733d5a` / `1.0.283` completed the full replacement
pre-release chain. Target-bound QA-04 acceptance SHA-256 is
`224e3432ee481aceaea072b72c526201b93f1d0fab37efdc921790f2a27815f4`. Independent `.com`
and `.cn` 190-file candidates passed detached-signature verification, signed MV3 restart smoke,
and same-path upgrade smoke.

The previous `.com` BINI scope was atomically returned to dark state before deployment; its
state-change receipt SHA-256 is
`e521117471428ff91b514c66421a592093d055b00beff1d843789dbc10768623`. Both regions then
completed fresh commit/database/restore-bound backup drills, migration, service restart, complete
runtime verification, and `7/7` dark canaries. Canary receipt SHA-256 values are
`a51fc832b8d7031ba214f37b6324535f6aae497bc47ed1c39a36e8fa40f31892` for `.com` and
`572b61487599d5334c20394b2c0f21d204273eaba1e99af181c314c06c258d42` for `.cn`; every
pilot flag remains off. First-party website distribution and offline signature verification passed
with receipt SHA-256 values
`5b104d2616eead3176d07aa7aab1a14f8cee5e1953439388e1d5378859d84dda` and
`95ad8b0297b4f8570f17505c77895993cb2844d3506890be183db879dab1983d` respectively.

BINI upgraded atomically on its original managed path from `1.0.282` to `1.0.283` under unchanged
extension ID `nkkemglcckgmhmcfnjjmcfbdhciafahl`. Its installed tree SHA-256 is
`fbdc9edce1f2549151af39ff1b5ae5619ad6d224afc03c385ca16f4666c765ab`; upgrade receipt
SHA-256 is `868c403ed64b5a6603bf5b4ab0b9f77e98244f875263ef4baedb4acd94525bee`. The
non-secret Provider profile was preserved, while session Key, capability evidence, dispatch/vault
state, and device-session access remained absent. A trusted `chrome://extensions` reload recorded
`event.isTrusted=true`, changed the service-worker target, and proved the old target gone; receipt
SHA-256 is `8e43a9c0740e45266e85f590d8fa58448703cf5a23b32a0477cf1385b1661719`.

The read-only main-script attestor then matched active and disk worker SHA-256
`ac1f6b60d1d9902c3456828952a873f9d1b93bf96af5a67204f06cbeced04857` at `279765`
bytes and independently observed runtime manifest `1.0.283`; attestation receipt SHA-256 is
`c5d82bdacffb46440ef88c4f5430115b4c80a3a85fb45cbe628fd7577b2119a8`. The isolated live
Worker Unicode slot smoke passed with receipt SHA-256
`f0ec879fba1827c28cc0ec59153394ea56239cd8ca850f8916e63549da3435f7`. Final replacement
release reconciliation SHA-256 is
`88a4adecb1b3bb83a2291604b40d129733a46f5861d28bd4f9caa2656d6c71f1`.

This replacement chain made zero Provider POSTs, incurred zero Provider cost, and made no ERP
media ingest, ERP publish, or Ozon write. It intentionally changed the old scoped rollout rows to
dark state, and all flags remain off. `REL-03` and `REL-04` remain complete; Phase 6 stays `2/3`,
overall progress stays `36/37`, and only `REL-02` is open. The `1.0.282` two-POST authorization is
exhausted and does not carry forward. BINI session-only state is cleared, so the next pilot attempt
requires a freshly loaded Key plus a new exact owner/shop/device-scoped Provider POST count and
single/cumulative cost ceiling before any Provider request.

Historical checkpoint (2026-08-04): replacement release
`49ae41e337f2857cecece4a173f0c8a661c536cd` / `1.0.281` completed the authorized REL-02
pre-release chain. Its target-bound QA-04 acceptance SHA-256 is
`8d069c4926edac9756e343c08ed3255c19713c9a9c974f112a38ff9dc6d8f8df`. Independent `.com`
and `.cn` candidates contain 190 files per package, passed detached-signature verification and
signed MV3 restart smoke, and replaced the quarantined `1.0.279` and `1.0.280` artifacts.

Both regions completed fresh commit/database/restore-bound backup drills, dark deployment,
topology-correct VPS verification and `7/7` pre-enable canaries. Canary receipt SHA-256 values are
`6662ff24b3675d1d58d48321cfdb126cbbc14509c99caaf97e28e01eaa4c9eb2` for `.com` and
`ee2da3888681320ac750360b35162f2b1afccd5eefc2fc31ed343115bce47de8` for `.cn`. Both regions
serve the exact target commit with every pilot flag off.

First-party website latest/cloud/local download and offline publication verification passed in both
regions. Publication receipt SHA-256 values are
`20e89f47919f2748465781a8c4875051224553ed40868ec4fc8d01b30fcac195` for `.com` and
`4a6cc67b14035fb38b30604b59194aa66164af1965ead046a61d2232f586f3be` for `.cn`; fresh
two-VPS public DNS quorum evidence SHA-256 is
`375105c6179846acee715ea067850f3f5550e959bd44bf1699131bd31360edc6`.

The isolated signed-package upgrade smoke passed from `1.0.278` to `1.0.281` with summary SHA-256
`839c86210f876c4208b274d93201f1a984b903ec4170061f24f6479ae0c73280`. BINI then upgraded
atomically on its original managed path under unchanged extension ID
`nkkemglcckgmhmcfnjjmcfbdhciafahl`. Its 190 installed files match target tree SHA-256
`2799885b1983f0b2b3f8bb1b98b29c2af4bbe6ecce685e0a9dfa7512adb48cf8`; the non-secret
Provider profile was preserved, while session secrets, capability evidence, vault key and batch
recovery state remained absent. The exact `1.0.278` tree remains as a rollback backup. Upgrade
receipt SHA-256 is `12a121c6e84ca418eb06f4f5027e3f419d6385b57207c29eca195fb91de8072c`.

REL-02 pre-dispatch validation then found that the persistent BINI profile still executed the
historical worker bytes even though the installed tree and runtime manifest reported `1.0.281`.
The trusted generation click failed at the lifecycle ACK before Provider dispatch; stale-worker
block receipt SHA-256 is `aa416be83f9907e88df754f1b192f4fc6b3ae287d62fa73b4de00f597475dca5`.
The original managed-upgrade receipt therefore remains valid for its signed package, installed
tree, profile and session-state assertions, but it is not accepted by itself as proof of the active
worker code.

An official extension reload repaired the active worker. Reload reconciliation and stop/wake
receipt SHA-256 values are `af1a4c0f6057fbed17ecb1935f26809aca0e692498184289dd38a6254d9c099a`
and `76f8565f303b0a8972850deeeaccda9b0d1952c8c4373219ce0c28c4db20a27b`. A new
side-effect-free main-script attestor now compares the exact active `Debugger.getScriptSource`
bytes with an explicitly selected installation directory and awaits Debugger disable plus Target
detach. Its real Chrome `147.0.7727.15` receipt SHA-256 is
`9a8174f2791177a7844195b16b4e6358b38566b7a4e4cb2deb82deacf621c449`; active and disk worker
SHA-256 are both `27e220de97ff6a29578c9163ee035ea1ce8bb2fd983363cdd48aa28ab91710ac`
at `279652` bytes. The receipt scope is intentionally `MAIN_SCRIPT_IDENTITY_ONLY`; signed package,
installed tree, imported scripts and the upgrade transition remain separate gates.
The combined 23 active-worker/Unicode contracts and complete local preflight passed in `627.9s`;
source extension verification finished at `450` passes, the two existing local-package warnings and
zero failures.

The authorized `1.0.282` BINI sandbox pilot consumed exactly two Provider POSTs: one capability
probe and one formal `TEXT_TO_IMAGE` generation. Both authoritative execution records are
successful, no automatic retry occurred, and the two-POST authorization is exhausted. The formal
candidate result SHA-256 is
`e5ae237c7f35d519a7134194aca2543edfd0c4ed21d64aeef7780046038f1e42`; its immediate result receipt
SHA-256 is `68f4c3683a7acd20448fa6f8efbc40e8b2739c4f29645481c4ac152dc4e8cdc2`. Provider price
synchronization was not required and actual Provider cost was not observed from the separate
account. Ingest, publish and Ozon writes remain disabled.

The package/deployment pre-release itself called no Provider and incurred no Provider cost. It made
no feature-flag change, ERP ingest/publish or Ozon write. `REL-03` and `REL-04` remain complete,
Phase 6 remains `2/3`,
overall progress remains `36/37`, and only `REL-02` is open.

The formal candidate was displayed in the active BINI workbench and the operator confirmed its
image quality. A trusted `保留此图` action was attempted, but by then the review-only candidate had
passed the hard ten-minute AES escrow TTL: the runtime batch projection was empty and the escrow
store contained zero entries. No authoritative keep/ingest transition was committed. The append-only
human-review reconciliation is private receipt SHA-256
`e9a249fc812f2adcbf180822d7b16811b51bc4e127f106d436d54d187912d3c4`; it records the quality pass,
candidate-expiry observation, and zero ERP/Ozon side effects. `REL-02` therefore remains open and
the next pilot attempt requires a new Operation ID, explicit Provider POST/cost authorization and a
fresh session before any Provider request.

Historical checkpoint (2026-08-03): then-deployed release commit
`b6f421211fdc14686ccb5188badf3985cb16930b` passed the complete nine-gate QA-04 command in
`774.4s`; canonical acceptance SHA-256 is
`5a97e22583cfe200a7204b747a92259c6e0a951bed2cfafa193832e6c9fe7219`. Both origin-bound
version `1.0.278` candidates passed detached-signature verification and persistent-Chromium
same-path upgrade smokes while preserving non-secret profile state and clearing session-only state.

Both `.com` and `.cn` deployments used fresh target/database/restore-bound backup attestations,
completed migration and post-migration guards, and passed the complete topology-correct runtime/VPS
verifiers. Backup attestation SHA-256 values are
`153a04c6b367e7df02b912aa5ead697916266bb933eaf2e00e85ae98dd4a6f8b` for `.com` and
`9d22a45681889682ad58c9aba734900c34744bde2307b4c5391c49bc6e396168` for `.cn`; VPS verifier
SHA-256 values are `42f9e2c6878675978945921bfd61605f888253a3269597b173fe6e9855dab41a` and
`482d85b155e001b4db69b8e062bad2b19c3e0112018cded106191f3f9a84174a`. Pre-enable canaries passed
`7/7` in each region with SHA-256 values
`61b94f977dcd390af0be6eba6b18b7862236b2071c67df3c20d2ff5633810991` and
`64503e2f8208834d6179f4d8f14c74a512c2225366ba6156a081d12febd53ead`. Signed first-party website
distribution and offline verification passed with publication receipt SHA-256 values
`77e0cc2d4100ed8fbb73c40ee386aff3d910baa94e5fb621cd999306ae07a218` and
`5f98a25109b5aa317865159e66082de33fc59cde00243daa47ffcc6c9d394ba9`; public DNS quorum evidence
SHA-256 is `284aa1b923bad43f455661353e7bff297fe8c493806d012b7116ff01addb5871`. These actions sent no
Provider request, ERP media ingest, publish intent, or Ozon mutation.

After dark deployment, `.com` atomically restored the exact BINI owner/shop/device pilot and
`https://ai.big-model-api.top` `TEXT_TO_IMAGE` scope. All six changed rows advanced from revision
`8` to `9`; the BYOK admin policy advanced to internal revision `5`, and the source policy now binds
the full b6 commit. A fresh read-only database snapshot, the repository composition formula, and the
official rollout verifier independently confirm composite policy revision `735123817`. Hosted
generation, BYOK ingest, and BYOK publish remain `false@0`; `.cn` remains dark. The restore receipt
SHA-256 is `ecf029cd81c883bbeeaed48690f5e1bf43fca422c11b7e55455d756adfae86b0`; the post-restore
read-only audit SHA-256 is `baeaadb0c2b474adf17c4dfe87b3a9bd7ce718c88fe3013d2dd055b37a79504f`.

The dedicated BINI browser then upgraded on the same managed path from `1.0.276` to `1.0.278` under
unchanged extension ID `nkkemglcckgmhmcfnjjmcfbdhciafahl`. Its 189 installed files exactly match
the verified candidate hash map, the non-secret origin/model profile remains, and the Provider Key
and old capability evidence were cleared as designed. Upgrade receipt SHA-256 is
`b7cf09e0c34dfc5e6eed6768e8ffd252d840c2d759d8a9aa1619848aab9793b5`. Eight raw short-lived
session files were removed after all five unique tokens were confirmed inactive; cleanup receipt
SHA-256 is `374fb7ea88041118c5ef20177a82851ebeb87292fbbb634cc16dc5cf339effda`.

`REL-03` and `REL-04` remain complete, Phase 6 remains `2/3`, and overall progress remains `36/37`.
Only `REL-02` is open. POST 5 sent exactly one post-reload `TEXT_TO_IMAGE` capability request,
received HTTP `200`, and was not retried. Its pre-call receipt SHA-256 is
`f712abf4df1bed4a8488f2e7e384a48cceabae639ca419995ad327dcfd60ec3d`. The immutable original
result receipt SHA-256 is `6277ba540535eaca11da735dee9fc6b7bb2c6010acce6ed64718e36d4763992e`;
it conservatively recorded `CONSUMED_NOT_SUCCESSFUL` during a UI-render race. The append-only
reconciliation is authoritative for the durable evidence and records POST 5 as `SUCCEEDED`; its
SHA-256 is `20cbda840025d887dab2e270b2f74b80ac7cb978a7c51e89989b168949a836eb`.

POST 6 then sent exactly one formal-generation Provider request, received HTTP `200`, and was not
retried. Pre-call receipt SHA-256 is
`acc1e3b58ba8f862603ddbe2381c4b65e238a0f9385f40d94e80677002545e61`; the immediate result
receipt SHA-256 is `aff32ecf7ea7028b6d08121b5877e66d356761a24f47c4c9ea2d9c6f7a54537e` and recorded
`CANDIDATE_READY`. Before review, the MV3 service worker restarted and cleared the memory-only Blob
vault. Preview therefore failed, and durable reconciliation correctly finalized the local batch as
`FAILED_FINAL` with `SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST`; reconciliation receipt SHA-256 is
`18358a64f1c56a6fa7da909b401cc7dd24827cc0dd555c19dbd14fa5fa4426f4`. This proves Provider
success but not an end-to-end formal generation, and the lost candidate cannot be recovered.

All six authorized Provider POSTs are consumed and the current authorization has zero remaining;
no retry is permitted. POST 6 remains unrecoverable and must never be ingested. No candidate was
reviewed or kept, no ERP ingest or publish ran, and no Ozon write occurred.

The offline follow-up now treats the fixed public PING/ACK lifecycle protocol, five-second ACK
deadline, twenty-second heartbeat, twenty-minute active bound, and fail-closed page gates as
mitigation only; a frozen or discarded page cannot make a heartbeat a correctness guarantee.
Before a non-probe text/edit execution intent may be reported `SUCCEEDED`, the candidate is staged
as AES-256-GCM ciphertext in IndexedDB under a random 256-bit key held in
`chrome.storage.session`. Escrow is bounded to 16 entries, a 50 MiB retained-media budget,
20 MiB per result, and a hard ten-minute TTL. API Keys, Authorization values, raw Prompts, result
URLs, base64, and plaintext image bytes do not enter persistent storage.

The authenticated closed-schema `extension-byok-execution-batch-status/v2` projection adds
`resultSha256` only for `SUCCEEDED` intents. A same-browser-session MV3 worker restart may restore a
candidate only when the exact execution intent, Provider idempotency/request hashes, result hash,
readiness binding, and current lifecycle authority all match. The restored coordinator is
review-only: preview, keep/reject, ingest, and ingest recovery remain available, while pause,
continue, cancel, regenerate, retry, unknown-outcome resolution, and every Provider dispatch path
remain closed. Browser-session/key loss, expiry, tamper, quota failure, missing v2 proof, or any
binding/authority mismatch fails closed to local-result-lost without retry.
Credential or Provider-consent changes wait for one serialized Registry cleanup fence: pending
recovery and preview reads drain before escrow key rotation, in-memory/session state is cleared
inside the same fence, and queued Provider handoff rechecks that the fence is open. Fresh-worker
terminal cleanup durably deletes ciphertext by execution-intent identity before clearing its
operation lock.

At the `ac4227f9` checkpoint this recovery implementation had passed offline source, Cloud, and
Local build/package verification but was not yet signed, release-staged, website-distributed,
deployed, or paid-validated and could not retroactively restore POST 6. That offline work made no
Provider request, VPS change, rollout-flag change, ERP ingest, publish, or Ozon mutation. Phase 6
remained `2/3`, overall progress remained `36/37`, and only `REL-02` was open.

The authorized pre-release from `ac4227f9d6e1291bf275ff314f78dc049d565a7f` passed the complete
nine-step `QA-04` aggregate in `806.7s`; source/Cloud/Local verification passed `450/455/451`.
Regional version `1.0.279` candidates were built with 190 files per target but were never signed.
Release review correlated a live `.com` Worker PostgreSQL `42702` loop with an unqualified
`RETURNING` projection in the expired BYOK upload-staging `UPDATE ... FROM`; b6 and `ac4227f9`
both contain the defect. The two `1.0.279` candidates are quarantined and must never be signed,
distributed, deployed, or installed.

The six `.com` BINI-scoped rollout rows were first atomically returned from revision `9` to dark
revision `10`, and the official dark verifier passed. Private state-change receipt SHA-256 is
`e88efc87d8f556df39800594ebd85c45f7a377d7bc4c3a1dc1ff51d4f6187f3b`. The command invoked no
Provider, ingest, publish, or Ozon path; its embedded zero counters state the command boundary and
are not independent billing or side-effect observations. `.cn` remained dark, and both regions
continued serving b6 without upload, backup, migration, or restart.

The cleanup fix now derives every returned field from one structured projection, qualifies the
target alias for the ambiguous query, and adds a real isolated-schema PostgreSQL regression to the
formal AI Media aggregate. Focused unit tests passed `13/13`; PostgreSQL passed `21` files and `96`
tests; Server typecheck, focused lint, and diff checks passed. The replacement release must use a
new clean commit and version `1.0.280`, then rerun full `QA-04`, regional package/sign, signed MV3
restart smoke, both dark deployments/download receipts, and the BINI same-path upgrade. Progress
remains `36/37`; no Provider authorization was added and all pilot rollout state remains off.

Current checkpoint (2026-08-02): the replacement release from clean pairing-fix commit
`e795e67de4df1a53bdb8738e8dd4158a6570d22d` passed the complete QA-04 gate, regional `1.0.273`
package/sign verification, both same-path upgrade smokes, and fresh commit/database/restore-bound
backup gates. The first `.com` dark deployment then reproduced the previously observed startup
race: all build, migration, dark-config, symlink, systemd and process-cwd checks passed, but the
single `/ready` probe ran before the API listener was ready. Automatic rollback restored commit
`2fa91856b1c09531865c1a9b8af7a0a82d27cf4f`; API, Web and Worker are active and readiness is
healthy. `.cn` was not deployed, no canary or website receipt ran, and no flag, Provider, ERP ingest
or Ozon mutation occurred. The failed `e795e67`/`1.0.273` artifacts remain immutable evidence and
must not be retried as a release.

The deployment regression now uses a fixed 30-attempt, one-second retry contract with a two-second
per-probe timeout, exact API HTTP `200`, and Web HTTP `200`/`302`. Explicit old-commit deploy and
rollback paths retain an in-runner fallback when the target tree predates the helper. In-place
staging re-enters and verifies its last trusted persistent-maintenance gate after any post-leave
health failure; it never executes an unverified target gate as root. Focused deployment, backup,
environment, package and full Linux `12/12` behavior tests pass, including connection refusal,
HTTP-status rejection, bounded exhaustion and recovery. Independent review found no remaining
P0/P1/P2 issue. A new clean commit, full QA-04 run, version `1.0.274` chain and fresh dual-region
rollout evidence are still required. Phase 6 remains `0/3` and overall progress remains `34/37`.

Current checkpoint (2026-08-02): the authorized `.com` `BINI` REL-02 sandbox preflight stopped
before device claim or any Provider request. The staged `1.0.272` package loaded successfully in an
isolated Chromium profile, but its extension-origin settings page was rejected by the packaged
deployment sender check. The first fix at `fe099b988c9cf679596dee4dcbb3a8be96959ddf` passed the
runtime ID into that check; independent review then found that the central runtime policy would
also admit the claim message from unrelated same-extension pages. A second regression now permits
the claim from `pages/settings.html` while rejecting popup, Provider settings and AI Workbench
pages, and retains exact ERP Web/Admin one-click pairing. The focused message, device pairing and
lifecycle matrix passes `57/57`; independent review found no remaining P0/P1/P2 issue.

The unconsumed pairing code and short-lived owner/admin sessions were revoked, the isolated browser
was closed, and the exact pilot label has zero device sessions. Preflight evidence SHA-256 is
`19021ce2...480c`. No Provider call, ERP ingest, Ozon mutation or feature-flag change occurred; all
regions remain dark. Because the distributed `1.0.272` package contains the pairing defect,
`REL-03` and `REL-04` are reopened until a clean QA-04 run, version `1.0.273` package/sign/upgrade
chain, both dark deployments/canaries and both first-party website receipts pass. Phase 6 is
therefore `0/3` and effective progress is `34/37`; `REL-02` resumes only from that replacement
release.

Current checkpoint (2026-08-02): `REL-03` and `REL-04` are complete on final pushed commit
`2fa91856b1c09531865c1a9b8af7a0a82d27cf4f`. Both `.com` and `.cn` VPS environments run that
exact commit through hardened release-mode systemd units with verified backup/restore attestations,
no pending migrations, passing post-migration guards, healthy private/public readiness, correct
runtime permissions and all AI Media, Extension BYOK and Ozon publisher flags off. The complete VPS
verifier passed in both regions with only the non-blocking local-only backup warning.

Both pre-enable canaries passed all seven checks and cleaned up their temporary device and account
sessions. Domestic receipt SHA-256 is `b2b1abb4...5a32f`; international receipt SHA-256 is
`2d381f57...63f4e`. Neither canary sent a Provider request, ERP ingest, or Ozon mutation. The
international first deployment attempt exposed a bounded startup race between the fixed three-second
wait and the API listener; rollback restored the legacy services, the failed artifacts were retained,
and a second clean deployment of the same immutable target passed. Its legacy backup cron was then
bound to `/opt/ss-erp/current` and the full verifier reran successfully.

Canonical extension version `1.0.272` is now actually distributed through the first-party website
API in both regions. The `.com` publication verifier passed receipt SHA-256
`ddd86111...f6c4`; the `.cn` verifier passed receipt SHA-256 `1abd7c8d...c944`. Each receipt binds
the region-specific release evidence, Ed25519 sidecar, exact version/commit, cloud/local filename,
Content-Length, `X-Content-SHA256` and downloaded body SHA-256. Phase 6 is `2/3`, overall progress
is `36/37`, and only `REL-02` remains. No pilot flag has been enabled.

Read-only `REL-02` readiness found no existing production workflow that can be reused safely.
International has 15 active owner/shop pairs and domestic has 5, but both regions have zero source
captures, source-listing workflows, BYOK provenance rows, publish intents and publish attempts. All
relevant Extension BYOK and source-workflow configs remain `false` at revision `0`. Private
readiness SHA-256 values are `0192dc0e...9969` for `.com` and `19064fe4...a6c` for `.cn`. The
sanitized fixture may be used only for the sandbox capture/ingest lane; its partial facts cannot be
published to Ozon. `REL-02` therefore awaits an exact real source product, target Ozon shop and
separate operator authorization for the scoped device/policy changes and final Ozon mutation.

Current checkpoint (2026-08-01): `QA-02` technical sandbox acceptance is complete. The earlier
relay text-to-image chain and the three separately approved Wanx `IMAGE_TO_IMAGE`, `FULL_EDIT`, and
`INPAINT` operations provide operation-specific positive Provider evidence. All three Wanx async
tasks reached `SUCCEEDED`, each sent exactly one create request without retry, and each returned one
validated 1024x1024 PNG. The operator approved all three images, including the subtle blue-gray
INPAINT result and its visible rectangular test-mask boundary. Phase 3 is now `5/5`;
operation-specific capability acceptance is complete, and no result was retried.

The Wanx API Key's billing account remains unlinked to the authenticated Bailian console account.
No unrelated snapshot was used, actual cost remains unknown, and no formal Wanx billing receipt
exists. This does not erase the real capability results, but it keeps the Wanx candidate out of the
production Provider Registry and prevents candidate promotion. All rollout flags remain off; no
deployment, VPS, ERP ingest, Ozon mutation, or production enablement occurred.

The final `QA-04` aggregate then passed from clean pushed revision
`c053c2c7a4b1de967e67d4135172e309813e4896` in `780s`. Its nine fail-fast gates covered the gate
contract, diff check, workspace lint/typecheck, full preflight with builds, isolated scope-revocation
and AI Media PostgreSQL lanes, and fresh cloud/local extension packages. Cloud verification passed
`451/0/0`; local and source verification passed `447/2/0` and `446/2/0`, with only the two expected
local permission warnings. No `20260801` QA schema remained. Private acceptance summary SHA-256 is
`1fb9d012...00acbd`. Phase 5 is now `4/4`, overall progress is `34/37`, and `REL-03` is the next
dependency-ready task.

`REL-03` packaging then produced the first canonical release candidate from clean pushed commit
`45693943a63d106d6a4adfb58ca782c1703ba5f8`. The coordinated release is version `1.0.265`, binds
Web/Admin/API origins `https://app.ss-erp.com`, `https://admin.ss-erp.com`, and
`https://ss-erp.com` plus local `http://127.0.0.1:3001`, and contains 189 files per target. Cloud
ZIP SHA-256 is `a832b6e0...77f80`; local ZIP SHA-256 is `3c1e8694...c55a`; canonical evidence
SHA-256 is `c4f8f8ae...d7d2e7`. The official no-follow staging verifier byte-preserved exactly the
two ZIPs, checksum, and evidence into a private four-file candidate.

A persistent-Chromium same-path upgrade smoke moved from `1.0.264` to `1.0.265` with the same
extension ID. The non-secret Provider profile remained, the session-only sentinel was present before
restart and absent afterward, and it never entered local or sync storage. Private smoke-summary
SHA-256 is `98996dc3...d1b09`. The candidate still records
`signature.status=EXTERNAL_REQUIRED`: no detached release signature, first-party website download
receipt, or external publication occurred. `REL-03` therefore remains open, Phase 6 remains `0/3`,
and overall progress remains `34/37` pending execution of the approved `/api/extensions` channel.

The release channel is now explicitly the first-party website `/api/extensions` API, not Chrome Web
Store. A protected local Ed25519 key produced public keyring entry
`ss-erp-extension-release-2026-08-02-01` with public-key SHA-256 `78b7e0cf...a9a9`. The unchanged
`1.0.265` four-file candidate received a detached signature sidecar whose SHA-256 is
`d2eb50bd...ce84`; neither the private key nor sidecar entered the candidate or repository. This is
only a signing checkpoint: the website copy/API-origin correction changes application code, so a
new deployable candidate must be packaged from the final clean commit and signed again. Actual
cloud/local GET evidence remains pending until the dark deployment can serve the exact version/SHA
URLs. Phase 6 remains `0/3` and overall progress remains `34/37`.

The first-party distribution implementation was committed and pushed as
`19e98810593ea619360edcadf9b78eacc93b37cd`. Final `QA-04` then passed from that clean revision in
`820.1s`, including all nine fail-fast gates, production builds, isolated PostgreSQL lanes and fresh
extension verification at cloud `451/0/0`, local `447/2/0`, and source `446/2/0`. Private acceptance
summary SHA-256 is `e3f868f3...ff01`.

Formal packaging from the same commit produced version `1.0.266`, package-input SHA-256
`ff7103d8...6ac8f`, and 189 files per target. Cloud ZIP SHA-256 is `9c5bbb5d...51fe`; local ZIP
SHA-256 is `ed68aa6e...aa83`; canonical evidence SHA-256 is `31619531...c5d3`. The no-follow staging
verifier retained the exact four files under the commit-bound private release directory. Detached
Ed25519 signature SHA-256 is `53428f4f...e0bf`, stored separately from the candidate. A real
same-path persistent-Chromium upgrade from `1.0.265` to `1.0.266` retained the non-secret Provider
profile and removed the session sentinel from session/local/sync storage; private smoke-summary
SHA-256 is `b1519bdc...53e1`. This completes the `REL-03a` package/sign gate. No website GET, VPS
access, deployment, flag change, Provider call, ERP ingest, or Ozon mutation occurred. `REL-03` and
`REL-04` remain open until dark deployment/canaries and the signed first-party cloud/local download
receipt pass; Phase 6 remains `0/3` and overall progress remains `34/37`.

A regional-origin audit then confirmed that the `.com` candidate cannot pass the domestic `.cn`
deployment verifier. A second region-specific candidate was built from the same target commit and
the same version `1.0.266`, binding `https://app.ss-erp.cn`, `https://admin.ss-erp.cn`, and
`https://ss-erp.cn`. It retains exactly four files with cloud ZIP SHA-256 `23746c3b...14285`, local
ZIP SHA-256 `2903ef35...9606`, evidence SHA-256 `1a1c756f...9d60`, and detached Ed25519 signature
SHA-256 `1cd54054...ff06`. Independent signature verification passed. The `.cn` same-path Chromium
upgrade retained the non-secret profile, cleared the session sentinel, and kept the same extension
ID; private summary SHA-256 is `b10d8990...e7a1`.

Read-only VPS readiness checks made no remote changes. The international SSH TCP port was reachable,
but the host closed the SSH session before state inspection. The domestic VPS remained healthy on
commit `9e7c8140...3f` with API/Web/Worker active, but still uses the legacy `/opt/ss-erp/app` layout;
its private env has empty `CORS_EXTENSION_ORIGINS` and no release origin, stable database identity,
backup directory, or verification-age settings, and `/var/lib/ss-erp-extension-releases` is absent.
It is therefore not ready for the hardened `REL-04` deploy. No upload, backup, migration, restart,
website probe, flag change, Provider call, ERP ingest, or Ozon mutation occurred. Phase 6 remains
`0/3` and overall progress remains `34/37`.

Earlier, the bounded PicPi `IMAGE_TO_IMAGE` operation closed as negative evidence. The guarded
runner sent exactly one request to the approved route, received definite HTTP 400, produced no
image, and did not retry. Authenticated Sub2 API-key lifetime usage remained zero; official receipt
v5 records `NO_CHARGE`, `billingGate=PASS`, zero billed units, and
`sameRequestRetryAllowed=false`.

Both Packy requests, both Xiaoyi requests, and this PicPi request are closed negative evidence and
must not be retried. At that earlier checkpoint, the sandbox-only Alibaba Wanx 2.1 asynchronous
adapter was the materially different candidate selected for separate `IMAGE_TO_IMAGE`, `FULL_EDIT`,
and `INPAINT` validation; the later live operations now provide that Provider acceptance evidence.
The Alibaba credential pasted into chat was exposed, never used, and replaced before the retained
preflight and paid operations by the current DPAPI credential revision. Public pricing remains
planning input, not a maximum-cost authorization or settled billing proof.

The first real DashScope Wanx catalog preflight stopped before credential input with
`SANDBOX_READONLY_DNS_FAILED`: the original resolver required each A/AAAA owner to equal the
requested hostname and rejected DashScope's legitimate DoH CNAME chain. The proposed evidence ID
remains unconsumed. No credential was decrypted, no authenticated Provider GET or POST was sent, and
no charge occurred. A separate no-credential resolver observation then returned public DashScope A
and AAAA answers; that proves only that public resolution is available, not authentication, model
visibility, edit capability, or billing.

The catalog-only v3 helper now accepts only bounded A/AAAA responses whose complete CNAME chain is
bound to the requested host and terminal address owner. It binds the DoH Question, rejects truncated
or non-IN responses, compares the complete A/AAAA chains, and rejects loops, unrelated records,
missing terminals, terminal mismatches, and chains longer than eight hops before credential input.
The exact legacy API Base/model, workspace-host and billing-origin exclusions, one-GET limit, and
explicit `billingMeterStatus=SEPARATE_EVIDENCE_REQUIRED` and `editCapabilityVerified=false` evidence
remain unchanged. Focused tests pass `95` with four platform skips; the full Server suite passes
`4735` with `199` skips. Target lint, sandbox TypeScript compilation, the static contract, and diff
checks pass. Full repository preflight passes `446/0` with the two existing local-extension
permission warnings. Counts remain `4/5` and `32/37`; no deployment, flag, ERP ingest, or Ozon
mutation occurred.

From clean pushed revision `7001a43e8531f44a3428ec757c63194098f816af`, the corrected DNS gate
then sent exactly one authenticated catalogue GET. DashScope returned HTTP 200, but v3 rejected the
response before persistence because the live catalogue row uses `model`, not the assumed
`model_id`; the evidence ID was not created. One additional GET-only pinned diagnostic retained the
1022-byte body privately under SHA-256
`a30c5462e64fd10ad118231784569c8f2deb3f9500283c25ebe30ec87e5cf2cb` and confirmed exactly one
row whose `model` equals `wanx2.1-imageedit`. It found no credential reflection and sent no task,
image-synthesis, or other POST. This establishes the live response shape only; it is not a completed
v3 manifest and does not prove edit permission, billing, price, or balance.

The v3 parser now requires `success=true`, null `code`/`message`, fixed page `1`/size `1`, a total
consistent with at most one row, and the exact bounded `output.models[].model` field. It rejects the
old `model_id` assumption, extra top-level/output fields, contradictory row aliases, and all failed
or inconsistent envelopes. This is an explicit live response-shape revision: the official SDK
corroborates the endpoint/query, while the exact envelope comes from the retained HTTP 200 body;
future Provider drift fails closed. Focused tests pass `109` with four platform skips; the full
Server suite passes `4749` with `199` skips. Sandbox typecheck, target lint, the static contract, and
diff checks pass. Full repository preflight passes `446/0` with the two existing local-extension
permission warnings. Counts remain `4/5` and `32/37`, and no paid Provider call, deployment, flag,
ERP ingest, or Ozon mutation occurred.

From clean pushed revision `6948460a41a2038e3a5c48b589b291ce179ab407`, credential revision
`dashscope-wanx-beijing-rotation-20260801-01` completed the official v3 preflight with exactly one
authenticated catalogue GET. Private manifest SHA-256 is
`d30992953eed5218818e54146d70a0d9897de7bf1b60a993051ad0e23bf43c5f`; the 1022-byte catalogue
body SHA-256 is `5d2dd214e9eb01aebe9f16d7ab29538f869ab140a42345af531d1d7b2611d578`.
It records `authenticationVerified=true`, `exactModelListed=true`, one exact GET record,
`billingMeterStatus=SEPARATE_EVIDENCE_REQUIRED`, `providerPostSent=false`,
`chargeObserved=false`, and `editCapabilityVerified=false`. The response/manifest hashes match,
credential scans found zero matches, and the directory plus both files have protected explicit
current-user/SYSTEM/Administrators ACLs with no reparse points.

The private policy for operation `qa02-wanx-i2i-20260801-6948460-01` now has SHA-256
`e6b4d5a6c0d338411cbcd89740e73b91d6dbc21e4b7eb609b354a1a0d6e6c4f6`, quote CNY `0.14`, and
proposed maximum CNY `1.00`, but remains pending a separate billing snapshot and operator maximum
authorization. Approval-draft SHA-256
`b2f3e0c092b57cacdf868e14a5a62fcb6e55c035658a1c45f088d22ef941369e` still states
`DRAFT_REVIEW_REQUIRED_NOT_APPROVED`. No task, image-synthesis, poll, download, paid operation, or
production mutation occurred. `QA-02` remains `4/5` and overall progress remains `32/37`.

The later exact operation `qa02-wanx-i2i-20260801-3ac48e4-01` produced the first positive live
edit result. Before dispatch, the operator clarified that the DPAPI API Key belongs to a different
Alibaba billing account than the authenticated Bailian console session. The console snapshot was
therefore excluded rather than misrepresented as Key-specific billing evidence. Capability-only
policy SHA-256 `d4a1f162...561a7f`, pre-call record SHA-256 `28163310...bdcda`, and approval
SHA-256 `0dff1d18...9654a` bind exactly one `IMAGE_TO_IMAGE` request, quote CNY `0.14`, maximum CNY
`1.00`, the reviewed source, Prompt, endpoint, model, profile, credential revision, and clean
adapter revision `3ac48e40b04f7b2b6f7942d865e3bde5d747d955`.

The guarded runner sent one create request and did not retry. Wanx accepted the async task, reached
`SUCCEEDED` after eight polls, and allowed one result download. Schema-v5 report SHA-256 is
`a0671f5c...caed42`; async-evidence SHA-256 is `97776d79...ca3194`. The result is one 1024x1024 PNG,
951,543 bytes, SHA-256 `f6d90b58...9da24`. Technical visual review confirmed that the gray source
background changed to visible warm beige while the white mug identity, shape, handle, proportions,
and camera angle remained stable, with no text, logo, watermark, or extra object. The operator later
approved image quality under private confirmation SHA-256 `b140ce02...d367b5`. No formal billing
finalizer or receipt ran: actual cost is unknown and private
sidecar SHA-256 `9150eb29...6bec93` records `UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH` and forbids a
same-request retry. This is positive `IMAGE_TO_IMAGE` capability evidence, not a completed billing
chain; `QA-02` remains `4/5`, overall progress remains `32/37`, and no deployment, flag, ERP ingest,
VPS, or Ozon mutation occurred.

The network-free capability-candidate reviewer now supports the exact Wanx evidence family without
weakening its historical custom OpenAI-compatible path. Wanx candidates must bind provider
`dashscope-wanx21-image-edit`, model `wanx2.1-imageedit`, the reviewed API Base and image-synthesis
endpoint digests, `base64` input, `async` result mode, all three operation-specific profiles, CNY
exact money, a non-null accepted task-ID hash, and a v3 `PROVIDER_REQUEST_ID` receipt. It rejects
generic DashScope labels, another model/base/endpoint/profile, multipart or sync relabeling,
non-CNY evidence, and Token-log receipts. Focused candidate tests pass `43/43`; target lint,
documentation contract, workspace typecheck, diff check, and the complete preflight pass. The
helper remains `CANDIDATE_ONLY`, performs no Registry write, and cannot consume the current
unresolved-billing I2I result. Counts and rollout state remain unchanged.

From clean pushed revision `d07779567eb4b06c3a3de61622704fe8c580b672`, the next capability-only
`FULL_EDIT` and `INPAINT` requests are prepared but not approved. FULL_EDIT operation
`qa02-wanx-full-edit-20260801-d077795-01` has policy SHA-256 `c5d0b141...1d2429` and draft SHA-256
`1d48d56a...2547b9`. INPAINT operation `qa02-wanx-inpaint-20260801-d077795-01` has policy SHA-256
`805193a3...3ae8d2`, draft SHA-256 `95b66c54...c748c9`, and a private 1024x1024 PNG mask under
SHA-256 `f5a5d694...14fe3b`; its transparent 160x160 edit region lies in the upper-left background
and does not cover the mug. Both policies only propose CNY `0.14` quote/CNY `1.00` maximum. Both
drafts retain `DRAFT_REVIEW_REQUIRED_NOT_APPROVED`, and the no-key official verifier rejects each
with `SANDBOX_APPROVAL_SCHEMA_INVALID`. No Provider request or additional charge occurred.

The operator then approved the exact FULL_EDIT capability-only request. Private pre-call SHA-256
`ed8f8990...95db8d` and approval SHA-256 `a64c4d96...2dc5df` preceded one create request from the
clean private `d077795` checkout. Wanx accepted the task, reached `SUCCEEDED` after nine polls, and
allowed one result download without Authorization forwarding. Schema-v5 report SHA-256 is
`9e1ee9e3...a912cd`; async-evidence SHA-256 is `fd56c94d...612fed`. The output is one 1024x1024 PNG,
910,556 bytes, SHA-256 `4638848a...39e85e`. It is not source-byte reuse: 14.14% of pixels changed by
more than five RGB levels, while visual review found the mug identity, shape, handle, proportions,
camera angle, neutral gray background, and no-text/no-logo constraints preserved. Technical review
SHA-256 is `7568c39e...d41ddd`; the operator later approved image quality under private
confirmation SHA-256 `6ca5ce26...17ae59`. Billing sidecar SHA-256
`62a2b8d6...f0f449` records `UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH`, `actualCost=null`, and no
same-request retry. This is positive FULL_EDIT capability and quality evidence, with billing still
explicitly unresolved.

The operator then separately approved operation `qa02-wanx-inpaint-20260801-d077795-01`. Private
pre-call SHA-256 `ed0788bc...e6b465` and approval SHA-256 `c2de393f...f95827` preceded one create
request from the same clean private `d077795` checkout. Wanx reached `SUCCEEDED` after six polls and
one result download. Schema-v5 report SHA-256 is `51060c57...778f6d`; async-evidence SHA-256 is
`e4bdb4a0...49ee6f`. The output is one 1024x1024 PNG, 923,461 bytes, SHA-256
`8fb82855...735284`. The 25,600-pixel transparent edit region changed with mean absolute channel
difference `3.418`, while the 1,022,976-pixel preserve region had mean difference `0.015` and only
`0.07%` of its pixels changed by more than five RGB levels. Technical review SHA-256
`e44ee59f...976526` therefore records positive mask transport, local modification, and unmasked
preservation. The requested blue shift is subtle blue-gray and a hard test-mask boundary remains
visible. The operator approved image quality under private confirmation SHA-256
`36b19700...a2826`. Billing sidecar SHA-256
`2c788c19...f0cc7c9` records `UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH`, `actualCost=null`, no receipt,
and no same-request retry. This closes the operation-specific INPAINT capability and quality gate,
but not billing or Registry promotion. `QA-02` is complete at Phase 3 `5/5`; overall progress is
`33/37`, with every rollout flag still off.

Xiaoyi separates the image API from account meters. After the exposed Token was revoked and replaced
under credential revision `xiaoyi-image-key-rotation-20260801-01`, the official helper ran from
clean pushed commit `f8ee687dbe0faceb73b26a60f9af2543ad003b8d`. It independently pinned both
public DNS identities and completed the fixed seven authenticated Provider GETs. The catalogue
contained exactly `gpt-image-2`; all three before/after meter bodies were byte-identical. Private v2
manifest SHA-256 is `db10c7505118ea3c89517e18ae344151a036f36cad720ab7468a3c1797bf1c33`
and records `providerPostSent=false`, `chargeObserved=false`.

The new `XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1` profile binds only synchronous `IMAGE_TO_IMAGE`, exact
Xiaoyi API/host/model, one `1024x1024` source, `n=1`, and default multipart fields. It rejects
generic-profile downgrade, request-model override, legacy cents, `FULL_EDIT`, and `INPAINT` before
dispatch. The finalizer independently enforces the same operation, model, endpoint/API digests,
exact-money generation, fingerprint, and dual-origin Token-log mapping. Focused implementation tests
pass `302` with two platform skips; the full Server suite passes `4646` with `199` platform skips.
Sandbox and workspace typechecks, the static contract and diff checks pass. Repository lint has zero
errors and only the existing `20` Server plus one shared warning. The complete repository preflight
passes `446` checks with zero failures and the two existing local-extension permission warnings.
An independent security review found and closed the generic-profile `FULL_EDIT`/`INPAINT` downgrade:
route/model identity and the operation allowlist are now separate checks in approval, execution,
claim and settlement.

From clean pushed commit `f189dfab715ac60e8b168b10c13ac9557a091e29`, the operator then approved
operation `qa02-xiaoyi-i2i-20260801-f189dfa-01` with quote USD `0.210001` and maximum USD
`1.000000`. The guarded runner sent exactly one synchronous multipart POST and did not retry. Xiaoyi
returned definite HTTP 400 after `1858 ms`; report SHA-256 is
`0457ffa6e5baf87e9127c6de174191dff0e4cf889dddc738ea2849ddbef682d5`, with `REJECTED`, one create
request, no Provider request-ID hash and no image.

Pre-call and settled manifest SHA-256 values are
`7c2733516cb08d639a8c2a2099285bbb537448e5d22ff87d9a41650a19e63a30` and
`e845170aa7edc113d488608f7c024fb906ad2464e413e22afb6e642f7f73759e`; raw quota, displayed usage
and Token log were byte-identical. Exact attestation SHA-256
`c22c5729c1d2a9f611b3abffa79439ce6d9a619c69d55216a6400b1d4b14dfe7` produced v3 receipt SHA-256
`98bb603e775e0935e8bc2af4f2151f9bcfafdb73be9535516ba049b6ccbb5ad7`, recording `NO_CHARGE`,
`billingGate=PASS`, zero billed units and `sameRequestRetryAllowed=false`; offline replay was
byte-identical. Archive manifest SHA-256 is
`f4fa78fc0b35b29acf9b9ecd9184eafaeb8255f9e70f2fa68d11441eb5e3c656`, and private run-summary
SHA-256 is `f5b3e8a0d1c2ae775b13b849ef7c021ed2266e3de61fc38d4de166ae2ee9aaf5`. No image existed for
human quality review. Credential scans and private ACL checks passed. No Registry mutation,
deployment, flag, ERP ingest or Ozon write occurred. This is negative evidence for the exact Xiaoyi
route/account/profile; do not retry it or use it for `FULL_EDIT`/`INPAINT`. `QA-04`, `REL-03`,
`REL-04`, and `REL-02` remain blocked; overall progress stays `32/37` and all rollout flags remain
off.

Offline development now adds `XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2` for the materially different
documented synchronous request. It retains logical `1024x1024`, `n=1`, one source, exact money, and
`IMAGE_TO_IMAGE`, but sends exactly `model`, `prompt`, and `image`. V1 still sends its historical
five fields and keeps its prior fingerprints. V2 has an independent dialect and replay identity;
approval, runner, claim, multipart guard, and finalizer derive that identity from the profile and
reject cross-generation mixing. Focused tests pass `323` with two platform skips; Server/sandbox
typechecks, the static security contract, and diff checks pass. The full Server suite passes `4661`
with `199` platform skips; lint has zero errors and only the existing `20` Server plus one shared
warning. Preflight and the standalone source-extension verifier report `446` passes, zero failures,
and the two existing local-package permission warnings. Independent review found and closed two V2
dispatch gaps: the dedicated adapter now rejects zero/multiple sources, while the multipart guard
requires `IMAGE_TO_IMAGE` with no mask before accepting the minimal dialect. A fixed historical V1
fingerprint prevents silent compatibility drift. That implementation checkpoint made no credential
read, Provider request, or charge.

From clean pushed commit `78fe4c748fd7c5b6c1c4974467d3342ff6b9cc6a`, the operator approved the
separate minimal operation `qa02-xiaoyi-minimal-i2i-20260801-78fe4c7-01`, with the same pinned
source, quote USD `0.210001`, and maximum USD `1.000000`. Fresh pre-call manifest SHA-256 was
`8021ef614b8658f3b080a648ff3b31970a11fb7e64ca4dc9a2de0e8ce7cbcc72`; final approval SHA-256 was
`792d75870bd711f210ae565dd49ea1c24eac4bde7678889fb2c15c615a6c28a2`. The guarded V2 adapter sent
exactly one synchronous three-field multipart POST and did not retry. Xiaoyi returned definite HTTP
400 after `795 ms`; report SHA-256
`a46f67fbd30dcf0bfc74f64efb5a67af83a625ce8f7c3f5c8b7e09f048b85516` records `REJECTED`, one
create request, no Provider request-ID hash, and no image.

Settled manifest SHA-256 was
`f86ba3b90c7b93ebfcb26bb1b60c885990304fee5cc7e57f1fce0d649de5a3c3`; raw quota, displayed usage,
and Token log remained byte-identical across the POST window. Exact attestation SHA-256
`06598b9bc6f20e93d0ed20314d42b06475146a88224e86a6bcc89a057ad62218` produced v3 receipt SHA-256
`5fe9b606e5839b8fe71305e6a48d72b834eb7e697aeb4b1bed68d8853e24f887`, recording `NO_CHARGE`,
`billingGate=PASS`, zero billed units, and `sameRequestRetryAllowed=false`; offline replay was
byte-identical. Six execution files are retained under archive manifest SHA-256
`d436381bdff60e751962f44755f2159673d07101582a45f276237ce249cc2b1d`; private run-summary SHA-256
is `5a286b63e1b5b03a28d9403e9c7c1109d4710d241d63e6ad95f1af4b85d7c542`. Credential, ACL, and
reparse checks passed. This closes the documented minimal contract as negative evidence. No
Registry, deployment, flag, ERP ingest, or Ozon mutation occurred; counts remain `4/5` and `32/37`.

`DOC-01` is complete. `QA-02` preparation now uses a private canonical closed-schema one-request
approval (`v3` for exact money; historical `v2` remains cents-only) with `approvedAt`/`expiresAt`,
a positive validity window capped at 60 minutes,
strict UTF-8/duplicate-key/bounded-file checks, and freshness rechecks after DNS, at the immutable
claim, before Provider execution, and at both generation/edit POST boundaries. The offline
`sandbox:ai-image:approval:verify` command rejects submit secrets, non-HTTPS/localhost endpoints,
and any exact request mismatch while performing no DNS, intent/fingerprint, or Provider operation.
Before human approval, the separate `sandbox:ai-image:approval:draft` command can bind the same
non-secret request into one exclusive private canonical file. Independent statement/timestamp
sentinels keep that file impossible for the approval loader to accept until a human reviews every
field and manually replaces only those three values; the command refuses secrets, paid
confirmation, existing approval configuration, unsafe media/endpoints/parents, revision drift, and
overwrites while performing no DNS, Provider, intent, or fingerprint operation.
The request claim is closed to known fields and replay identity binds only actual Provider transport
semantics, so approval, profile/dimension metadata, credential revision, adapter revision, or a new
Operation ID cannot authorize the same paid POST again. Git marker/HEAD drift, dirty tracked files,
and Git inspection errors fail closed; in Git checkouts paid executables must also be tracked and
byte-identical to the bound revision, Git HEAD is re-read after status inspection, and Git receives
a minimal secret-free environment with hooks and fsmonitor disabled. Official sandbox CLIs reject
marker-only release archives; VPS execution requires a private checkout of the deployed revision.
A separate network-free
`sandbox:ai-image:billing:finalize` command now verifies private before/settled billing snapshot
bytes, the v2 intent, v3 submit report, recomputed transport fingerprint, approval-time chronology,
Provider correlation, and all artifact digests before writing one append-only sanitized settlement.
The original intent/report remain byte-identical with `actualCostCents: null`; exact replay remains
idempotent across compatible finalizer revisions, over-budget charges are recorded as
`COST_LIMIT_EXCEEDED`, and settled billing cannot upgrade a `RECONCILIATION_REQUIRED` Provider
outcome. Snapshot identity uses canonical paths plus bigint device/inode evidence, output creation is
bound to one private directory identity, and a different finalizer revision can only return an exact
existing receipt. Focused draft/approval/runner/guard/billing tests passed `114` with one
Windows-only POSIX boundary test skipped; repository lint (existing warnings only), workspace
typecheck, the static
contract, sandbox TypeScript compilation, and full preflight passed. Preflight reported `445` passes
and `0` failures. At that earlier approval-hardening checkpoint, no implementation task was
dependency-ready until an edit-capable endpoint/model and the exact paid `QA-02` request were
explicitly approved; `QA-04` and release remained downstream. All flags were default-off, and no
real Provider request, charge, ERP ingest, Ozon write, production mutation, VPS access, deployment,
or `.context/` staging occurred during that checkpoint.

The latest offline hardening binds Linux approval-draft writes, paid-request claim/intent artifacts,
and final billing durability syncs to held private directory descriptors with final visible-path and
handle identity checks. Parent or child replacement cannot silently redirect an artifact into a
replacement path before Provider dispatch. Approval drafting and exact-request preflight now share
one no-follow, descriptor-bounded media verifier that pins SHA-256, enforces the shared `50 MiB` edit
limit before reading excess mask bytes, and verifies MIME, dimensions, pixels, single-page state and
meaningful PNG mask alpha. Hostile-media tests cover non-images, animated WebP, read-time growth and
invalid masks; Linux-only tests cover final-entry symlinks and independent parent/child replacement.
Focused tests passed `197` with six platform/environment-specific skips; full server tests passed
`4371` with `194` skipped. The static contract, sandbox compilation, repository lint (existing
warnings only), workspace typecheck, diff check and full preflight passed; preflight reported `445`
passes, `0` failures and two expected local-package permission warnings. Independent reviews found
no P0/P1 issue. An isolated Docker Linux run corrected an over-broad test fault seam and then passed
the two filesystem/media boundary files `8/8` with runtime networking disabled, including all cases
skipped on Windows; production code did not require a change. Phase 3 remains `4/5` and overall
progress remains `32/37`: no exact paid `QA-02` capability evidence exists yet, all rollout flags
remain default-off, and no Provider call, charge, production mutation, VPS access, deployment, flag
change, or `.context/` staging occurred.

A subsequent sanitized read-only audit found both VPS deployments at `c98a2e4`: international kept
the third-party relay under a legacy `openai-images` label with model `gpt-image-2`, zero price and
all AI media/extension flags off, while domestic remained disabled. One bounded authenticated
`GET /models` returned only that already edit-rejected model and made no generations/edits request.
The paid runtime contract now independently restricts `openai-images` to the canonical official API
and requires relays to use `custom`; manually constructed matching legacy v1 generation/edit
contracts fail before Provider resolution, and suite readiness fails closed even with injected
sandbox evidence. Focused tests passed `138/138`. Phase 3 remains `4/5` and overall progress remains
`32/37`: a different edit-capable endpoint/model and explicit one-request approval are still required.
The final regression run exposed one stable-error mapping issue when an existing paid workflow was
replayed after its endpoint changed; quote reconstruction failures now remain
`MEDIA_PROVIDER_CONFIG_CHANGED` and no job is enqueued. Its focused test passed `83/83`. Repository
lint passed with `20` existing warnings and no errors, workspace typecheck passed, full server tests
passed `4376` with `194` skipped, and preflight passed `445` checks with no failures and the two
expected local-extension permission warnings. Bare official origins now bind the effective `/v1`
transport; a pre-existing v1 contract using the older bare-origin hash fails closed and must be
recreated rather than retried. No Provider call, charge, production mutation, deployment, flag
change, or `.context/` staging occurred during these gates.

The remaining `QA-02` promotion path is now structurally bound to exact sandbox evidence rather than
a provider/model-wide label. Each verified record must match the canonical endpoint SHA-256,
operation, input transport, and sync/async result mode. Generation, edit, translation, and paid-suite
dispatch all fail closed on a missing or mismatched binding; accepted asynchronous translation tasks
still retain their existing poll-only recovery path after registry tightening. A static contract
prevents future registry entries from being marked `sandbox-verified` without complete per-operation
bindings. Focused capability/worker/suite tests passed `87/87`, the Server typecheck passed, and the
Provider foundation contract passed. Repository lint passed with `20` existing warnings and no
errors, workspace typecheck passed, full Server tests passed `4383` with `194` skipped, and preflight
passed `445` checks with no failures and the two expected local-extension permission warnings.
Phase 3 remains `4/5` and overall progress remains `32/37`:
there is still no different edit-capable endpoint/model or explicitly approved paid request. All
production flags remain off, and this offline work made no Provider request, charge, production
mutation, VPS access, deployment, or `.context/` staging.

The supplied custom relay candidate then exposed and closed the remaining preflight identity gaps
without a paid call. Server and extension now canonicalize a bare origin or custom prefix to its
effective `/v1` API Base under one strict HTTPS multi-label-DNS/path contract. Existing extension
profiles migrate serially by invalidating generated results and physically deleting the session Key,
capability evidence, uncertain probes and Provider dispatches before canonical metadata is exposed;
legacy custom frozen hashes fail before Provider resolution. New sandbox verification/output uses
explicit API-base and operation-endpoint hashes (verification v2, submit report v4), while billing
retains exact historical v3 compatibility and emits a dual-hash v2 receipt for current reports.
Combined focused tests passed `246` Server checks with one Windows skip and `95` extension checks;
full Server tests passed `4422` with `194` skipped, lint passed with `20` existing warnings and no
errors, workspace typecheck passed, preflight passed `445/0`, and cloud/local package verification
passed `449/0/0` and `445/2/0` at build version `1.0.264`. Independent review found no P0/P1 issue.
The candidate then passed a bounded authenticated read-only model-catalog check: HTTP 200 with the
exact `gpt-image-2-count` alias as the only listed model. Its Key remains in a private DPAPI file
outside the repository, and raw catalogue/account/billing snapshots remain private. Read-only
billing checks established the paired quota and displayed-usage meters without a Provider POST.

The international sandbox evidence chain now represents sub-cent prices with closed exact-money
objects rather than floats: approval v3, intent v3, submit report v5, billing attestation v2 and
receipt v3 preserve `CNY amount=119 scale=4` exactly. Legacy cents generations remain readable but
cannot authorize or finalize an exact request. Exact intent/report artifacts bind both API Base and
operation-endpoint digests, and finalization requires independent raw-quota and displayed-usage
deltas to prove one actual cost. Focused tests passed `166` with two platform-specific skips; the
static contract, sandbox compilation, diff check, repository lint (`20` existing warnings, no
errors), workspace typecheck, full Server tests (`4468` passed, `194` skipped), and a clean full
preflight rerun passed. Cloud/local/source package verification passed `449/0/0`, `445/2/0`, and
`445/2/0` at build version `1.0.264`.

Phase 3 remains `4/5` and overall progress remains `32/37`: the Provider does not expose a retained
account-specific price record for the alias, but QA-02 does not require live Provider pricing sync.
The selected policy is a private, versioned backend price/limit record bound to the exact alias,
operation, profile, quality, size, image count and currency. It still needs explicit review and a
single-request maximum before any POST. The exact-money implementation and verification made no
Provider POST, image charge, feature-flag change, ERP AI generation, media ingest, Ozon write or
`.context/` staging.

Commit `9e7c8140a17592b76be4b219332f65b58d18cb3f` was then pushed and dark-deployed to both
app-dir VPS targets with every AI Media, extension workbench, legacy generation, translation and
Ozon publisher flag still off. The international backup is
`/var/backups/ss-erp/ss_erp_20260730_053537.sql.gz` (about 36 MB), and the domestic backup is
`/var/backups/ss-erp/ss_erp_20260730_134042.sql.gz` (8.2 MB). Both deployments applied the same
eight pending migrations, passed the post-migration database guard, runtime upload diagnostics,
service/local/public readiness, clean-log and dark-rollout checks, and now report the exact deployed
commit. The domestic verifier additionally passed direct-origin HTTPS, certificate, ACME and unknown
Host rejection checks for all four `.cn` hostnames. Each full verifier reported zero failures and one
warning because backup replication is not configured beyond the readable local artifact. These
authorized deployment and schema changes made no Provider POST, image charge, feature-flag change,
ERP AI generation, media ingest or Ozon write. `QA-02` therefore remains open at `4/5`, and overall
progress remains `32/37`.

The international sandbox CLI now has a private checkout at
`/opt/ss-erp/private/ai-image-sandbox/checkouts/9e7c8140a17592b76be4b219332f65b58d18cb3f`.
It is owned by `deploy:deploy` with mode `0700`; its exact HEAD, required paid-CLI Git blobs and clean
tracked worktree were verified, frozen dependencies were installed, and the sandbox TypeScript
configuration passed. Its ignored `tmp/ai-image-sandbox` link resolves to the deploy-managed private
`/opt/ss-erp/shared/ai-image-sandbox` evidence directory. No Key or private account artifact was
transferred, and no Provider command was run.

The operator subsequently approved exactly one `TEXT_TO_IMAGE` request for
`gpt-image-2-count`, `1024x1024`, `n=1`, with quote and single-request maximum both exact
`CNY amount=119 scale=4`. Operation `qa02-t2i-20260730-063129-01` made one Provider POST without a
retry and returned one visually accepted 1024x1024 PNG. Private before/after meters independently
proved raw quota delta `5950` and displayed usage delta `1.19`, both equal to `CNY 0.0119`.
Commit `5f6d3dd8ccac5e060189bec427400cc06c3a97ec` now binds exact settlement to one authenticated
Relay Token-log entry and globally claims that immutable billing identity. Security review closed
an isolated-claim recovery gap by also binding the claim to the attestation digest and found no
remaining P0/P1 issue. Focused tests passed `51` with one Windows skip; lint, static/sandbox
contracts, workspace typechecks, full preflight (`445/0` with two expected warnings), and the full
Server suite (`4488` passed, `194` skipped) passed.

The official network-free finalizer ran from a clean deploy-owned private checkout of `5f6d3dd`.
Its sanitized v4 receipt has SHA-256
`83ec0e913baefe0cfb5145d983ce48bf237865d0479725354d792c1e8b9b0423` and records `SUCCEEDED`,
`CHARGED`, `billingGate=PASS`, actual/quoted/maximum `CNY 0.0119`, one billed unit and
`sameRequestRetryAllowed=false`. Exact replay returned the same receipt bytes. Original
intent/report hashes remained unchanged, append-only outputs are private, and both VPS dark
verifiers passed. This was one real Provider charge; it did not switch either production app,
enable a flag, generate or ingest ERP media, write Ozon, or stage `.context/`.

Phase 3 remains `4/5` and overall progress remains `32/37`. The Relay has no documented or
configured explicit async task protocol for this alias/profile, so async is recorded unsupported
without another paid POST. The completed text-to-image evidence does not prove reference edit, full
edit or inpaint. Each edit operation requires a separate exact backend price/limit record, explicit
single-request approval and reconciled evidence. `QA-04`, `REL-02`, `REL-03` and `REL-04` remain
blocked behind full `QA-02` acceptance.

The operator then approved one separate `IMAGE_TO_IMAGE` request for `gpt-image-2-count`, the same
square profile and the accepted mug source, with quote `CNY 0.0119` and maximum `CNY 1.0000`.
Policy/source/pre-call snapshot, revision, dark state and official offline approval verification all
passed. Operation `qa02-i2i-20260730-083710-01` made exactly one `/v1/images/edits` POST and returned
a definite `REJECTED` v5 report after `155 ms`, with `createRequests=1`, no Provider request-ID hash
and `PROVIDER_REQUEST_FAILED`. It was not retried.

Both Provider meters had zero delta and the authenticated Token log had no matching consume entry.
The official finalizer wrote sanitized exact receipt v3 SHA-256
`c05aaa7e31a545e0be6a5107a7300e30d4d10f2ef634d7472a51dd064f5db855`, recording `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; exact replay returned the
same bytes. Both VPS remained dark. The alias is therefore directly evidenced as generation-capable
but incompatible with the Relay's shared edit transport. `FULL_EDIT` and `INPAINT` were not sent and
must not be attempted against this same endpoint/model.

Task counts remain Phase 3 `4/5` and overall `32/37`. Full `QA-02` now requires a different
edit-capable endpoint/model; `QA-04`, `REL-02`, `REL-03` and `REL-04` remain dependency-blocked.

The alternate candidate `https://ai.centos.hk` then passed a no-key public network preflight. Its
effective API Base is `https://ai.centos.hk/v1`; public resolvers and the international VPS returned
three Cloudflare public IPv4 addresses, TLS 1.3/SNI/hostname verification passed, and the project
URL/SSRF validator accepted it from clean checkout `5f6d3dd`. Bounded unauthenticated GET checks
confirmed `/v1/models` is credential-gated and made no redirect or Provider operation.

The candidate's public pricing revision lists `gpt-image-2` with `model_price=0.1` under the site's
CNY display configuration, but advertises only `/v1/images/generations` for image traffic and does
not advertise `/v1/images/edits`. This is not edit-capability evidence and is not a maximum-cost
authorization. Its public frontend contains a generic `/v1/images/edits` route constant, but that
constant is not bound to this account, model or upstream channel. Public snapshots and manifest SHA-256
`92d0bf08298d0c9254687ca1e0369200f99dc68c5451180ccf2182937dc3b6b4` remain outside Git. The Key
provided in conversation was treated as exposed and was never used. The operator rotated it and
stored the replacement in a private current-user DPAPI file under non-secret revision
`centos-key-rotation-20260730-01`.

The replacement credential passed a bounded authenticated GET-only check with redirects disabled,
no body and a 1 MiB response cap. Its catalogue and Token model limits contain only `gpt-image-2`
and `gpt-image-2-2k`; both still advertise only `image-generation` and `openai`. Token quota,
displayed usage and the empty Token log were byte-identical before and after the checks, proving no
charge. Private read-only summary v3 SHA-256 is
`6ae534108272abcc84fef7f75abf8114d73304ea7ccca2bdb0283c771c1b510a`; secret scans were clean.
This proves the credential and reconciliation endpoints, not edit capability. No Provider POST,
charge, production mutation, deployment, flag change, or `.context/` staging occurred. Counts
remain `32/37`.

The operator then authorized one separate `IMAGE_TO_IMAGE` probe for the alternate candidate:
`gpt-image-2`, `1024x1024`, `n=1`, the accepted mug source, quote `CNY 0.1`, and maximum
`CNY 1.0`. Operation `qa02-centos-i2i-20260730-094857-01` passed the private policy, pre-call
snapshot, deployed-checkout, dark-state and official no-key approval gates. Its Key was injected
from DPAPI through SSH standard input and never entered a command argument or retained artifact.

Exactly one `/v1/images/edits` POST returned a definite `REJECTED` report after `302 ms`, with
`createRequests=1`, no Provider request-ID hash and `PROVIDER_AUTH_FAILED`. It was not retried.
Raw quota and displayed usage were byte-identical before/after and the Token log remained empty.
Official exact receipt v3 SHA-256
`9d1e5db49dc5b76e7de70e36cad88a7429e426b3e93de4207ad62a46c040e2d2` records `NO_CHARGE`,
`billingGate=PASS`, `billedUnits=0`, and `sameRequestRetryAllowed=false`; exact replay returned the
same bytes. Both VPS remained dark and private-artifact credential scans passed.

This is operation-specific negative evidence: the rotated Token can read the catalogue and billing
endpoints but the current `gpt-image-2` edit route is not accepted. It does not prove this candidate's
generation behavior. `FULL_EDIT` and `INPAINT` must not be sent through the same endpoint/Token/model.
QA-02 still needs another edit-capable endpoint/credential or an explicit Provider-side edit enablement
followed by a fresh bounded approval sequence. Counts remain Phase 3 `4/5` and overall `32/37`.

The offline follow-up closed the remaining runtime gaps without promoting any failed or unverified
model. An exact sandbox-verified `custom` OpenAI-compatible profile can now pass generation,
image-to-image, full-edit, inpaint and paid-suite boundaries only when the active API Base, model,
operation, multipart/none transport and sync mode all match its operation-specific evidence. Route
readiness is rechecked before workflow creation and reservation, and queued generation performs the
same request check before its immutable Provider-dispatch fence; evidence drift therefore cannot be
misclassified as an uncertain network submission. Reference limits are operation-specific.
`INPAINT` accepts a decoded PNG/JPEG/WebP source but requires one same-size decoded PNG mask before
dispatch. Current sandbox quality remains `PROVIDER_DEFAULT_OMITTED`; an explicit quality tier needs
a new profile and pricing policy.

Future HTTP 4xx/5xx sandbox rejections write one private, exclusive v1 diagnostic sidecar bound to
the authoritative submit-report SHA-256. It contains only Operation ID and integer HTTP status,
does not change historical v4/v5 reports or billing semantics, and a sidecar failure cannot replace
the original Provider result. Focused tests passed `371/371`; the static contract, workspace
typecheck, lint (`0` errors with `20` existing Server and one shared warning), full Server suite
(`4509` passed, `194` skipped), and full preflight (`445/0` with two expected local-package warnings)
passed. Independent reviews found no remaining P0/P1/P2. No real Provider call, charge, deployment,
flag change, ERP media mutation, Ozon write, or `.context/` staging occurred. Phase 3 remains `4/5`
and overall progress remains `32/37` because positive edit capability evidence is still absent.

An offline `QA-04` rehearsal starting from pushed commit `410981e`, with the fixture fixes below,
then rebuilt and verified extension version `1.0.264`: cloud passed `449/0/0` and local passed
`445/2/0` with only the expected local permission warnings. The Server production build passed. The
real local PostgreSQL gate initially found ten expired test fixtures whose fixed July 27/28
pairing/session expiry preceded the database insertion time. The two fixture families now preserve
their intended event chronology while binding valid record creation time. A clean rerun applied all
`142` migrations to a fresh isolated schema,
passed all 20 AI Media PostgreSQL integration files, and passed the populated migration-upgrade
sequence; every temporary schema was removed. Server typecheck and diff checks passed. This is only
rehearsal evidence: `QA-04` remains open until complete positive `QA-02` evidence exists and the
entire gate is rerun on the final revision. No Provider request, charge, VPS mutation, deployment,
flag change, ERP media mutation, Ozon write, or `.context/` staging occurred. Counts remain `32/37`.

Release preparation now has one coordinated, fail-closed cloud/local packaging path without
claiming `REL-03` completion. `pnpm package:extension` chooses one version, holds an exclusive lock,
writes artifacts durably without overwrite, verifies extracted ZIP paths/CRC/file counts and
retains a canonical checksum plus closed-schema evidence. Three independently approved public HTTPS
origins must exactly match deployment defaults and every concrete cloud permission surface. Evidence
binds a full 40-character commit, source mode and deterministic package-input digest; both the
coordinator and independent verifier recompute the inputs and repository Git state. The migration
floor is the last verified legacy package `1.0.264`, so the first canonical release is `1.0.265` and
cannot downgrade installed Chrome extensions. `signature.status=EXTERNAL_REQUIRED` remains an
explicit unsigned boundary. The focused package/deploy matrix passed in `213.6s`, and two independent
reviews found no remaining P0/P1/P2.

A fail-fast `pnpm qa:04:offline` command now records an eight-step, network-free rehearsal manifest
and rejects any Provider, VPS, remote-smoke or deployment command. Its final run passed in `583.5s`:
diff check, workspace lint (only the existing `20` Server and one shared warning), workspace
typecheck, full preflight with Server tests and Server/Web builds, all AI Media PostgreSQL integration
and populated upgrade gates, and fresh cloud/local builds passed. Package verification reported
cloud `450/0/0` and local `446/2/0`, with only the two expected local permission warnings; a Prisma
query found no current-run `20260730` test schema. This remains rehearsal evidence because positive
edit-capable `QA-02` evidence does not exist. `QA-04`, `REL-03`, `REL-04` and `REL-02` therefore stay
unchecked; Phase 3 remains `4/5`, Phase 5 `3/4`, Phase 6 `0/3`, and overall progress stays `32/37`.

An offline distribution review then found that `/api/extensions/latest` and the target download
routes could still trust mutable unpacked manifests or reconstruct a ZIP without canonical release
evidence. The server now serves only one repository-source cloud/local evidence set bound to the
current full `DEPLOYED_COMMIT`; canonical evidence, checksum, ZIP digest/structure, target manifest
and file count must agree. Version/SHA-bound URLs prevent `/latest` and download from crossing
versions, startup metadata is selected once, and only the requested target is verified and cached.
Missing, mixed, replaced or symlinked artifacts fail closed. Unverified reconstruction requires an
explicit non-production development option. Staging writes `DEPLOYED_COMMIT` only after API/Worker
quiescence, requires clean matching Git provenance including ignored source files, and strictly
verifies the current release set before migration even with `--skip-build`. Canonical evidence now
also records the independently approved local origin exactly as `http://127.0.0.1:3001`; formal and
runtime readers both reject symlink artifacts and enforce stored-ZIP CRC, bounded sizes, portable
paths/collisions and contiguous local records. Mutable discovery responses use `no-store`. This is
offline hardening, not signing or distribution:
`signatureStatus=EXTERNAL_REQUIRED` remains explicit, `REL-03` stays open, and counts remain
Phase 3 `4/5`, Phase 5 `3/4`, Phase 6 `0/3`, overall `32/37`. The operator has paused further paid
edit-capability testing until a genuinely edit-capable Provider endpoint/model/credential exists;
no Provider request, charge, VPS access, deployment, production mutation, flag change, ERP media
mutation, Ozon write or `.context/` staging occurred.

The resulting offline distribution patch passed the focused download matrix (`7` passed with one
Windows-only symlink case skipped), Server typecheck and targeted lint, deployment/documentation
contracts, the full Server suite (`4514` passed, `195` skipped), and the coordinated
package/deployment matrix in `212.7s`; diff check also passed. This verification does not provide an
external signature, website download receipt, clean install/upgrade smoke or distribution, so formal counts and
release ordering remain unchanged.

Subsequent offline release hardening closed the remaining environment and Git provenance gaps: the
fixed local extension origin no longer requires a pre-existing operator env value, while templates
document it; direct Git checkouts now fail closed on inspection failure, invalid or dangling `.git`
metadata, and archive trees cannot inherit an unrelated ancestor checkout. The coordinated package
matrix passed on a stable HEAD and commit `4367384` was pushed.

Offline `REL-04` preparation also added a mandatory pre-migration database backup attestation gate.
Real gzip bytes, compressed SHA-256/size, an immutable canonical status sidecar, stable database ID,
full target commit, successful temporary restore, positive table count and bounded freshness are
verified again before each systemd or Compose migration. Evidence files are `0600`, no-follow and
identity checked; verification streams SHA-256/gunzip under an external timeout. Compose binds a
clean stable HEAD and mounts the evidence directory read-only. The release evidence directory uses
`DEPLOY_BACKUP_LOCAL_DIR`, separate from application-managed backup cleanup. Native focused gates and
an offline Debian run passed all `28` POSIX backup/restore/symlink/mode assertions. Workspace lint
had zero errors and the existing `20` Server plus one shared warning; workspace typecheck,
Dockerfile check, both Compose config parses and full preflight passed. Preflight completed in
`464.8s` at `445/0` with the two expected local-extension warnings. No real database backup,
restore, migration, VPS access, deployment, canary, Provider request, flag change or Ozon write
was performed. `REL-04` therefore remains preparation-only; Phase 6 stays `0/3` and overall
progress stays `32/37`.

A final offline `REL-04` hardening pass now gives root orchestration, runtime execution and builds
three explicit trust levels. The distinct non-root `ss-erp-build` UID/GID receives no supplementary
groups or runtime secrets; stable root env snapshots, pre/post closed source manifests and new-inode
sealing bind every systemd build before migration. Unexpected ignored root `.env*` inputs fail
closed, and runtime cache creation no longer recursively changes ownership of build-produced paths.
Compose uses root-provisioned global project locks and a private target-commit archive whose digest
is verified before either Dockerfile executes repository code; commit and archive markers are
checked again by the migration container. Backup restore now binds maintenance and restore routes
with a random database marker, requires an actual drop of the created temporary database, and can
refresh an expired same-commit attestation only after root archives the old exact bytes under their
SHA-256. A no-network Debian run passed the full `52/52` POSIX deployment/backup matrix. Lint had no
errors and only the existing `20` Server plus one shared warning; workspace typecheck passed; the
Server suite passed `4515` with `195` skipped; final preflight passed `445/0` with two expected local
package warnings in `415.8s`. BuildKit checks had no Dockerfile warnings, both Compose configs
parsed, and cloud/local/source extension verification passed `450/0/0`, `446/2/0` and `445/2/0` at
version `1.0.264`. No real backup, restore, migration, VPS access, deployment, canary, Provider
request, charge, flag change, ERP media mutation, Ozon write or `.context/` staging occurred.
`REL-04` remains preparation-only; Phase 6 stays `0/3` and overall progress stays `32/37`.

The offline release handoff now preserves one `REL-03` candidate across `REL-04`: a bounded
no-follow staging CLI selects and byte-preserves exactly one target-commit/origin/source-bound
cloud/local ZIP, checksum and evidence set, then independently re-verifies the staged copy. The
three systemd deployment entrypoints require a root-owned `EXTENSION_RELEASE_ROOT` under
`/var/lib/ss-erp-extension-releases` and no longer package or increment extensions during deploy;
after staging, root removes build-UID writes and the sealed tree must byte-match that input again.
The QA-04 rehearsal also gained a real isolated PostgreSQL scope/JTI/session revocation lane and
adversarial remote-code/eval/Worker/Wasm/CSP package tests. This is offline preparation only:
external signature/website receipts, actual distribution, signed-package upgrade smoke, final QA-02
evidence and all real rollout actions remain open. Counts stay `32/37`.

The enlarged nine-step QA-04 offline rehearsal subsequently passed in `817.7s`, including both
isolated PostgreSQL lanes, full preflight/builds, and cloud/local/source verification at `451/0/0`,
`447/2/0`, and `446/2/0`; no `20260731` test schema remained. Final release-handoff regressions also
cover Git environment poisoning, root-owned checkout reads, `umask 077`, non-root artifact access,
and post-stage ZIP replacement. The sealed deploy tree must now byte-match the immutable root
candidate after build-UID writes are revoked. This is still offline preparation: no formal task,
flag, Provider request, VPS, migration, signature, distribution, pilot, or Ozon action completed,
so the five open tasks and `32/37` count remain unchanged.

The final release-handoff review then closed the remaining provenance and in-place lifecycle
blockers without changing a formal task. Repository-source extension packages and all three
deployment archive paths now read pinned raw Git blobs with inherited `GIT_*` redirects and
replacement objects disabled; local attributes, clean/smudge filters, checkout EOLs,
`assume-unchanged`, and `skip-worktree` cannot alter the claimed build bytes. The production reader
accepts a clean-checkout `GIT_HEAD` candidate only when its commit equals `DEPLOYED_COMMIT`;
external-source and wrong-commit evidence still fail closed. Staging executes its verifier from the
preinstalled root gate, leaves the successful checkout root-frozen, and installs only root-owned
links to external media, backup, sandbox-evidence, and commit-scoped Web-cache directories. Before
any thaw, a root helper installs exact-path systemd write boundaries, writes a persistent marker
bound to sibling deploy/runtime roots, and stops all three services; a process kill or reboot cannot
start them from a writable checkout. Focused package/download/deployment tests, no-network Debian
root lifecycle `5/5`, and the final nine-step offline rehearsal passed in `991.8s`;
cloud/local/source verification was `451/0/0`, `447/2/0`, and `446/2/0`, and no `20260731` temporary
schema remained. No Provider, VPS, deployment, signature, distribution, feature flag, pilot or Ozon
action ran. `QA-02`, `QA-04`, `REL-03`, `REL-04`, `REL-02` and the overall `32/37` count remain
unchanged.

The PackyAPI candidate is prepared for bounded authenticated edit verification, but it is not
capability evidence yet. Credential revision `packy-sora-key-rotation-20260801-01` previously
passed a bounded same-origin GET-only observation at `https://www.packyapi.ai/v1`: models, raw
quota, displayed usage, and Token log returned HTTP 200 with byte-identical before/after snapshots.
That remains historical transport evidence from the time of observation only; it is not an active
credential gate. Its sanitized read-only manifest SHA-256 is
`5f5829e7ec0d8703956112878929894bb161bf51e53ce51d3f8bda4e2a8ff3fc`. A later attempt to run the
new official preflight delivered the credential as UTF-16 and exposed its Authorization value in
local stderr while Undici rejected the header, before network dispatch. The credential is now
invalid and its DPAPI artifact is quarantined. Replacement revision
`packy-sora-key-rotation-20260801-02` is present only in the active current-user DPAPI path and has
not yet run the official authenticated preflight. The
`https://slb-v1.api.fan/v1` edge has incomplete same-origin metering and remains excluded from paid
verification; the selected candidate API Base is `https://www.packyapi.ai/v1`.

Public documentation identifies model `gpt-image-2`, Sora-group access, synchronous multipart
`/v1/images/edits`, and the three operation mappings. Public price remains only an input to private
policy: each operation has a USD `0.08` quote and USD `1.00` single-request maximum; Provider price
synchronization is not required. Private bounded source/mask media remain reusable. All policy and
approval drafts bound to `slb-v1.api.fan` are obsolete, and the main-base policies and schema-v3
drafts bound to invalid credential revision `packy-sora-key-rotation-20260801-01` must not be
finalized or used.

The invalidated private main-base policy revisions have SHA-256 values `4f962b72ce5005c437e0df5887c6cd76b7c56abadfa0061b4dc90f0b8464cefa`
(`IMAGE_TO_IMAGE`), `cbdf62711fe3986366fe51c1ff61d7342ece8d79e9f509ff63127d5b8e1e3b76`
(`FULL_EDIT`), and `074b9ccb59d2561b27af19c834068b6d0c5bd926b64fd8aaa0de870b074344d1`
(`INPAINT`). Clean checkout `cd8455e5818576300bc07dae80e7b46b0f49cc65` generated matching
schema-v3 draft SHA-256 values `e1674527ac78d2fd81f4b4fab3221834666ea2b5f4072b53d78a3ef5a839928b`,
`255263c896789ceed1b2c7bbe587f54d9f72c1550f968d7e0ea0c3371b9b315f`, and
`8cbe900f84f3b99ff6fb23db7e9a7ce6d4e0bd38b4a4dff3d228a9196d5aee0f`. They retain the mandatory
review sentinels and are historical preparation evidence only. After Provider-side rotation, every
credential-revision-bound policy and approval artifact must be regenerated and independently
reviewed.

The official `sandbox:ai-image:readonly:preflight` helper accepts a credential only through bounded
UTF-8 stdin, performs the fixed seven-GET observation, and writes a descriptor-bound private
evidence bundle. After the safe `ac41efa` schema rejection and three diagnostic GETs, the focused
Windows matrix passed `55` with four POSIX skips, the Linux `--network none` matrix passed `59/59`,
and static contract, sandbox typecheck, targeted script ESLint and diff checks passed. Clean commit
`e4503e9253b15eea5540dd436bf027c713cd3739` then completed the official sequence under replacement
credential revision `-02`. Manifest SHA-256
`9f3dbc30bf2b78b99ede50bdfd285d3f932580cab1ddc5a52812ae7cbacb7b0f` binds seven fixed GETs;
all eight file names, hashes, byte lengths, routes, methods, HTTP 200 statuses, normalized content
types and private ACL identities were independently verified. The exact model is visible, raw quota,
displayed usage and Token log are byte-identical before/after, and exact plus generic credential
scans are clean. The manifest records `providerPostSent=false` and `chargeObserved=false`.

A new private proposed `IMAGE_TO_IMAGE` policy now binds `gpt-image-2`, the square one-image profile,
default-omitted quality, quote USD `0.08`, maximum USD `1.00`, and the successful read-only manifest.
Policy SHA-256 is `9b91a0fa1f3e98177ea5d085e3201e9146b617af7368c351f9e1080324f980cb`;
schema-v3 draft SHA-256 is
`1f2d3bb6389856ed63c0ea443a6196a250bd8e1606a3aa2d327129aca71976e4`. The draft binds that policy
digest, replacement credential revision `-02`, adapter revision `e4503e9`, and local
prepared source SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`,
not the earlier Centos request's `481527...f0b` source; those bytes are not present locally and its
authorization cannot be reused. The new draft retains all review sentinels, and the offline verifier
rejects it with `SANDBOX_APPROVAL_SCHEMA_INVALID`. At that preparation checkpoint no Packy POST or
charge had occurred.

The operator then explicitly approved the exact source-bound request. Fresh pre-call manifest
SHA-256 `e9cef9fb0a2efeefae62646f6bd32345e1782e28982e02d3db1608402ae172df` and canonical snapshot
SHA-256 `f653a02f3e9e0d80be45ca5550b5820b4620b5c1dee307eb407d43e38f32f99e` preceded final approval
SHA-256 `de530a1d7f4258b713e909d91c444ffa0faf3832f42ad7639b9153a4d8438da4`; the final file differs
from the draft only in statement and approval/expiry timestamps, and official no-key verification
passed. Operation `qa02-packy-i2i-20260801-e4503e9-01` sent one multipart POST without retry. Its
v5 report is definite `REJECTED`, `createRequests=1`, HTTP 400, `PROVIDER_REQUEST_FAILED`, no
Provider request-ID hash and no image. Report SHA-256 is
`02ab909a2dc4d8cda2858f7291f41ebacb2e3e686f5583419bbdd1d8907a4c3e`; intent SHA-256 is
`bedb0b0a17e45190de71ba0578b04b950c37eeb7106ff012d70ffc62a04ea8e8`.

Settled GET-only manifest SHA-256
`b64bb39aa4d55cfb38a4c1ba44a1601cc9de605e0823a1e8b226c9e2c2eaf5b4` proved zero raw-quota
delta, zero displayed-usage delta and an unchanged empty Token log over a `329871 ms` exclusive
window. Exact attestation SHA-256
`3ce448fe0dfc21d25d4862c03aa0d7c2198da9d3676e4fdee8d27f05fae83e70` produced the receipt
above; exact replay returned identical bytes. A six-record private execution archive has manifest
SHA-256 `43a2a316ba75055442553d4f8d9983f0b9c0d51878c56bb08e7d014bf2e31eaf`.
Private run-summary SHA-256 is
`e1e2c54583fd25f817b6d5021b024503303b15db74fbe259738a07ec9dc1c896`. Credential scans across
38 retained files and private ACL checks passed. The offline dark-deployment guard passed, and no
Registry, feature flag, VPS, deployment, ingest or Ozon mutation occurred. The sandbox static
contract, candidate review contract `27/27`, dark-deployment guard, diff check and full preflight
`446/0` passed with the two expected local-extension permission warnings.
`QA-02` remains `4/5` and overall progress remains `32/37`.

An offline follow-up now prevents a future HTTP 200 from becoming false-positive QA-02 evidence.
The single-submit runner fully decodes each returned image, rejects truncated or animated output,
enforces shared byte/pixel/MIME limits, and requires the decoded dimensions to equal the approved
request profile before writing a `SUCCEEDED` report. A post-acceptance validation failure remains
`RECONCILIATION_REQUIRED` and retains the known Provider request-ID hash. The capability-candidate
reviewer independently requires `requestedSize` to equal the reported width and height. Focused
runner tests passed `61/61`, candidate review passed `29/29`, and Server/sandbox typechecks,
targeted lint, the static single-submit contract and diff checks passed. Full preflight passed
`446/0` with the two expected local-extension permission warnings. This hardening made no Provider
request or charge and does not change the `32/37` count.

The documented Packy follow-up is now a separate immutable request profile rather than a relabeled
retry. It requires exact Packy API Base/host/endpoint/model identity, edit-only operation,
`1024x1024`, `n=1`, `quality=high`, `output_format=png`, `response_format=url`, and PNG output;
optional `input_fidelity` stays omitted. Profile and Provider identity are bidirectionally bound,
legacy cents evidence is rejected, and the request fingerprint includes the exact multipart
dialect and fields while historical non-Packy fingerprints remain byte-compatible. Provider,
approval, guard, runner and billing focused tests passed `275` with two skips; Server/sandbox
typechecks and the static single-submit contract passed. Full preflight passed `446/0` with the two
expected local-extension permission warnings. No Provider request, charge, Registry, deployment,
flag, ingest or Ozon mutation occurred, so counts remain `4/5` and `32/37`.

At the preparation checkpoint, clean adapter commit
`9b6cc058091837aa17641871c94138e9c164c0a6` had been pushed, and a detached private checkout had
generated the next non-approval artifacts without reading the DPAPI credential.
Proposed operation `qa02-packy-i2i-documented-20260801-9b6cc05-01` reuses only the retained source
bytes with SHA-256 `5d2627b439825054a0205afc97fab6444cffa64085c31e68f8f37781520b6e32`.
Pricing policy `qa02-packy-gpt-image-2-i2i-documented-usd-v1-9b6cc05` has SHA-256
`8744574db12812666ba16b4a7725d8dd617fcddb03b7f98bd722ae4dd002977c`; schema-v3 draft SHA-256 is
`1bad6cdb203914f54dfb1935b6c50b977cd2b0f9e8c6f4427e9bc253bd061da1`. The draft retains all
review sentinels, the official no-key verifier rejects it with `SANDBOX_APPROVAL_SCHEMA_INVALID`,
and private ACL plus digest checks pass. At that point, USD `0.08` and USD `1.00` were only proposed
quote/maximum values, not a new authorization, and no Provider GET/POST, credential read, or charge
had occurred.

The operator then approved that exact source-bound request. Fresh pre-call manifest SHA-256 was
`0916cb23af6d79034de743574bdfade8b16cb98199d9914b2e482608360cab42`; final approval SHA-256 was
`791cced1ebf2cffd37d750c6a99c45d3b1efe4f76fb6e2fac65f7ba26d580198`. The guarded client sent one
documented multipart POST and received HTTP 400 without a Provider request ID or image. It did not
retry. Settled manifest SHA-256 was
`57c33eb2e05eab8687cabac92d80162361e3bd8f96e9e530cd4e59a084c0b954`; all three billing bodies
remained byte-identical. Exact v2 attestation SHA-256 was
`9bfcbf8d4de39772a5d3a3fe966be6b9c677d2a00ee11f1d907c0bbf93ce3dff`, and official v3 receipt
SHA-256 was `c62bbc576368df51e72406023ff9e2a4be2551498d0fd3f7f5ef7d5a6e342d36`. Receipt replay was
byte-identical. Six sanitized execution files were archived under manifest SHA-256
`3a59161e3fd4da8e9b6aa9b4054189513bff076591c1eb006063e8232f7c97cc`; private run-summary SHA-256
is `4c0c402ad872b13dd2204c1f0fc6b54d1e42fd9884542378abb9ccf5e9ac81fa`. Exact Token and generic
credential scans found zero matches, and private ACL checks passed. No Registry, deployment, flag,
ERP ingest, or Ozon mutation occurred. Counts remain `4/5` and `32/37`.

The next materially different Provider lane is now implemented offline against the official Wanx
2.1 asynchronous image-edit contract. Three closed profiles map `IMAGE_TO_IMAGE` and `FULL_EDIT` to
`description_edit`, and `INPAINT` to `description_edit_with_mask`; the logical operations retain
separate approvals and fingerprints even when the Provider function matches. The guarded runner
sends bounded source/mask data URLs, persists the raw accepted task ID and temporary result URL only
in private recovery files, polls only that task, requires one successful metered image, and never
forwards Provider Authorization to result storage. The guard and adapter share an idempotent task
identity persistence callback; the guard's bounded `32 MiB` clone reader never waits for clone
cancellation, so an accepted response cannot deadlock before recovery evidence is durable. An
accepted-task uncertainty remains
`RECONCILIATION_REQUIRED` and cannot trigger a second POST. The offline finalizer independently
recomputes the Wanx transport/function request fingerprint and exact Provider identity; technical
async sidecars do not substitute for actual billing evidence.

Focused approval, runner, guard, provider, and settlement suites pass `292` tests with two platform
skips. The full Server suite passes `4699` tests with `199` platform skips. Repository lint has zero
errors and only the existing `20` Server plus one shared warning; workspace and sandbox typechecks,
the static contract, and diff checks pass. Full preflight passes `446/0` with the two existing local
extension permission warnings. This checkpoint permits continued fixture-based `QA-04` and
release-orchestration development, but final `QA-04`, `REL-03`, `REL-04`, and `REL-02` completion
remains gated on live positive `QA-02` evidence. No Alibaba credential was read, no Provider request
or charge occurred, and no VPS access, deployment, flag, ERP ingest, or Ozon mutation was performed.

PicPi credential revision `picpi-sub2-20260801-r2` then passed authenticated `GET /v1/models`: the
HTTP 200 catalogue contained 13 models including `gpt-image-2`. The exact approved operation
`qa02-picpi-i2i-20260801-de951b7-01` bound API Base `https://api.picpi.top/v1`, endpoint
`/images/edits`, profile `OPENAI_SQUARE_SINGLE_V1`, one `1024x1024` source with SHA-256
`5d2627b4...b6e32`, quote USD `1.00`, and maximum USD `1.00`. From clean submission revision
`de951b7`, the runner sent exactly one POST and did not retry. PicPi returned definite HTTP 400 after
`2025 ms`; report SHA-256 `87a574b0...f239f` records `REJECTED`, one create request, response-ID
hash `f4cfe87f...de017`, no usage, and no image.

Authenticated `GET /v1/usage` raw SHA-256 `654b930e...3efcf` showed this API Key's today and
lifetime `requests=0` and `actual_cost=0`. Sub2 upstream source confirms that lifetime total is the
Key-filtered usage-log count and actual-cost sum, including logged failed requests. Finalizer
revision `0d42a87` added the closed v4 cumulative-zero attestation without relabeling request counts
as raw quota or fabricating a before snapshot. Attestation SHA-256 `a82fded6...0764f` produced v5
receipt SHA-256 `e2ed71a3...65cd`, with `NO_CHARGE`, `PASS`, zero billed units and no same-request
retry; offline replay was byte-identical. Nine private evidence files passed hash, ACL, reparse and
credential checks under archive manifest SHA-256 `a91d8105...3476`; private run-summary SHA-256 is
`3708060f...fe36`. Focused settlement/finalizer tests passed `93` with one platform skip, the full
Server suite passed `4709` with `199` skips, and Server typecheck, target lint, static contract and
diff checks passed.

This closes billing only and remains negative capability evidence for the exact PicPi
route/account/model/profile. No Registry mutation, deployment, feature-flag change, ERP media
mutation, Ozon write, VPS access, or image quality review occurred. Do not retry this Operation ID,
rename the request, or use it to authorize `FULL_EDIT` or `INPAINT`. Counts remain `4/5` and
`32/37`; `QA-04`, `REL-03`, `REL-04`, and `REL-02` remain blocked on complete positive `QA-02`.

## Next Steps

1. Do not repeat `qa02-t2i-20260730-063129-01` or `qa02-i2i-20260730-083710-01`; both requests and
   billing are closed and their receipts explicitly forbid same-request retry.
2. Do not retry `qa02-centos-i2i-20260730-094857-01` and do not send `FULL_EDIT` or `INPAINT` with
   the same `ai.centos.hk` Token/model. Its catalogue authentication works, but its edit POST was
   definitively rejected by the Provider authentication layer and settled with no charge.
3. Never restore or reuse quarantined credential revision
   `packy-sora-key-rotation-20260801-01`. Never retry either consumed Packy operation
   `qa02-packy-i2i-20260801-e4503e9-01` or
   `qa02-packy-i2i-documented-20260801-9b6cc05-01`, substitute a new ID for either request, or reuse
   either approval for `FULL_EDIT`/`INPAINT`. Both the generic and documented multipart contracts
   received definite HTTP 400 responses and settled with no charge. A later paid Packy test requires
   a Provider-confirmed route/account/contract change that is materially different from both closed
   requests, followed by a new policy, approval, and reconciliation; otherwise select a different
   edit-capable Provider. Do not use
   `slb-v1.api.fan` for a paid request because its same-origin settlement meters are incomplete.
   Provider price API synchronization is not required. Only after all three positive custom
   derived-image reports, billing receipts, and human quality review pass the candidate-only
   boundary may a separate reviewed change add the exact provider/model contract to
   `scripts/sandbox/ai-media-provider-contract.mjs`; never pre-authorize a failed candidate.
4. Do not retry `qa02-xiaoyi-i2i-20260801-f189dfa-01` or
   `qa02-xiaoyi-minimal-i2i-20260801-78fe4c7-01`, rename either request, or send `FULL_EDIT`/`INPAINT`
   through either Xiaoyi profile. The V1 five-field and documented V2 three-field synchronous
   requests both received definite HTTP 400 responses and settled with no charge. Another paid
   Xiaoyi attempt requires Provider-confirmed account permission or a materially different route and
   contract, followed by a new profile, policy, Operation ID, approval, and reconciliation;
   otherwise use a different edit-capable Provider. Async remains unverified and cannot inherit
   either profile's approval or evidence.
5. Keep the successful Wanx catalogue manifest and consumed capability-only operation
   `qa02-wanx-i2i-20260801-3ac48e4-01` immutable. Its image quality is approved; never retry or
   rename that request. Either correlate its task to the API Key's real billing account or retain
   billing as explicitly unresolved; the unrelated Bailian console snapshot must never enter a
   receipt. Provider price API synchronization is not required. Keep the consumed `FULL_EDIT`
   operation immutable; its image quality is approved, and it must never be retried or renamed.
   Keep the consumed `INPAINT` operation immutable; its image quality is approved with the subtle
   blue-gray shift and visible hard test-mask boundary explicitly accepted. None of the operations
   may inherit another operation's approval. `QA-02` technical acceptance is complete, while all
   three unresolved Wanx billing chains remain ineligible for candidate promotion or Registry use.
6. Never retry consumed PicPi operation `qa02-picpi-i2i-20260801-de951b7-01`, substitute another ID
   for the same request, or reuse its approval for `FULL_EDIT`/`INPAINT`. Its exact generic multipart
   contract received definite HTTP 400 and settled with no charge. Another PicPi paid attempt
   requires a Provider-confirmed material route/account/contract change followed by a new profile,
   policy, Operation ID, approval, and reconciliation; otherwise use a different Provider. Keep the
   public DNS pins `104.21.13.92` and `172.67.167.234`; never weaken the guard to accept proxy fake-IP
   `198.18.0.29`.
7. Keep all earlier release candidates, signatures, failed deployment receipts, Provider results,
   append-only reconciliations, and consumed operations immutable as historical evidence. The
   `1.0.283` BINI authorization is exhausted at `2/2`, every earlier Provider allowance is also
   consumed, and no Provider POST or retry is currently authorized. Its encrypted formal candidate
   expired after the worker-restart authority mismatch and must never be ingested. The dark
   `ad4b8714b53d0826ffe470f6db97b6906dcc52c0` / `1.0.284` replacement pre-release is complete:
   QA-04, regional package/sign, signed MV3 restart and upgrade smokes, dual-region deployment and
   download receipts, BINI same-path upgrade, trusted reload, active-worker attestation, and Unicode
   smoke all passed with no Provider call. All pilot flags are dark; the BINI session Key and
   Provider-origin permission are cleared. The next action is a separately authorized fresh Key
   session with an exact owner/shop/device-scoped POST count, single-request ceiling, and cumulative
   cost ceiling. Only after a new probe/formal generation yields a restart-surviving, reviewable
   candidate may separately authorized positive BYOK ingest, independent kill-switch checks,
   one-shop Ozon publish, post-enable canary, reconciliation, and rollback resume. No Provider POST
   may auto-retry.
8. Do not downgrade to an old extension while a BYOK batch is pending. Drain the batch first or use
   a rollback package carrying the new launch-session and Registry recovery layer.

## Cross-Conversation Protocol

At the start of every development session:

1. Read this file first.
2. Read the active phase file and its referenced plan section.
3. Check the current Git worktree without reverting unrelated user changes.
4. Mark exactly one active task in the native task tracker.
5. After completing a task, update its checkbox, the phase count, the overall count, Current
   Status, and Next Steps before moving to another task.

## Non-Negotiable Invariants

- API keys stay background-only in `chrome.storage.session` for the first release.
- Raw/base64 Provider result bytes never enter runtime-message history or plaintext persistent
  storage. Active-session restart recovery may retain only bounded AES-256-GCM ciphertext whose key
  remains in `chrome.storage.session`; session/key loss, expiry, tamper, or proof mismatch fails closed.
- BYOK creates no ERP AI generation reservation or settlement.
- Hosted paid execution always uses ERP cost controls and candidate review.
- Every publish-selected BYOK image is normalized, persisted, hashed, and draft-bound first.
- Both modes publish only through the existing ERP command-grant, receipt, and reconciliation
  path. The extension never stores Ozon credentials or calls Ozon directly.
- Provider capability evidence is exact to endpoint, model, operation, and request mode.
- No reference extension source, assets, branding, strings, identifiers, or unsafe defaults
  are copied.
