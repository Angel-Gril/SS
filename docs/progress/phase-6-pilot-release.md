# Phase 6: Pilot and Release

Progress: 0/3 tasks.

## Tasks

- [ ] `REL-02` Run owner/shop/device pilots (`P0`, `M`). Acceptance: sandbox, then one-shop
  publish pilot succeeds; positive BYOK fixture ingest passes; generation/ingest/publish kill
  switches are independent; audit and receipts are visible; post-enable canaries and publish
  reconciliation pass; rollback preserves consistent stored assets and receipts. Depends on the
  dark deployment and pre-enable canaries in `REL-04`.
- [ ] `REL-03` Build/sign/distribute cloud and local extension packages (`P0`, `M`).
  Acceptance: same feature set with environment-correct endpoints, one version increment,
  non-secret profile upgrade, no session-key persistence, verified hashes, and smoke results.
  Depends on `QA-03`, `QA-04`, and `DOC-01`.
- [ ] `REL-04` Deploy server/web dark and run pre-enable canaries (`P0`, `M`). Acceptance:
  backup/migration, services, readiness, default-off flags, both VPS environments, pairing, hosted
  regression, BYOK disabled-path fixture rejection, and publish reconciliation pass before pilot
  enablement. Depends on `REL-03`.

## Parallel Lanes

- Lane A: rollout controls and observability preparation; no pilot flag is enabled.
- Lane B: final exact Provider sandbox evidence.
- After all quality gates pass, execution is strictly `REL-03` package -> `REL-04` dark deploy and
  pre-enable canary -> `REL-02` sandbox/one-shop pilot and post-enable canary.

## Notes

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
  or store receipt exists yet. No package was signed/distributed, no VPS was changed and no rollout
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
  deployment and no-network Linux root tests passed. External signatures/store receipts, actual
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
