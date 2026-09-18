import type {
  Rel04CandidateIdentity,
  Rel04ReleaseBinding,
  VpsVerificationEvidence,
} from './rel04-release-evidence.js';

export const REL04_VPS_EVIDENCE_MAX_AGE_MS: number;

export function parseRel04CandidateIdentity(value: unknown): Rel04CandidateIdentity;

export function parseVpsVerificationEvidence(value: unknown): VpsVerificationEvidence;

export function validateRel04ReleaseBinding(
  value: unknown,
  expected: Pick<Rel04CandidateIdentity, 'gitCommit' | 'apiOrigin'>
    & Partial<Rel04CandidateIdentity>,
  observedAt: string,
  releaseSignedAt?: string,
): Rel04ReleaseBinding;
