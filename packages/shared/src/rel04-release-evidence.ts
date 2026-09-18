// Shared type surface for the API. The plain-JavaScript runtime module is the
// canonical parser used by operator CLIs that cannot depend on a TS loader.

export interface Rel04CandidateIdentity {
  gitCommit: string;
  apiOrigin: string;
  region: 'COM' | 'CN';
  version: string;
  releaseEvidenceSha256: string;
  releaseSignatureSha256: string;
}

export interface Rel04ReleaseBinding {
  candidate: Rel04CandidateIdentity;
  vpsVerificationSha256: string;
  vpsStartedAt: string;
  vpsVerifiedAt: string;
}

export interface VpsVerificationEvidence {
  schemaVersion: 1;
  kind: 'SS_ERP_VPS_VERIFICATION';
  scope: 'FULL';
  status: 'PASS';
  startedAt: string;
  completedAt: string;
  failures: 0;
  warnings: number;
  candidate: Rel04CandidateIdentity;
}

export {
  REL04_VPS_EVIDENCE_MAX_AGE_MS,
  parseRel04CandidateIdentity,
  parseVpsVerificationEvidence,
  validateRel04ReleaseBinding,
} from './rel04-release-evidence-runtime.mjs';
