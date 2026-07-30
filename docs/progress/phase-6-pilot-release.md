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
