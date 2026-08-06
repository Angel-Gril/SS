# Phase 6: Pilot and Release

Progress: 2/3 tasks.

## Tasks

- [ ] `REL-02` Run owner/shop/device pilots (`P0`, `M`). Acceptance: sandbox, then one-shop
  publish pilot succeeds; positive BYOK fixture ingest passes; generation/ingest/publish kill
  switches are independent; audit and receipts are visible; post-enable canaries and publish
  reconciliation pass; rollback preserves consistent stored assets and receipts. Depends on the
  dark deployment and pre-enable canaries in `REL-04`.
- [x] `REL-03` Build/sign/distribute cloud and local extension packages (`P0`, `M`).
  Acceptance: same feature set with environment-correct endpoints, one version increment,
  non-secret profile upgrade, no session-key persistence, verified hashes, and smoke results.
  Depends on `QA-03`, `QA-04`, and `DOC-01`.
- [x] `REL-04` Deploy server/web dark and run pre-enable canaries (`P0`, `M`). Acceptance:
  backup/migration, services, readiness, default-off flags, both VPS environments, pairing, hosted
  regression, BYOK disabled-path fixture rejection, and publish reconciliation pass before pilot
  enablement. Depends on `REL-03`.

## Parallel Lanes

- Lane A: rollout controls and observability preparation; no pilot flag is enabled.
- Lane B: final exact Provider sandbox evidence.
- After all quality gates pass, execution is `REL-03a` package/sign -> `REL-04` dark deploy and
  pre-enable canary -> `REL-03b` exact website download receipt -> `REL-02` sandbox/one-shop pilot
  and post-enable canary. `REL-03` and `REL-04` close together after the receipt verifies.

## Notes

- Standard BINI reauthorization replaced the blocked three-scope device session with one unique
  active session containing exactly `capture:write`, `listing:review`, `media:execute`, and
  `byok:media:ingest`. The predecessor session and grant were atomically revoked with reason
  `PAIRING_APPROVED`. Read-only database and CDP checks found all rollout rows dark, the official
  `off` verifier passing, no Provider/session capability state or Chrome origin permission, and
  zero new execution, ingest, publish, Ozon, or command-grant rows. The private reauthorization
  receipt SHA-256 is `0111a4496ae1abb57ae2431f9cda2cc2668bf17ed0d88644228d3393618fd5a1`.
- The replacement four-scope operator binds the exact new session, sole BINI grant and authorized
  verifier blob, and passed read-only `inspect`. It fail-closes before enable until a Key/browser
  authorization-readiness receipt recorded in the preceding ten minutes exists.
  The Web pairing UI now exposes `byok:media:ingest` only as an explicit non-default scope and
  hydrates a verified active session's exact current grant instead of falsely projecting the
  defaults. Pairing tests pass `18/18` and Web typecheck passes. This UI correction is not deployed
  and changed no live flag or external system.
- `REL-02` remains open at `36/37`. The old Provider authorization is closed; the next live action
  requires a freshly loaded Key and a new explicit two-POST allowance with single and cumulative
  cost ceilings. Publish and Ozon writes remain outside the ingest-pilot boundary.

- The separately authorized `1.0.286` `.com`/BINI `ingest-pilot` enabled only the exact scoped
  source workflow, BYOK generation and BYOK ingest rows. Hosted AI, BYOK publish and the Ozon
  publisher stayed off. Its capability probe made exactly one Provider POST without retry, returned
  HTTP 200, and persisted exact `TEXT_TO_IMAGE` evidence.
- Formal generation made zero Provider POSTs. The authoritative workbench launch failed closed with
  `scope_required`: the active BINI session has `capture:write`, `listing:review`, and
  `byok:media:ingest`, but lacks the required `media:execute` scope. The post-enable database window
  contains zero new batches, intents, provenance, upload staging, or ingest-rate rows.
- Exact rollback passed the official `off` verifier and browser cleanup removed the Key, capability
  evidence, exact-origin permission, and stale workbench tabs. The one numerically unused POST is
  not reusable because standard device reauthorization invalidates the old credential evidence.
  Final reconciliation SHA-256 is
  `7f492b0e7df97d90bdc0f9aec78eb39ea657816a364850dedd4b0bf22b5853cd`.
  `REL-02` remains open at `36/37`; the required standard BINI reauthorization has since completed
  as recorded above, while the fresh Key and new two-POST allowance remain pending.

- The second separately authorized `1.0.286` `.com`/BINI sandbox attempt consumed exactly `2/2`
  Provider POSTs without retry. The capability probe and formal `TEXT_TO_IMAGE` generation both
  returned HTTP 200. Status v2 records `SUCCEEDED`; the decoded `1254x1254` PNG is `1,603,057`
  bytes with SHA-256 `1ec671d0768c1bcc911f95bebd87c2255509f91a9b27ae2485f6edc981424932`.
  Provider price synchronization was not required and actual Provider cost was not observed.
- Automated inspection of the live preview passed, but independent human quality confirmation was
  not recorded. Before escrow expiry, a live MV3 stop/wake removed the old Worker and restored the
  exact candidate under a new Worker in review-only state. Status v2, result SHA-256 and the
  AES-256-GCM ciphertext envelope matched; recovery sent zero Provider POSTs and made zero ERP
  ingest. The extension-origin workbench committed an authorized programmatic local keep at
  projection revision `5`, leaving the attempt `KEPT` and ingest `NOT_STARTED`.
- Controlled cleanup cleared the batch, returned all six scoped rows to dark, passed the official
  `off` verifier, cleared the Key/evidence, revoked the exact origin and removed all dispatch,
  recovery, vault and escrow state. Formal-result and final-reconciliation receipt SHA-256 values
  are `088be737bcd762f165e94d0cc637996fd8c8499e316bd9e87953de2ab426a733` and
  `a0a50a683656ea8213d49fc62093162d39ba34cdc2028c15723c90b758cf6fef`; screenshot SHA-256 is
  `f89be18582528fa070c99d36228522e001aedb7423a0a4fac52c5168e2ca8a95`.
- The authorization is exhausted and the cleared local result cannot be reused. No ERP ingest,
  publish or Ozon write occurred. `REL-02` remains open at `36/37`: positive ingest, independent
  kill-switch/post-enable canary evidence, one-shop publish and publish reconciliation still need
  separate authorization. The next live lane must record human approval before keeping and
  ingesting a newly generated candidate; the Ozon mutation remains a later, distinct approval.
- Offline follow-up added the explicit `ingest-pilot` verifier expectation. It requires generation
  and ingest to be `true` while publish remains `false`; `sandbox-pilot` and `publish-pilot` retain
  their exact `(true,false,false)` and `(true,true,true)` combinations. The dark-deployment and
  documentation contracts plus the relevant Server gates passed, and `pnpm preflight` passed `450`
  checks with `0` failures and the two existing package warnings. No rollout flag or external effect
  changed.

- The separately authorized `1.0.286` `.com`/BINI sandbox pilot consumed exactly two Provider
  POSTs without retry: one successful capability probe and one successful formal
  `TEXT_TO_IMAGE` generation. Status v2 records `SUCCEEDED`; the generated PNG is `1,634,189`
  bytes at `1254x1254` with SHA-256
  `9c071263c6c55dd72747aa0634c9ce4562b80b86aa9c05733a9f06abca7cfa74`. Actual Provider cost
  was not observed and Provider price synchronization was not required.
- Live visual inspection passed, and the result hash matched the AES-256-GCM escrow and preview.
  The hard ten-minute escrow nevertheless expired `2,955 ms` before the trusted keep action reached
  the Worker, which failed closed with `SS_ERP_BYOK_RESULT_NOT_FOUND`. No human confirmation,
  authoritative keep, live MV3 restart recovery, or ingest occurred. Formal-result and expiry
  receipt SHA-256 values are
  `1f4d00bdb818d9e65462e5c479908bdd3ce385885111074fdf1799e3ffc562a6` and
  `f3bdfc006314fe17e5fdf012d6df6581a913d851f671a7e49e84e07c0cb9fafa`.
- Controlled cleanup cancelled the execution batch, released its reservation, retained the
  `SUCCEEDED` intent audit, and removed local recovery. Exact CAS returned all six scoped rows to
  dark and the official `off` verifier passed. The session Key, capability evidence, dispatch
  records, result vault/escrow and Provider-origin permission are absent; Turnstile and both `.com`
  services are active. Dark-disable receipt SHA-256 is
  `48b47f1cfff1b67f049ee4f677e223eb39769431370a362ee845c63be963564d`.
- The `2/2` authorization is exhausted. No ERP ingest/publish or Ozon write occurred. `REL-02`
  remains open at `36/37`; another attempt needs a fresh Key and new POST/cost authorization, and
  review, trusted keep and live same-session MV3 restart recovery must finish inside the escrow TTL.

- Current checkpoint (2026-08-06): the authorized replacement release
  `0cd3761a66627209cebdc6fb25a2fb4b1c4fc939` / `1.0.286` completed target-bound QA-04,
  independent `.com`/`.cn` Cloud/Local package and signature verification, signed MV3 restart
  smoke, and both `1.0.285 -> 1.0.286` upgrade smokes. Corrected QA-04 acceptance SHA-256 is
  `755c1569d60409a84dfc4ad98a69f7ea158d05113994792c457fb69763c29a34`; signed restart receipt
  SHAs are `d062be30a7bc8a97347565c85e42efbcd3f44709f573366c9e01f5c97b34660f` and
  `42682d81da3fc7fdf3f88cb69397e98c5345241e4288c8c7383337e3b9ff27ee`.
- Both VPS regions completed target-bound backup/restore, migration, restart, runtime and final
  dark verification, and `7/7` canaries. First-party website Cloud/Local GET publication and
  two-VPS DNS quorum passed. The only retained operations warning is missing remote backup; all
  pilot flags remain off.
- BINI upgraded atomically on the original managed path from `1.0.285` to `1.0.286` under the
  unchanged extension ID `nkkemglcckgmhmcfnjjmcfbdhciafahl`. Installed tree SHA-256 is
  `6924a1d3c53b43c892ef65e358760afd511cf40298062ba45fe1da302ba59318`; trusted reload, active
  Worker attestation, Unicode smoke, and final read-only runtime storage snapshot passed. The
  final snapshot has one non-secret profile and no session Key, capability evidence, provider
  dispatch, batch recovery or device access. Private replacement receipt SHA-256 is
  `e66502c9eb856625e00496d611d2a70bf4bcec6f8e9ea773e4dcddc974c5701d`.
- The replacement chain made zero Provider POSTs/cost, ERP ingest/publish, or Ozon writes.
  `REL-02` remains open at `36/37`; the next live pilot requires a fresh BINI Key session and a
  separately authorized exact owner/shop/device POST count and single/cumulative cost ceiling.
  No prior pilot authorization carries forward.

- The separately authorized `1.0.285` `.com`/BINI pilot sent one successful capability POST and
  persisted exact `TEXT_TO_IMAGE` evidence; result receipt SHA-256 is
  `a8c2c3735cf73ea8eb093768c436594eedc46fb21f3bdf94edce2e5e8fe76872`. The trusted formal
  action sent zero Provider POSTs because ERP batch claim failed first with HTTP 409 and a 120-byte
  `byok_execution_batch_reservation_conflict` body. Exact lookup returned canonical `not_found`, and
  read-only production evidence identified an OPEN terminal batch from the revoked `1.0.283`
  session on the same physical device, with no provenance, still reserving the exact hero slot.
- Fix commit `0cd3761a66627209cebdc6fb25a2fb4b1c4fc939` recognizes only the exact canonical lookup
  miss and releases a revoked/expired same-device terminal orphan atomically with a new claim. It
  requires exact owner/actor/deployment/device/shop/workflow/draft/source/slot/ordinal identity and
  rejects pending, unknown, different-device, provenance-bearing, malformed or raced state.
  Focused tests passed `9/9` and `95/95`; the 142-migration PostgreSQL gate passed `99/99` plus
  populated-upgrade checks; Server passed 4,781 tests; lint/typecheck passed with the 21 existing
  warnings; final preflight passed in `611.3s` with 450 checks and the two existing package warnings.
- Exact CAS returned all six rollout rows to default dark state and the official off verifier
  passed. Dark-disable receipt SHA-256 is
  `8953a69c4c59ada7f897847443e49a9875e96ab8c71136e1c5f47ed4228805e5`. The pilot consumed
  one Provider POST; formal generation and rollback sent none. The unused numerical authorization
  is closed. No ERP ingest/publish or Ozon write occurred. `REL-02` remains open at `36/37`; next is
  a separately authorized `0cd3761a` / `1.0.286` dark replacement release before any fresh pilot.
- Local BINI containment is complete. The Provider UI cleared the session Key/capability evidence
  and revoked the exact-origin permission. After the already-proved canonical `not_found`, the
  orphaned `PREPARING` recovery was cleared with the extension session manager and the MV3 worker
  was reloaded. Post-reload checks found no Key, exact-origin or `<all_urls>` permission, recovery,
  document fence or launch session. Cleanup sent zero Provider POSTs and made no ingest, publish or
  Ozon write; private receipt SHA-256 is
  `e01e5fcfe432ca2a60a9011a41f44dedd54471aa466028923e65573720be3217`.
- Replacement release `a0e47316f9a4664b0105b5feced11140cb700c7b` / `1.0.285` passed
  target-bound QA-04, regional package/sign verification, signed MV3 restart smoke, and both
  `1.0.284 -> 1.0.285` upgrade smokes. QA-04 acceptance SHA-256 is
  `8eeffce5c70d73ba56bdcbb809746ba94568df0c283dee048eb308dce1b16027`; signed restart
  receipt SHA-256 values are `ca9c8b4c687bbe141b0abc63db5fa1affeed96fc3d69bbcf11d3da2e91758a56`
  for `.com` and `e46625a929bd4188a6c7e61cfdb3248d666b18839c363850ad93964de8473300`
  for `.cn`.
- Both regions completed fresh backup/restore validation, migration, service restart, full runtime
  verification, final dark checks, and `7/7` pre-enable canaries. Canary SHA-256 values are
  `10768ce83d4d35185737219a24910cc24497620397323ab1c04b756fd475ea34` for `.com` and
  `5854148eda0099eb0814a0d563ea6d405f081549462f7218428d71789d3430d8` for `.cn`.
  Temporary auth sessions were logged out/deleted, all pilot flags remain off, and the only retained
  operations warning is that remote backup is not configured.
- Fresh two-VPS DNS quorum evidence SHA-256 is
  `b527a646f88afc44420423c9ed919bd60387383c1f32d741239a186859a56bb7`. First-party website
  distribution and offline verification passed with receipt SHA-256
  `2e899f09b2ab54802b7e14bedba040f439f98fa119ad1f6f7795db7a75e7eabd` for `.com` and
  `f8b21598dd5773cdf8e2a58f923183445d76e0dda51d48c75f0bfdafd7e32edd` for `.cn`.
- BINI upgraded atomically on its original managed path to `1.0.285` under unchanged extension ID
  `nkkemglcckgmhmcfnjjmcfbdhciafahl`. Installed tree and upgrade receipt SHA-256 values are
  `dd2013195eb2163a920df3ad21ae96f671131508e55a0a30915f4c57afc4a395` and
  `c505982cebcaf56012253d523415063a8fb46c5c2eac01315e718d61d622a239`. Trusted reload,
  active/disk Worker identity at runtime manifest `1.0.285`, and Unicode slot smoke passed; their
  receipt SHA-256 values are `35354fd647e4353c73f12ffab11146a19d1a5343321aed351531f147240620d5`,
  `04fe4e442f9e2a1e2edf1f5c9b856136d9748db43c128acf674f44f1db460988`, and
  `92046e18d341dc6e9a072de50b8cc4d83e02490abc9ea15914ed2db14219acc8`.
  Final replacement reconciliation SHA-256 is
  `745c81f6c6d37dab5a00614944a88d6fabeb9eee231cc98cd261d5046ce1ef7c`.
- The `1.0.285` replacement chain made zero Provider POSTs/cost, ERP ingest/publish, or Ozon writes.
  `REL-03` and `REL-04` remain complete; `REL-02` remains open at `36/37`. BINI is idle with its Key
  and session-only state cleared. A new exact scoped POST/cost authorization and fresh Key session
  are required before the next pilot request; no earlier authorization carries forward.
- Historical replacement release `ad4b8714b53d0826ffe470f6db97b6906dcc52c0` / `1.0.284` passed
  target-bound QA-04, regional package/sign verification, signed MV3 restart smoke, and both
  `1.0.283 -> 1.0.284` upgrade smokes. QA-04 acceptance SHA-256 is
  `de3082ab834d43d7241e1b19fc62db7c139fef0128e80b5aa4254742d0e24f37`; signed restart
  receipt SHA-256 values are `290a12b132803880dc5d39c31e16ffbee8a8ce22612d08c762874a1e520b4202`
  for `.com` and `36fadeb64bbd65c140e70d2efe8f26bf2008af3e3bbef7e3798ea55731c65800`
  for `.cn`.
- Both regions completed fresh backup/restore validation, migration, service restart, full runtime
  verification, final dark checks, and `7/7` pre-enable canaries. Canary SHA-256 values are
  `ed36f43294c0ea06f7e7d22213258cead939c44ed036cff273c2b79721808376` for `.com` and
  `b8750b48c19df39e2c2b87610f400938da9de1e0290e95ba79151707d08ca540` for `.cn`.
  Temporary account/device sessions were removed, and all pilot flags remain off.
- Fresh two-VPS DNS quorum evidence SHA-256 is
  `b4685b108dd4bc0a2097ce5a5ee4973da5d518672f63fd29bf5a17d76df800c1`. First-party website
  distribution and offline verification passed with receipt SHA-256
  `09df3e9c7eb4b59e62c543269945d12622e1d28d028b4ba42d0428c627764aa7` for `.com` and
  `dfd475bac5d0e0e7baf4ba82738a949057d06e78cc2f2caf25d55207d28b1d72` for `.cn`.
- BINI upgraded atomically on its original managed path to `1.0.284` under unchanged extension ID
  `nkkemglcckgmhmcfnjjmcfbdhciafahl`. Installed tree and upgrade receipt SHA-256 values are
  `c75ffe17ebba367a0320fa5ab0d2b98d68c30fbd263b6e46c07799b4ea676313` and
  `875d634b50329b1f2d3af4d7dbb9daec23352a0a59c072e7b0d6e87064b04062`. Trusted reload,
  active/disk Worker identity at runtime manifest `1.0.284`, and Unicode slot smoke passed; their
  receipt SHA-256 values are `24e18c9b3aea70acd68811c33713d6c2c65cbf41467a12225ca0a75e7c806ddb`,
  `7ba7bffa2f1ea416e1d9ffeb41d4a45d7fbe4f17ac1727125de238f103018456`, and
  `500270b1b0e2a443127266cdfca6937d38d26dd4b9948c9d1a027ba7ce5131e0`.
  Final replacement reconciliation SHA-256 is
  `28df1dd7d39477d582e28cc33347593b2c03cfcd456c3bde2abfa13fafb90d1c`.
- The `1.0.284` replacement chain made zero Provider POSTs/cost, ERP ingest/publish, or Ozon writes.
  `REL-03` and `REL-04` remain complete; `REL-02` remains open at `36/37`. BINI is idle with its Key
  and session-only state cleared. A new exact scoped POST/cost authorization and fresh Key session
  are required before the next pilot request; no earlier authorization carries forward.
- A later, separately authorized `1.0.284` `.com` BINI attempt repaired the exact device session,
  granted only `https://ai.big-model-api.top/*`, and passed the six-row scoped policy CAS plus the
  official `sandbox-pilot` verifier at composite revision `955791647`. POST 1 sent exactly one T2I
  capability request, but no HTTP status arrived before the 120-second deadline; Chromium reported
  `net::ERR_ABORTED` and the extension persisted `UNKNOWN_OUTCOME` with the original request and
  credential authority bound against replay. A later authenticated GET-only reconciliation made no
  Provider POST and found exactly one matching consume entry: `quota=5950`, `useTime=134s`, model
  `gpt-image-2-count`, and path `/v1/images/generations`. Current public status reports CNY display
  and `quota_per_unit=500000`, so the unique log entry represents exact `CNY 0.0119`. This is not a
  paired-meter finalizer because the attempt has no request-bound pre-call snapshot, and the log
  contains no image response or result identity; capability evidence remains zero. GET manifest
  and final reconciliation receipt SHA-256 values are
  `aa881a30d604144cca933f72917536de77c310fdb2c42fa09d1e4eae232bc3d5` and
  `126c19e3dd458694219eb3f6eb032c46517aeac1c35a6f9f7b537c32bb94b6d9`. POST 2 formal
  generation was not executed.
  Result and dark-disable receipt SHA-256 values are
  `7fcb726c563e69ec1e478624093c8817c64df04f693769929d7da61c5352838a` and
  `ddf898d58118efa1e9be12d7fe832d865b3b0c0668580cc679b5fa8b292464d0`.
  All scoped rows are dark again, the owner token was revoked/deleted, and the temporary human
  challenge override was restored. The stable device session, session Key, exact Chrome permission,
  and one uncertain-probe guard remain; ingest, publish and Ozon writes stayed at zero. Do not retry
  or rename the request. The accounting outcome is `CHARGED_RESPONSE_UNOBSERVED`, not positive
  capability evidence. `REL-02` remains open at `36/37`.
- Fix commit `bcb3e4e4e8ef7a6aaf28e74a058b2a90b59479a1` binds the Hosted default and BYOK maximum
  to a shared 240-second deadline below the MV3 event ceiling, gives capability/single-generation UI
  channels a 315-second outer window, and makes interactive generation fail before dispatch when
  semaphore capacity is busy. Edit and batch queues remain unchanged. Focused suites, two
  independent reviews, final `pnpm preflight` (`640s`) and full lint passed; only the 20 existing
  lint warnings remain. No Provider, VPS, ERP or Ozon action occurred. The fix is included in the
  completed `a0e47316` / `1.0.285` replacement release above; a fresh scoped pilot still requires
  separate POST/cost authorization.
- The live `1.0.283` `.com` BINI scoped sandbox pilot consumed its separate `2/2` Provider POST
  authorization exactly once per action: one capability probe and one formal `TEXT_TO_IMAGE`
  generation, with no automatic retry. The formal status-v2 record reached `SUCCEEDED`; its
  1,804,392-byte PNG SHA-256 is
  `82b77095a9674d7d960d2fc59ce855c527fbea4c000f597dbc431c9d995b07bd`, and the workbench
  screenshot SHA-256 is `8319769612dbe0f43fb71062cbd07bbec4a349621b14af71d0a1f6918460820d`.
  A trusted keep action committed local `KEPT` review state while ingest remained `NOT_STARTED`.
- A real MV3 worker stop/wake then reset the memory-only device-authority epoch to `0`. Exact
  lifecycle validation rejected the encrypted candidate and finalized the batch as
  `FAILED_FINAL / SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST`, with ingest error
  `SS_ERP_BYOK_BATCH_WORKER_RESTART_UNRESOLVED`. The escrow TTL later expired; the result is not
  recoverable and must never be ingested. Append-only private reconciliation SHA-256 is
  `34f2464c9b73601e488a5d4ba16e237501619b97b07d85bfcd15e1bbfd921307`.
- Fix commit `4632a9e17f9617ec6bd0e979d491324734677467` persists the epoch in
  `chrome.storage.session`, serializes cross-worker updates with Web Locks, preserves fail-closed
  invalidation and stale-epoch rejection, and adds real Worker A -> Worker B review-only recovery
  coverage with zero Provider dispatch. Focused contracts passed `81/81`; full `pnpm preflight`
  passed in `642.1s`; source extension verification passed `450` checks with zero failures and the
  two existing warnings. Two independent reviews found no blocker. This fix was subsequently
  included in the completed `ad4b8714` / `1.0.284` replacement release described above.
- After authorization exhaustion, the six scoped rollout rows were atomically returned to dark and
  the official verifier passed. Dark-disable and verifier receipt SHA-256 values are
  `01db8e79942c23938fdcdd93cbace37f920bfeb3d4ce34c3fa9c4b0d71dc2edb` and
  `971a64e3fec064aa5227f36fdb03aa01a9cac00fd0ffa0192756318d502b700f`. BINI session Key,
  origin permission, and capability evidence were cleared; cleanup receipt SHA-256 is
  `b0a664622c91cd0031ed53843c8d93e543972ba1baf5c6046e5e3ea3b2c13cd4`. No Provider request
  followed the formal generation, actual Provider cost was not observed, and no ERP ingest,
  publish, or Ozon write occurred. `REL-02` remains open at `36/37`; the dark `1.0.284` replacement
  pre-release is now complete, so the next dependency-ready action is a separately authorized fresh
  scoped live pilot.
- Replacement release `7202b5971571d1debbacc76540f311e7dd733d5a` / `1.0.283` passed
  target-bound QA-04, regional package/signature checks, signed MV3 restart and same-path upgrade
  smokes. QA-04 acceptance SHA-256 is
  `224e3432ee481aceaea072b72c526201b93f1d0fab37efdc921790f2a27815f4`.
- The old `.com` BINI scope was atomically darkened first; receipt SHA-256 is
  `e521117471428ff91b514c66421a592093d055b00beff1d843789dbc10768623`. Both regions then
  passed fresh backup/restore, migration, restart, runtime verification, and `7/7` dark canaries.
  Canary SHA-256 values are `a51fc832b8d7031ba214f37b6324535f6aae497bc47ed1c39a36e8fa40f31892`
  for `.com` and `572b61487599d5334c20394b2c0f21d204273eaba1e99af181c314c06c258d42` for `.cn`.
- First-party website distribution passed with `.com`/`.cn` receipt SHA-256 values
  `5b104d2616eead3176d07aa7aab1a14f8cee5e1953439388e1d5378859d84dda` and
  `95ad8b0297b4f8570f17505c77895993cb2844d3506890be183db879dab1983d`. BINI upgraded on its
  original path to `1.0.283`; installed tree and upgrade-receipt SHA-256 values are
  `fbdc9edce1f2549151af39ff1b5ae5619ad6d224afc03c385ca16f4666c765ab` and
  `868c403ed64b5a6603bf5b4ab0b9f77e98244f875263ef4baedb4acd94525bee`.
- Trusted reload, active/disk Worker identity with runtime manifest `1.0.283`, and the live Unicode
  slot smoke passed. Their receipt SHA-256 values are
  `8e43a9c0740e45266e85f590d8fa58448703cf5a23b32a0477cf1385b1661719`,
  `c5d82bdacffb46440ef88c4f5430115b4c80a3a85fb45cbe628fd7577b2119a8`, and
  `f0ec879fba1827c28cc0ec59153394ea56239cd8ca850f8916e63549da3435f7`. Final replacement
  reconciliation SHA-256 is `88a4adecb1b3bb83a2291604b40d129733a46f5861d28bd4f9caa2656d6c71f1`.
- The replacement chain made zero Provider POSTs/cost, ERP ingest/publish, or Ozon writes. All
  flags remain off. `REL-02` remains open at `36/37`; the exhausted `1.0.282` authorization does not
  carry forward. A fresh BINI Key session and new exact scoped POST/cost authorization are required.
- The 2026-08-04 `1.0.282` BINI scoped sandbox pilot consumed its separately authorized two
  Provider POSTs exactly once: capability probe then formal `TEXT_TO_IMAGE`. The formal execution
  succeeded and produced candidate SHA-256
  `e5ae237c7f35d519a7134194aca2543edfd0c4ed21d64aeef7780046038f1e42`; the immediate result
  receipt SHA-256 is `68f4c3683a7acd20448fa6f8efbc40e8b2739c4f29645481c4ac152dc4e8cdc2`. The
  operator confirmed image quality, but the trusted keep action arrived after the hard ten-minute
  AES escrow TTL. The runtime projection and escrow were empty, so no authoritative keep or ingest
  transition was committed. Private human-review/expiry reconciliation SHA-256 is
  `e9a249fc812f2adcbf180822d7b16811b51bc4e127f106d436d54d187912d3c4`. No retry, ERP/Ozon write or
  flag change occurred; `REL-02` remains open and any new attempt needs a new exact authorization.
- Replacement release `49ae41e337f2857cecece4a173f0c8a661c536cd` / `1.0.281` completed the
  authorized REL-02 pre-release chain. Target-bound QA-04 acceptance SHA-256 is
  `8d069c4926edac9756e343c08ed3255c19713c9a9c974f112a38ff9dc6d8f8df`; both 190-file regional
  candidates passed detached-signature verification and signed MV3 restart smoke.
- Both regions completed fresh backup/restore validation, dark deployment, full VPS verification
  and `7/7` pre-enable canaries. Canary receipt SHA-256 values are
  `6662ff24b3675d1d58d48321cfdb126cbbc14509c99caaf97e28e01eaa4c9eb2` for `.com` and
  `ee2da3888681320ac750360b35162f2b1afccd5eefc2fc31ed343115bce47de8` for `.cn`; every pilot
  flag remains off.
- First-party website latest/cloud/local verification passed with publication receipt SHA-256
  `20e89f47919f2748465781a8c4875051224553ed40868ec4fc8d01b30fcac195` for `.com` and
  `4a6cc67b14035fb38b30604b59194aa66164af1965ead046a61d2232f586f3be` for `.cn`. Fresh
  two-VPS DNS quorum evidence SHA-256 is
  `375105c6179846acee715ea067850f3f5550e959bd44bf1699131bd31360edc6`.
- The isolated `1.0.278` to `1.0.281` upgrade smoke passed with summary SHA-256
  `839c86210f876c4208b274d93201f1a984b903ec4170061f24f6479ae0c73280`. BINI then upgraded
  atomically on its original path under unchanged extension ID. Its 190 installed files match tree
  SHA-256 `2799885b1983f0b2b3f8bb1b98b29c2af4bbe6ecce685e0a9dfa7512adb48cf8`; the non-secret
  profile was preserved and session secrets, capability evidence, vault key and batch recovery
  remained absent. Upgrade receipt SHA-256 is
  `12a121c6e84ca418eb06f4f5027e3f419d6385b57207c29eca195fb91de8072c`.
- REL-02 pre-dispatch validation caught a manifest-new/worker-old same-path upgrade state before
  Provider dispatch. The formal click made zero Provider requests; stale-worker block receipt
  SHA-256 is `aa416be83f9907e88df754f1b192f4fc6b3ae287d62fa73b4de00f597475dca5`.
  The original upgrade receipt proves its signed package/tree/profile/session fields, not active
  worker identity.
- Official reload plus stop/wake verification restored the exact `1.0.281` worker. Receipt SHA-256
  values are `af1a4c0f6057fbed17ecb1935f26809aca0e692498184289dd38a6254d9c099a` and
  `76f8565f303b0a8972850deeeaccda9b0d1952c8c4373219ce0c28c4db20a27b`. The new read-only
  main-script attestor independently matched active and disk SHA-256
  `27e220de97ff6a29578c9163ee035ea1ce8bb2fd983363cdd48aa28ab91710ac` at `279652` bytes in
  Chrome `147.0.7727.15`; attestation receipt SHA-256 is
  `9a8174f2791177a7844195b16b4e6358b38566b7a4e4cb2deb82deacf621c449`.
  The combined 23 active-worker/Unicode contracts and complete local preflight passed in `627.9s`;
  source extension verification finished at `450` passes, two existing warnings and zero failures.
- The earlier `1.0.281` accounting is historical only: it records the pre-reload failed formal click
  and must not be combined with the later `1.0.282` two-POST authorization. The `1.0.282` scope is
  exhausted, no retry is permitted, and ingest, publish and Ozon writes remain disabled.
- The package/deployment pre-release itself called no Provider, incurred no Provider cost, changed
  no feature flag, and made no ERP ingest/publish or Ozon write. `REL-03` and `REL-04` remain
  complete, Phase 6 remains `2/3`,
  overall progress remains `36/37`, and only `REL-02` is open.

- At the 2026-08-03 checkpoint, deployed release commit
  `b6f421211fdc14686ccb5188badf3985cb16930b` passed the complete nine-gate
  QA-04 command in `774.4s`; target-bound acceptance SHA-256 is
  `5a97e22583cfe200a7204b747a92259c6e0a951bed2cfafa193832e6c9fe7219`. Both origin-bound
  `1.0.278` candidates passed detached-signature verification and persistent-Chromium same-path
  upgrade smokes while preserving non-secret profiles and clearing session-only state.
- Both regions completed fresh target/database/restore-bound backup drills, migration and
  post-migration guards, exact service/cwd/readiness checks, and the topology-correct VPS verifier.
  Backup attestation SHA-256 values are
  `153a04c6b367e7df02b912aa5ead697916266bb933eaf2e00e85ae98dd4a6f8b` for `.com` and
  `9d22a45681889682ad58c9aba734900c34744bde2307b4c5391c49bc6e396168` for `.cn`; verifier SHA-256
  values are `42f9e2c6878675978945921bfd61605f888253a3269597b173fe6e9855dab41a` and
  `482d85b155e001b4db69b8e062bad2b19c3e0112018cded106191f3f9a84174a`. Pre-enable canaries passed
  `7/7` in both regions with receipt SHA-256 values
  `61b94f977dcd390af0be6eba6b18b7862236b2071c67df3c20d2ff5633810991` and
  `64503e2f8208834d6179f4d8f14c74a512c2225366ba6156a081d12febd53ead`.
- First-party website latest/cloud/local GET verification and detached-signature verification passed
  in both regions. Publication receipt SHA-256 values are
  `77e0cc2d4100ed8fbb73c40ee386aff3d910baa94e5fb621cd999306ae07a218` for `.com` and
  `5f98a25109b5aa317865159e66082de33fc59cde00243daa47ffcc6c9d394ba9` for `.cn`; public DNS quorum
  evidence SHA-256 is `284aa1b923bad43f455661353e7bff297fe8c493806d012b7116ff01addb5871`.
  `REL-03` and `REL-04` remain complete, Phase 6 remains `2/3`, and overall progress remains `36/37`.
- After dark deployment, `.com` restored only the exact BINI owner/shop/device,
  `https://ai.big-model-api.top`, and `TEXT_TO_IMAGE` scope. The six changed rows advanced from
  revision `8` to `9`, the BYOK policy advanced to internal revision `5`, and the source policy binds
  the full b6 commit. Fresh database reads, the repository composition formula and the official
  rollout verifier independently confirm composite policy revision `735123817`. Hosted generation,
  BYOK ingest and BYOK publish remain `false@0`; `.cn` remains dark. Restore receipt SHA-256 is
  `ecf029cd81c883bbeeaed48690f5e1bf43fca422c11b7e55455d756adfae86b0`; the post-restore read-only
  audit SHA-256 is `baeaadb0c2b474adf17c4dfe87b3a9bd7ce718c88fe3013d2dd055b37a79504f`.
- The dedicated BINI browser upgraded on the same managed path from `1.0.276` to `1.0.278` under
  unchanged extension ID `nkkemglcckgmhmcfnjjmcfbdhciafahl`. All 189 installed files match the
  verified candidate hash map; the non-secret origin/model profile remains, while the session Key
  and old capability evidence are cleared. Upgrade receipt SHA-256 is
  `b7cf09e0c34dfc5e6eed6768e8ffd252d840c2d759d8a9aa1619848aab9793b5`. Eight raw short-lived
  session files were removed after five unique tokens were confirmed inactive; cleanup receipt
  SHA-256 is `374fb7ea88041118c5ef20177a82851ebeb87292fbbb634cc16dc5cf339effda`.
- POST 5 sent exactly one post-reload `TEXT_TO_IMAGE` capability request, received HTTP `200`, and
  was not retried. Pre-call receipt SHA-256 is
  `f712abf4df1bed4a8488f2e7e384a48cceabae639ca419995ad327dcfd60ec3d`. The immutable original
  result receipt SHA-256 is `6277ba540535eaca11da735dee9fc6b7bb2c6010acce6ed64718e36d4763992e`;
  its conservative UI-race outcome remains unchanged. Append-only reconciliation records the
  durable authoritative outcome as `SUCCEEDED`; its SHA-256 is
  `20cbda840025d887dab2e270b2f74b80ac7cb978a7c51e89989b168949a836eb`.
- POST 6 sent exactly one formal-generation Provider request, received HTTP `200`, and was not
  retried. Its pre-call and immediate-result receipt SHA-256 values are
  `acc1e3b58ba8f862603ddbe2381c4b65e238a0f9385f40d94e80677002545e61` and
  `aff32ecf7ea7028b6d08121b5877e66d356761a24f47c4c9ea2d9c6f7a54537e`; the immediate result
  reached `CANDIDATE_READY`.
- Before review, the MV3 worker restarted and cleared the memory-only Blob vault. Preview failed,
  durable state finalized as `FAILED_FINAL` with `SS_ERP_BYOK_BATCH_LOCAL_RESULT_LOST`, and the
  reconciliation receipt SHA-256 is
  `18358a64f1c56a6fa7da909b401cc7dd24827cc0dd555c19dbd14fa5fa4426f4`. Provider dispatch
  succeeded, but end-to-end formal generation did not; the lost candidate is unrecoverable.
- All `6/6` authorized Provider POSTs are consumed, with zero remaining and no retry permitted. No
  candidate was reviewed or kept, no ERP ingest or publish ran, and no Ozon write occurred. POST 6
  remains unrecoverable and must never be ingested.
- Heartbeat is mitigation only. The offline follow-up adds bounded AES-256-GCM IndexedDB ciphertext
  under a `chrome.storage.session` key, authenticated status-v2 result-hash proof, and exact-binding
  review-only MV3 worker-restart recovery. The retained-media budget is 50 MiB across at most 16
  entries, each no larger than 20 MiB, with a hard ten-minute TTL. Browser-session/key loss, expiry,
  tamper, quota failure, missing proof, or authority mismatch fails closed without Provider retry.
- Credential and Provider-consent changes wait for a serialized Registry cleanup fence. Recovery
  and preview reads drain before escrow key rotation, queued Provider handoff rechecks the fence,
  and fresh-worker terminal cleanup deletes ciphertext before releasing the operation lock.
- At the `ac4227f9` checkpoint the follow-up had passed offline source, Cloud, and Local
  build/package verification but was not yet signed, release-staged, website-distributed, deployed,
  or paid-validated. It caused no Provider request, VPS or flag change, ERP ingest/publish, or Ozon
  mutation. `REL-02` remained open; Phase 6 stayed `2/3` and overall progress stayed `36/37`.
- The authorized `ac4227f9d6e1291bf275ff314f78dc049d565a7f` pre-release ran the complete nine-step
  `QA-04` aggregate in `806.7s`; source, Cloud, and Local verification passed `450`, `455`, and
  `451` checks respectively. Independent `.com` and `.cn` version `1.0.279` candidates were built
  with 190 files per target, but remain unsigned and quarantined. A production-log review found that
  both the deployed b6 release and `ac4227f9` used an unqualified `RETURNING` projection in the
  expired BYOK upload-staging claim, causing PostgreSQL `42702` on every cleanup tick. No `1.0.279`
  artifact may be signed, distributed, deployed, or installed.
- Before that review, the six `.com` BINI-scoped rollout rows were atomically returned from revision
  `9` to dark revision `10`; the official dark verifier then passed. Private state-change receipt
  SHA-256 is `e88efc87d8f556df39800594ebd85c45f7a377d7bc4c3a1dc1ff51d4f6187f3b`.
  The command invoked no Provider, ingest, publish, or Ozon path; the receipt's zero counters are
  declarations of that command boundary rather than independent metering evidence. `.cn` remained
  dark and both regions continued serving b6 without upload, backup, migration, or restart.
- The staging cleanup fix now generates all 18 returned fields from one structured projection and
  qualifies the target alias only for `UPDATE ... FROM`. A real isolated-schema PostgreSQL
  regression executes the formerly failing claim and is included in the AI Media integration
  aggregate. Focused unit tests passed `13/13`; the PostgreSQL aggregate passed `21` files and `96`
  tests; Server typecheck, focused lint, and diff checks passed. The replacement must use a new
  clean commit and version `1.0.280`, rerun full `QA-04`, regional package/sign, signed MV3 restart
  smoke, both dark deployments/download receipts, and BINI same-path upgrade before `REL-02` resumes.

- The clean `e795e67de4df1a53bdb8738e8dd4158a6570d22d` replacement passed final QA-04,
  regional `1.0.273` package/sign checks, both upgrade smokes, and fresh backup/restore gates. Its
  first `.com` dark deployment reproduced the earlier fixed-delay startup race after all build,
  migration, dark-config, systemd and process-cwd checks passed. Automatic rollback restored
  healthy commit `2fa91856b1c09531865c1a9b8af7a0a82d27cf4f`; `.cn` was not deployed and no canary,
  website receipt, flag, Provider, ERP ingest or Ozon mutation occurred. The failed
  `e795e67`/`1.0.273` release evidence is immutable and cannot be retried.
- Deployment health acceptance now has a non-configurable 30-attempt limit, one-second delay,
  two-second per-request timeout, exact API HTTP `200`, and Web HTTP `200`/`302`. Release and
  app-dir entrypoints preserve a bounded fallback for explicit targets that predate the helper;
  rollback uses the same bound. In-place staging re-enters and verifies only its last successfully
  validated persistent-maintenance gate after a health failure. Focused deployment, backup,
  environment, package and full isolated Linux `12/12` behavior tests pass, including transport
  refusal and HTTP-status recovery; independent review found no remaining P0/P1/P2 issue. A new
  clean commit, full QA-04, version `1.0.274`, fresh backup/restore gates, both dark
  deployments/canaries and both website receipts remain required before the `BINI` pilot resumes.
- The first authorized `.com` `BINI` REL-02 sandbox preflight found a packaged extension pairing
  regression before any device claim or Provider dispatch. The first fix made the packaged runtime
  ID available to the deployment sender check; security review then found that the central message
  policy still allowed `ss-erp:extension-device-claim` from unrelated same-extension pages. The
  central policy now restricts that message to `pages/settings.html` while preserving exact ERP
  Web/Admin one-click pairing. Focused message/device/lifecycle tests pass `57/57`, and independent
  review found no remaining P0/P1/P2 issue.
- The unconsumed pairing code and short-lived owner/admin sessions were revoked, the isolated
  browser was closed, and no device session exists for the pilot label. Private preflight evidence
  SHA-256 is `19021ce2...480c`. No Provider request, ERP ingest, Ozon mutation or flag change
  occurred. Version `1.0.272` remains immutable historical release evidence but is not eligible for
  the pilot. `REL-03` and `REL-04` are reopened pending clean QA-04, a signed `1.0.273` replacement,
  both dark deployments/canaries and both website receipts; Phase 6 is `0/3` and overall progress
  is `34/37` until those replacement gates pass.
- Text-to-image pilot success does not automatically enable edits or inpaint.
- Each production operation remains limited to explicitly verified endpoint/model evidence.
- `REL-04` completion never authorizes a pilot flag by itself; the scoped enablement belongs to
  `REL-02` only.
- Formal packaging preparation now uses one `pnpm package:extension` coordinator for cloud and local
  targets. It increments one shared version, refuses overwrites/concurrent release locks, writes
  durable ZIPs, reopens and verifies ZIP SHA-256/CRC/file counts and portable paths, and retains a
  canonical two-line checksum plus closed-schema release evidence. Independently approved Web,
  Admin and API HTTPS origins plus the fixed local loopback origin must exactly match deployment
  defaults and every applicable manifest permission surface.
- Provenance binds one full 40-character Git commit, source mode and a deterministic digest of all
  extension/package inputs. Inputs and scoped Git state are checked before and after both builds and
  independently recomputed by the release verifier. The source manifest is fixed at the last
  verified legacy floor `1.0.264`, so the first canonical release becomes `1.0.265` rather than a
  Chrome-ineligible downgrade. Corrupt, orphaned or incomplete historical artifacts cannot influence
  version selection.
- The focused package/deploy matrix passed in `213.6s`; the complete offline gate then passed both
  fresh package verifiers at cloud `450/0/0` and local `446/2/0`. Independent reviews found no
  remaining P0/P1/P2. `signature.status=EXTERNAL_REQUIRED` deliberately proves that no real signing
  or first-party website distribution receipt exists yet. No package was signed/distributed, no VPS was changed and no rollout
  flag was enabled, so Phase 6 remains `0/3` and overall progress remains `32/37`.
- A subsequent offline distribution review found that the public extension download routes still
  trusted mutable unpacked manifests and could rebuild a ZIP without canonical release evidence.
  The routes now require one repository-source cloud/local release set whose evidence and checksum
  are canonical, whose Git commit matches `DEPLOYED_COMMIT`, and whose exact ZIP bytes, central
  directory, target manifest and file count match the recorded evidence. Version/SHA-bound URLs and
  one startup metadata selection prevent cross-deploy downloads; each target is verified and cached
  only when requested. Missing, mixed, replaced or symlinked artifacts fail closed; dynamic
  reconstruction is available only through an explicit non-production test/development option.
  Staging writes `DEPLOYED_COMMIT` only after quiescing API/Worker, rejects dirty or mismatched Git
  provenance (including ignored source files), and always re-verifies the current release set before
  migration, including with `--skip-build`. Formal evidence also binds the independently approved
  local endpoint exactly to `http://127.0.0.1:3001`; formal/runtime readers reject symlink artifacts
  and apply the same stored-ZIP CRC, size, path, collision and contiguous-record checks. Mutable
  discovery responses are non-cacheable. This closes offline distribution bypasses only: external
  signatures/receipts, clean install/upgrade smoke and actual distribution remain open, so `REL-03`
  stays unchecked, Phase 6 stays `0/3`, and overall
  progress stays `32/37`.
- Final local verification passed the focused download matrix (`7` passed with one Windows-only
  symlink case skipped), Server typecheck and targeted lint, the deployment/documentation contracts,
  the full Server suite (`4514` passed, `195` skipped), and the coordinated package/deployment matrix
  in `212.7s`. `git diff --check` passed. No Provider, VPS, deployment, signature, distribution,
  production flag or Ozon operation was invoked.
- Offline `REL-04` preparation now makes every supported migration entrypoint fail closed without a
  fresh database/target-commit/restore-bound backup attestation. The shell backup path validates a
  real gzip, retains compressed byte count and SHA-256 in canonical schema v3 latest status plus an
  immutable per-backup sidecar, and refuses overwrite. The restore drill must restore that exact
  sidecar-bound file into a temporary database and observe a positive public table count before it
  can write one private canonical attestation. Verification reopens the attestation, immutable
  status and backup without following final symlinks, checks identities/modes before and after
  bounded streaming SHA-256/gunzip, enforces a 24-hour maximum configurable age and independent
  timeout, and binds the stable `DEPLOY_DATABASE_ID` plus full target Git commit. The three systemd
  deployers and the Compose migrate container run this gate before Prisma; Compose also binds a
  clean, stable HEAD and read-only evidence mount. Application-managed backup storage remains
  separate through `DEPLOY_BACKUP_LOCAL_DIR`, preventing the existing service backup worker from
  overwriting or cleaning release evidence. Workspace lint passed with zero errors and the existing
  `20` Server plus one shared warning; workspace typecheck, Dockerfile check, both Compose config
  parses and full preflight passed. Preflight completed in `464.8s` at `445/0` with the two expected
  local-extension warnings. An offline Debian container passed all `28` POSIX backup, restore,
  `0600` and symlink assertions. This is code
  readiness only: no real backup, restore, migration, VPS access, deployment or canary occurred, so
  `REL-04` remains unchecked and counts stay `32/37`.
- A final offline `REL-04` hardening pass now separates root orchestration, the runtime identity and
  a dedicated `ss-erp-build` identity with distinct non-root UID/GID values and empty supplementary
  groups. Root snapshots the env once; builds receive only public allowlisted values plus an
  unusable database URL. Open/closed manifests bind the pre/post-build trees, sealing copies them to
  new root-owned inodes, and runtime links are installed only afterward. Ignored root `.env*` files
  fail closed except for the explicitly selected runtime env, and the sealed Next build cache is
  discarded before root creates an empty runtime cache. Compose is serialized by preinstalled
  global locks and builds only a private target-commit `git archive`; each Dockerfile verifies the
  archive SHA-256 before executing repository code and records both commit and archive markers.
  The restore drill now proves the maintenance and restore routes are the same database using a
  random schema/table marker before import and before a mandatory, non-optional drop. Expired
  same-commit attestations are archived byte-for-byte under a SHA-256-qualified name before a new
  current pointer can be issued. A no-network Debian run passed all `52/52` deployment, backup,
  restore, identity, mode, symlink and permission assertions. Lint passed with zero errors and the
  existing `20` Server plus one shared warning; workspace typecheck passed; the full Server suite
  passed `4515` with `195` skipped; final preflight passed `445/0` with two expected local-package
  warnings in `415.8s`. BuildKit checks reported no Dockerfile warnings, both Compose configs parsed,
  and cloud/local/source extension verification passed `450/0/0`, `446/2/0` and `445/2/0` at
  version `1.0.264`. This remains offline preparation: no real backup, restore, migration, VPS
  access, deployment, canary, Provider request, charge, flag change or Ozon write occurred.
  `REL-04` stays unchecked, Phase 6 stays `0/3`, and overall progress stays `32/37`.
- Offline `REL-03`/`REL-04` handoff hardening removes deployment-time extension packaging. A
  no-follow bounded staging CLI selects exactly one target-commit, repository-source, origin-bound
  canonical release, preserves the original cloud/local ZIP, checksum and evidence bytes, and
  independently re-verifies the four-file result. All three systemd deployment modes now require a
  root-owned, non-writable `EXTENSION_RELEASE_ROOT` under the initializer-provisioned
  `/var/lib/ss-erp-extension-releases`; they stage the candidate as the isolated build UID and never
  call `pnpm package:extension`. Root then revokes build-UID writes and the trusted sealed helper
  compares every filename and byte back to the immutable candidate before activation. This prevents
  a signed/distributed `REL-03` candidate from being replaced by an automatically incremented
  unsigned package during `REL-04`. Focused package,
  deployment and no-network Linux root tests passed. External signatures/website receipts, actual
  distribution and final signed-package install/upgrade smoke remain open, so `REL-03` and all
  formal counts remain unchanged.
- Final handoff hardening strips inherited `GIT_*` redirects from every provenance read, scopes
  Git's ownership exception to the exact validated checkout, requires the root candidate directory
  and files to be `0755`/`0644`, and proves the isolated build UID can traverse them before work.
  Staging under `umask 077`, clean-checkout `GIT_HEAD` evidence on a `DEPLOYED_COMMIT` target,
  root-owned Git checkout reads, post-stage ZIP replacement, and non-root artifact reads all have
  regressions. The three deployers revoke build-UID writes before sealing, then run the trusted
  sealed helper to compare the four activated files byte-for-byte with the immutable input before
  migration or switching. Focused Windows and no-network Debian tests, full `preflight --build`,
  and the `817.7s` QA-04 offline aggregate passed. No deployment or external release action ran.
- Final handoff review closed the remaining provenance and in-place lifecycle blockers. Formal
  packages and deployment archives now materialize the exact raw Git tree, so checkout EOLs, local
  attributes, replacement refs, filters and index visibility flags cannot change bytes while
  retaining the claimed commit. A matching clean-checkout `GIT_HEAD` candidate is valid on a
  deployment carrying the same `DEPLOYED_COMMIT`. The in-place path keeps the entire serving tree
  root-frozen and installs only root-owned links to external runtime storage. Its trusted helper
  persists a deploy/runtime-root-bound maintenance marker and exact-path systemd drop-ins before
  stopping services and thawing, so SIGKILL or reboot cannot restart from writable source; the
  marker is removed only after reseal, runtime-link verification, migration and dark checks. The
  runtime env remains `root:<runtime-group>` mode `0640`. Focused package/download/deployment tests,
  no-network Debian lifecycle `5/5`, and the final `991.8s` QA-04 offline rehearsal passed. This made
  no deployment, signature, distribution, flag, Provider, pilot or Ozon change; Phase 6 stays `0/3`
  and overall progress stays `32/37`.
- Packy public preflight, private pricing proposals, approval drafts, and the `CANDIDATE_ONLY`
  review helper do not constitute a signed package, distribution receipt, dark deployment, canary,
  or pilot. `REL-03`, `REL-04`, and `REL-02` remain blocked behind accepted positive `QA-02` evidence
  and the formal `QA-04` rerun; no feature flag is enabled.
- After `QA-02` and `QA-04` completed, formal `REL-03` packaging ran from clean pushed commit
  `45693943a63d106d6a4adfb58ca782c1703ba5f8`. The first attempt failed closed before retaining a
  candidate because the build-time API origin had not been bound to the independently reviewed API
  origin; the coordinator removed its partial output and did not consume a version. The corrected
  invocation bound Web/Admin/API to `https://app.ss-erp.com`, `https://admin.ss-erp.com`, and
  `https://ss-erp.com`, with local `http://127.0.0.1:3001`.
- The successful coordinator created canonical version `1.0.265`. Both packages contain 189 files.
  Cloud ZIP SHA-256 is `a832b6e00e24d2a8a335aa272f7109aa73520a235090e570337b04d99e277f80`;
  local ZIP SHA-256 is `3c1e8694dbbee7ff7a5ef7ed4670934417da17b59e248ee8aa914d153a7ac55a`;
  release-evidence SHA-256 is `c4f8f8aeaf4800e4b129be58e1311e0207091b9e2e8d36bcbc6cc01893d7d2e7`.
  The independent release verifier passed, and the official staging helper retained a byte-identical
  private directory containing exactly the two ZIPs, checksum, and evidence.
- A real persistent-Chromium same-path upgrade smoke loaded `1.0.264`, stored one valid non-secret
  Provider profile plus a session-only sentinel, restarted with `1.0.265`, and retained the same
  extension ID and profile. The session sentinel disappeared and was absent from local and sync
  storage. Private smoke-summary SHA-256 is `98996dc33dd7337c94b9e2676bc3f176ff26005d56eb96341e9aa36a824d1b09`.
- The canonical evidence intentionally remains `signature.status=EXTERNAL_REQUIRED`. No detached
  release signature, first-party website distribution receipt, external publication, VPS access, deployment,
  flag change, Provider call, ERP ingest, or Ozon mutation occurred. `REL-03` is not complete until
  the approved first-party `/api/extensions` channel returns retained cloud/local evidence. Phase 6 stays `0/3`
  and overall progress stays `34/37`.
- The distribution channel is now fixed to the first-party website `/api/extensions` interface,
  not Chrome Web Store. An Ed25519 key was generated only in the protected local operator store;
  repository keyring key `ss-erp-extension-release-2026-08-02-01` has public-key SHA-256
  `78b7e0cf...a9a9`. Candidate `1.0.265` was signed without changing its exact four-file directory;
  private signature sidecar SHA-256 is `d2eb50bd...ce84`. This records an immutable signing
  checkpoint only. The Web download-page correction changes application code, so the deployable
  candidate must be regenerated from the final clean implementation commit and signed again. No
  website probe, VPS access, deployment, flag change, Provider call, ERP ingest, or Ozon mutation
  occurred; `REL-03`, `REL-04`, Phase 6 and overall counts remain unchanged.
- The first-party distribution implementation was committed and pushed at
  `19e98810593ea619360edcadf9b78eacc93b37cd`. Final `QA-04` passed from that clean revision in
  `820.1s`; private acceptance summary SHA-256 is `e3f868f3904390287852573ecdabd659c547539bd92f46cbe57798337f50ff01`.
  Fresh verification remained cloud `451/0/0`, local `447/2/0`, and source `446/2/0`.
- The new canonical release is `1.0.266`, with 189 files per target. Cloud ZIP SHA-256 is
  `9c5bbb5df81214e60901bf52f91e2fb59f77ddec8d8ce5e79e525bbd4b7751fe`; local ZIP SHA-256 is
  `ed68aa6e5e48298620fc024be5a531e7731c06801ed25c9436b8d7818592aa83`; canonical evidence
  SHA-256 is `31619531ee06a249f55eababaea8736834e8823d991d1ddfb9ca3a578321c5d3`. The staged candidate
  still contains exactly four files. Detached signature SHA-256 is
  `53428f4fb89e9ccadd25e4a0dc5a7c03d22e717c972224d4c71a9853c13be0bf` and remains outside it.
- A persistent-Chromium same-path upgrade from `1.0.265` to `1.0.266` retained the non-secret
  Provider profile and cleared the session-only sentinel without writing it to local/sync storage.
  Private smoke-summary SHA-256 is `b1519bdc03d99121f6e86f87aeb48cda18620c147bde0062079fd575312a53e1`.
  `REL-03a` is ready, but no real website probe, VPS access, deployment, flag, Provider, ERP or Ozon
  action ran. `REL-03` and `REL-04` remain unchecked until dark canaries and the signed cloud/local
  website receipt pass; Phase 6 remains `0/3` and overall progress remains `34/37`.
- Region binding requires independent `.com` and `.cn` publication chains. From the same clean
  commit and version `1.0.266`, the domestic candidate binds `https://app.ss-erp.cn`,
  `https://admin.ss-erp.cn`, and `https://ss-erp.cn`; its cloud/local ZIP SHA-256 values are
  `23746c3b8bd7b1ce11184dcdcf4161edf182c1b930bb0a4f3fd803728ea14285` and
  `2903ef35faadfea3369e3013559b263f86c96c5b085006162f9f4affd8689606`. Evidence SHA-256 is
  `1a1c756fa5c3b38a824519a048218273c84574c7b1e8c98272148cbdad209d60`; detached signature
  SHA-256 is `1cd54054ed45fb71d74af73427cfdd5dfc3136ad340a2fdc0d3ffb2628abff06` and independently
  verifies against the repository public key. Its same-path `1.0.265` to `1.0.266` Chromium smoke
  preserved the extension ID and non-secret profile and cleared session/local/sync secret state;
  private summary SHA-256 is `b10d89903c7bd8a7238df5278e35b143d424c8d274e3bf547aa067d4758ce7a1`.
- Subsequent read-only VPS checks changed no remote state. International port 22 accepted TCP but
  closed the SSH session before inspection. Domestic API/Web/Worker remained active on legacy
  commit `9e7c8140a17592b76be4b219332f65b58d18cb3f`; its env still has empty
  `CORS_EXTENSION_ORIGINS`, lacks the hardened release-origin/database-identity/backup settings,
  and `/var/lib/ss-erp-extension-releases` is absent. `REL-04` must not deploy until those one-time
  prerequisites are explicitly authorized and verified. No upload, backup, migration, restart,
  website GET, flag, Provider, ERP, or Ozon action occurred; counts remain `0/3` and `34/37`.
- Final release commit `2fa91856b1c09531865c1a9b8af7a0a82d27cf4f` passed the complete
  nine-step `QA-04` aggregate, then produced separately origin-bound `.com` and `.cn` canonical
  version `1.0.272` candidates. Both candidates contain exactly 189 files per package, have
  independent canonical evidence and Ed25519 sidecars, and passed same-path persistent-Chromium
  `1.0.271` to `1.0.272` upgrade smoke without retaining the session sentinel.
- Both VPS environments now run the exact final commit through `/opt/ss-erp/current` with
  API/Worker/Web under `deploy:deploy`, shared env `root:deploy 0640`, target-bound release-mode
  systemd units, verified process working directories, current-script backup cron binding, no
  pending migration, a passing post-migration AI Media database guard, healthy private/public
  `/ready`, and every AI Media, Extension BYOK and Ozon publisher rollout flag still off. Each
  region's full deployment verifier passed with the single non-blocking warning that only local
  backup storage is configured.
- The international first deployment attempt reached the new systemd units but its one-shot health
  curl raced the API listener by less than one second. The deployer removed the first-release
  `current` link, restored all three legacy units, and kept the service available. The failed sealed
  release and systemd snapshot were retained under timestamped failure-history directories. A clean
  second attempt against the same immutable target passed the health gate. The international backup
  cron was then migrated from the legacy `/opt/ss-erp/app` path to the active release script and
  commit marker before the complete verifier was rerun.
- Both protected pre-enable canaries passed all seven checks: exact release metadata and extension
  CORS, default-off policy, Hosted disabled-route regression, target-commit `QA04_FINAL_ACCEPTANCE`
  reconciliation, device pairing/refresh lifecycle, BYOK disabled-path rejection, and session
  cleanup. Domestic receipt SHA-256 is `b2b1abb4...5a32f`; international receipt SHA-256 is
  `2d381f57...63f4e`. The canaries sent no Provider dispatch, ERP ingest, or Ozon mutation. Their
  temporary device sessions were revoked in-band, and the short-lived owner/admin account sessions
  plus raw shop/extension identifiers were removed immediately afterward.
- The first-party website distribution probe then downloaded both exact cloud/local ZIPs from each
  region's immutable version/SHA URL. The operator machine's fake-IP DNS was rejected as designed;
  two independent VPS resolvers agreed on the public addresses, which were supplied to the probe's
  existing pinned TLS fetcher without weakening certificate, redirect, public-address, length,
  header, body-hash, or signing checks. Formal publication verification passed for `.com` receipt
  SHA-256 `ddd86111...f6c4` and `.cn` receipt SHA-256 `1abd7c8d...c944`. This completes `REL-03`
  and `REL-04`; Phase 6 is `2/3`, overall progress is `36/37`, and only the separately authorized
  `REL-02` sandbox/one-shop pilot remains. All pilot flags remain off.
- Read-only `REL-02` readiness then confirmed that neither region has a reusable pilot workflow:
  `.com` has 15 active owner/shop pairs and `.cn` has 5, but both databases contain zero source
  captures, zero source-listing workflows, zero BYOK provenance rows, zero publish intents and zero
  publish attempts. Every Extension BYOK and source-workflow flag remains `false` at revision `0`;
  both admin policies remain their revision-0 off values. Private readiness SHA-256 values are
  `0192dc0e...9969` for `.com` and `19064fe4...a6c` for `.cn`.
- The sanitized repository source-capture fixture is suitable only for the sandbox capture/ingest
  lane. It is explicitly partial and lacks real packaging facts, so it must not be promoted into an
  Ozon one-shop publish. Completing `REL-02` now requires the operator to select one real source
  product and exact Ozon shop, approve creation of a scoped pilot device/session and policy, review
  the captured facts/draft, and separately authorize the resulting Ozon mutation. No pilot flag or
  production record was changed by readiness inspection.
