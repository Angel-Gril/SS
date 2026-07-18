import { z } from 'zod';
import {
  AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH,
  isAiMediaPlanningJsonWithinBudget,
} from './ai-media-planning-contract.js';

// Bump when parser, normalization, deterministic rules, or fallback semantics change.
export const AI_IMAGE_CURATION_IMPLEMENTATION_VERSION = 'ai-image-curation-implementation/v1' as const;

export const AI_IMAGE_CURATION_RULES = Object.freeze({
  minWidth: 200,
  minHeight: 200,
  maxLongEdge: 7680,
  maxShortEdge: 4320,
  minAspectRatio: 0.35,
  maxAspectRatio: 2.6,
  preferredAspectRatio: 0.75,
  maxCandidates: 25,
  minSelected: 7,
  maxSelected: 14,
});

export type ImageCurationDisposition = 'keep' | 'reject' | 'manual';
export type ImageTranslationDisposition = 'translate' | 'skip' | 'unknown';
export type ImageCurationContentRole = 'identity' | 'context' | 'detail' | 'unknown';

export interface ImageCurationCandidate {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  role: 'product_main' | 'product_detail' | 'sku' | 'video' | 'video_cover' | 'unknown';
  skuKeys: string[];
  contentHash?: string | null;
  decorative?: boolean;
  continuityGroup?: string | null;
}

export type ImageCurationReason =
  | 'INVALID_URL'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MEDIA_TYPE_UNKNOWN'
  | 'DIMENSIONS_UNKNOWN'
  | 'TOO_SMALL'
  | 'TOO_LARGE'
  | 'EXTREME_ASPECT_RATIO'
  | 'DUPLICATE'
  | 'DECORATIVE'
  | 'SOURCE_ROLE_UNKNOWN'
  | 'UNSUPPORTED_SOURCE_ROLE'
  | 'CANDIDATE_LIMIT'
  | 'SELECTION_LIMIT'
  | 'MODEL_REJECTED'
  | 'MODEL_MANUAL'
  | 'MODEL_NOT_SELECTED'
  | 'CONTINUITY_GROUP_INCOMPLETE'
  | 'CONTINUITY_GROUP_INVALID'
  | 'CONTINUITY_GROUP_MODEL_CONFLICT';

export interface ImageCurationDecision {
  candidateId: string;
  disposition: ImageCurationDisposition;
  reasonCodes: ImageCurationReason[];
  translation: ImageTranslationDisposition;
  contentRole: ImageCurationContentRole;
  score: number | null;
  duplicateOfCandidateId: string | null;
  continuity: {
    groupKey: string;
    index: number;
    total: number;
  } | null;
}

export interface ImageCurationDiagnostic {
  code:
    | 'DUPLICATE_MODEL_DECISION'
    | 'CONTINUITY_GROUP_EXPANDED'
    | 'CONTINUITY_GROUP_MODEL_CONFLICT'
    | 'MODEL_DECISION_BLOCKED_BY_RULE'
    | 'MODEL_SELECTION_LIMIT';
  candidateId: string;
}

export interface ImageCurationPlan {
  version: '1.0';
  mode: 'deterministic' | 'model' | 'fallback';
  consideredCandidateIds: string[];
  selectedCandidateIds: string[];
  decisions: ImageCurationDecision[];
  selectionTarget: {
    minimum: number;
    maximum: number;
    eligibleCount: number;
    selectedCount: number;
    met: boolean;
  };
  discardedModelCandidateIds: string[];
  diagnostics: ImageCurationDiagnostic[];
  fallbackReason: 'INVALID_MODEL_OUTPUT' | 'NO_VALID_MODEL_SELECTION' | null;
}

function selectionTarget(eligibleCount: number, selectedCount: number): ImageCurationPlan['selectionTarget'] {
  const minimum = AI_IMAGE_CURATION_RULES.minSelected;
  const maximum = AI_IMAGE_CURATION_RULES.maxSelected;
  return {
    minimum,
    maximum,
    eligibleCount,
    selectedCount,
    met: selectedCount <= maximum
      && (eligibleCount < minimum ? selectedCount === eligibleCount : selectedCount >= minimum),
  };
}

const modelDecisionSchema = z.object({
  candidateId: z.string().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH),
  disposition: z.enum(['keep', 'reject', 'manual']),
  translation: z.enum(['translate', 'skip', 'unknown']),
  contentRole: z.enum(['identity', 'context', 'detail', 'unknown']),
}).strict();

const modelOutputSchema = z.object({
  version: z.literal('1.0'),
  decisions: z.array(modelDecisionSchema).max(AI_IMAGE_CURATION_RULES.maxCandidates * 2),
}).strict();

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
]);

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function inferredMimeType(candidate: ImageCurationCandidate): string | null {
  const declared = String(candidate.mimeType || '').trim().toLowerCase();
  if (declared) return declared.split(';', 1)[0] || null;
  const url = normalizeUrl(candidate.url);
  if (!url) return null;
  const pathname = new URL(url).pathname.toLowerCase();
  if (/\.jpe?g$/.test(pathname)) return 'image/jpeg';
  if (/\.png$/.test(pathname)) return 'image/png';
  if (/\.webp$/.test(pathname)) return 'image/webp';
  if (/\.avif$/.test(pathname)) return 'image/avif';
  return null;
}

function defaultContentRole(candidate: ImageCurationCandidate): ImageCurationContentRole {
  if (candidate.role === 'product_main' || candidate.role === 'sku') return 'identity';
  if (candidate.role === 'product_detail') return 'detail';
  return 'unknown';
}

function scoreCandidate(candidate: ImageCurationCandidate, index: number): number | null {
  if (!candidate.width || !candidate.height) return null;
  const ratio = candidate.width / candidate.height;
  const aspectScore = Math.max(0, 1 - Math.abs(ratio - AI_IMAGE_CURATION_RULES.preferredAspectRatio)) * 1000;
  const pixelScore = Math.min(candidate.width * candidate.height, 12_000_000) / 120_000;
  const roleScore = candidate.role === 'product_main' ? 80 : candidate.role === 'sku' ? 60 : 40;
  return aspectScore + pixelScore + roleScore - index / 100_000;
}

function continuityFor(
  candidate: ImageCurationCandidate,
  candidates: ImageCurationCandidate[],
): ImageCurationDecision['continuity'] {
  const groupKey = candidate.continuityGroup?.trim();
  if (!groupKey) return null;
  const members = candidates.filter((item) => item.continuityGroup?.trim() === groupKey);
  return {
    groupKey,
    index: members.findIndex((item) => item.id === candidate.id),
    total: members.length,
  };
}

function ensureUniqueCandidateIds(candidates: ImageCurationCandidate[]): void {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id
      || candidate.id !== candidate.id.trim()
      || candidate.id.length > AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH) {
      throw new Error('Image curation candidate ID is invalid');
    }
    if (ids.has(candidate.id)) throw new Error(`Duplicate image curation candidate ID: ${candidate.id}`);
    ids.add(candidate.id);
  }
}

interface PreliminaryDecision {
  candidate: ImageCurationCandidate;
  decision: ImageCurationDecision;
  sourceIndex: number;
  hardRejected: boolean;
}

function preliminaryDecisions(candidates: ImageCurationCandidate[]): PreliminaryDecision[] {
  const result: PreliminaryDecision[] = candidates.map((candidate, sourceIndex) => {
    const reasonCodes: ImageCurationReason[] = [];
    const normalizedUrl = normalizeUrl(candidate.url);
    let disposition: ImageCurationDisposition = 'keep';

    if (sourceIndex >= AI_IMAGE_CURATION_RULES.maxCandidates) {
      reasonCodes.push('CANDIDATE_LIMIT');
    } else if (!normalizedUrl) {
      reasonCodes.push('INVALID_URL');
    } else {
      const mimeType = inferredMimeType(candidate);
      if (!mimeType) reasonCodes.push('MEDIA_TYPE_UNKNOWN');
      else if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) reasonCodes.push('UNSUPPORTED_MEDIA_TYPE');
    }

    if (candidate.decorative) reasonCodes.push('DECORATIVE');
    if (candidate.role === 'video') reasonCodes.push('UNSUPPORTED_SOURCE_ROLE');
    else if (candidate.role === 'video_cover' || candidate.role === 'unknown') {
      reasonCodes.push('SOURCE_ROLE_UNKNOWN');
    }

    if (candidate.width == null || candidate.height == null) {
      reasonCodes.push('DIMENSIONS_UNKNOWN');
    } else if (!Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)
      || candidate.width < 1 || candidate.height < 1) {
      reasonCodes.push('DIMENSIONS_UNKNOWN');
    } else {
      if (candidate.width < AI_IMAGE_CURATION_RULES.minWidth
        || candidate.height < AI_IMAGE_CURATION_RULES.minHeight) {
        reasonCodes.push('TOO_SMALL');
      }
      const longEdge = Math.max(candidate.width, candidate.height);
      const shortEdge = Math.min(candidate.width, candidate.height);
      if (longEdge > AI_IMAGE_CURATION_RULES.maxLongEdge
        || shortEdge > AI_IMAGE_CURATION_RULES.maxShortEdge) {
        reasonCodes.push('TOO_LARGE');
      }
      const ratio = candidate.width / candidate.height;
      if (ratio < AI_IMAGE_CURATION_RULES.minAspectRatio
        || ratio > AI_IMAGE_CURATION_RULES.maxAspectRatio) {
        reasonCodes.push('EXTREME_ASPECT_RATIO');
      }
    }

    const manualReasons = new Set<ImageCurationReason>([
      'DIMENSIONS_UNKNOWN',
      'MEDIA_TYPE_UNKNOWN',
      'CANDIDATE_LIMIT',
      'SOURCE_ROLE_UNKNOWN',
    ]);
    const manualOnly = reasonCodes.length > 0 && reasonCodes.every((reason) => manualReasons.has(reason));
    if (reasonCodes.length > 0) disposition = manualOnly ? 'manual' : 'reject';

    return {
      candidate,
      sourceIndex,
      hardRejected: disposition !== 'keep',
      decision: {
        candidateId: candidate.id,
        disposition,
        reasonCodes,
        translation: 'unknown',
        contentRole: defaultContentRole(candidate),
        score: disposition === 'keep' ? scoreCandidate(candidate, sourceIndex) : null,
        duplicateOfCandidateId: null,
        continuity: continuityFor(candidate, candidates),
      },
    };
  });

  const parents = result.map((_item, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parents[root] !== root) root = parents[root]!;
    let current = value;
    while (parents[current] !== current) {
      const next = parents[current]!;
      parents[current] = root;
      current = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const ownerByDedupeKey = new Map<string, number>();
  result.forEach((item, index) => {
    const keys = [
      item.candidate.contentHash?.trim()
        ? `hash:${item.candidate.contentHash.trim()}`
        : null,
      normalizeUrl(item.candidate.url)
        ? `url:${normalizeUrl(item.candidate.url)}`
        : null,
    ].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const owner = ownerByDedupeKey.get(key);
      if (owner == null) ownerByDedupeKey.set(key, index);
      else union(owner, index);
    }
  });
  const duplicateGroups = new Map<number, PreliminaryDecision[]>();
  result.forEach((item, index) => {
    const root = find(index);
    const group = duplicateGroups.get(root) || [];
    group.push(item);
    duplicateGroups.set(root, group);
  });
  const dispositionRank = (disposition: ImageCurationDisposition): number => (
    disposition === 'keep' ? 0 : disposition === 'manual' ? 1 : 2
  );
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const [winner, ...duplicates] = [...group].sort((left, right) => (
      dispositionRank(left.decision.disposition) - dispositionRank(right.decision.disposition)
      || (right.decision.score ?? 0) - (left.decision.score ?? 0)
      || left.sourceIndex - right.sourceIndex
    ));
    for (const duplicate of duplicates) {
      duplicate.decision.disposition = 'reject';
      duplicate.decision.reasonCodes.push('DUPLICATE');
      duplicate.decision.duplicateOfCandidateId = winner!.candidate.id;
      duplicate.decision.score = null;
      duplicate.hardRejected = true;
    }
  }

  const continuityGroups = new Map<string, PreliminaryDecision[]>();
  for (const item of result) {
    const key = item.candidate.continuityGroup?.trim();
    if (!key) continue;
    const members = continuityGroups.get(key) || [];
    members.push(item);
    continuityGroups.set(key, members);
  }
  for (const members of continuityGroups.values()) {
    const ordered = [...members].sort((left, right) => left.sourceIndex - right.sourceIndex);
    const structurallyValid = ordered.length >= 2
      && ordered.every((item) => item.candidate.role === 'product_detail')
      && ordered.every((item, index) => index === 0
        || item.sourceIndex === ordered[index - 1]!.sourceIndex + 1);
    const reason: ImageCurationReason | null = !structurallyValid
      ? 'CONTINUITY_GROUP_INVALID'
      : ordered.some((item) => item.decision.disposition !== 'keep')
        ? 'CONTINUITY_GROUP_INCOMPLETE'
        : null;
    if (!reason) continue;
    for (const item of ordered) {
      if (item.decision.disposition !== 'keep') continue;
      item.decision.disposition = 'manual';
      item.decision.reasonCodes.push(reason);
      item.decision.score = null;
      item.hardRejected = true;
    }
  }
  return result;
}

function selectBoundedContinuityGroups(
  eligible: PreliminaryDecision[],
  preferredOrder?: string[],
): { selectedIds: string[]; overflowIds: string[] } {
  const rank = new Map((preferredOrder || []).map((id, index) => [id, index]));
  const byGroup = new Map<string, PreliminaryDecision[]>();
  for (const item of eligible) {
    const key = item.candidate.continuityGroup?.trim() || `candidate:${item.candidate.id}`;
    const group = byGroup.get(key) || [];
    group.push(item);
    byGroup.set(key, group);
  }
  const units = [...byGroup.values()].sort((left, right) => {
    if (preferredOrder) {
      const leftRank = Math.min(...left.map((item) => rank.get(item.candidate.id) ?? Number.MAX_SAFE_INTEGER));
      const rightRank = Math.min(...right.map((item) => rank.get(item.candidate.id) ?? Number.MAX_SAFE_INTEGER));
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    const leftScore = Math.max(...left.map((item) => item.decision.score ?? 0));
    const rightScore = Math.max(...right.map((item) => item.decision.score ?? 0));
    if (leftScore !== rightScore) return rightScore - leftScore;
    return Math.min(...left.map((item) => item.sourceIndex)) - Math.min(...right.map((item) => item.sourceIndex));
  });
  const selectedIds: string[] = [];
  const overflowIds: string[] = [];
  for (const unit of units) {
    const ordered = [...unit].sort((left, right) => left.sourceIndex - right.sourceIndex);
    if (selectedIds.length + ordered.length <= AI_IMAGE_CURATION_RULES.maxSelected) {
      selectedIds.push(...ordered.map((item) => item.candidate.id));
    } else {
      overflowIds.push(...ordered.map((item) => item.candidate.id));
    }
  }
  return { selectedIds, overflowIds };
}

function cloneDecision(decision: ImageCurationDecision): ImageCurationDecision {
  return {
    ...decision,
    reasonCodes: [...decision.reasonCodes],
    continuity: decision.continuity ? { ...decision.continuity } : null,
  };
}

export function createDeterministicImageCuration(candidates: ImageCurationCandidate[]): ImageCurationPlan {
  ensureUniqueCandidateIds(candidates);
  const preliminary = preliminaryDecisions(candidates);
  const eligible = preliminary.filter((item) => item.decision.disposition === 'keep');
  const { selectedIds, overflowIds } = selectBoundedContinuityGroups(eligible);
  const overflow = new Set(overflowIds);
  const decisions = preliminary.map(({ decision }) => {
    const result = cloneDecision(decision);
    if (overflow.has(result.candidateId)) {
      result.disposition = 'manual';
      result.reasonCodes.push('SELECTION_LIMIT');
    }
    return result;
  });
  return {
    version: '1.0',
    mode: 'deterministic',
    consideredCandidateIds: candidates.slice(0, AI_IMAGE_CURATION_RULES.maxCandidates).map((item) => item.id),
    selectedCandidateIds: selectedIds,
    decisions,
    selectionTarget: selectionTarget(eligible.length, selectedIds.length),
    discardedModelCandidateIds: [],
    diagnostics: [],
    fallbackReason: null,
  };
}

function fallback(
  deterministic: ImageCurationPlan,
  reason: NonNullable<ImageCurationPlan['fallbackReason']>,
  discardedModelCandidateIds: string[] = [],
): ImageCurationPlan {
  return {
    ...deterministic,
    mode: 'fallback',
    fallbackReason: reason,
    discardedModelCandidateIds,
    decisions: deterministic.decisions.map(cloneDecision),
  };
}

function parseModelOutput(value: unknown): z.infer<typeof modelOutputSchema> | null {
  if (!isAiMediaPlanningJsonWithinBudget(value)) return null;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const result = modelOutputSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function validateImageCurationModelOutput(value: unknown): boolean {
  return parseModelOutput(value) !== null;
}

export function normalizeImageCurationModelOutput(
  candidates: ImageCurationCandidate[],
  modelOutput: unknown,
): ImageCurationPlan {
  const deterministic = createDeterministicImageCuration(candidates);
  const parsed = parseModelOutput(modelOutput);
  if (!parsed) return fallback(deterministic, 'INVALID_MODEL_OUTPUT');

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const deterministicById = new Map(deterministic.decisions.map((decision) => [decision.candidateId, decision]));
  const discardedModelCandidateIds: string[] = [];
  const diagnostics: ImageCurationDiagnostic[] = [];
  const acceptedModelDecision = new Map<string, z.infer<typeof modelDecisionSchema>>();

  for (const decision of parsed.decisions) {
    if (!candidateById.has(decision.candidateId)) {
      if (!discardedModelCandidateIds.includes(decision.candidateId)) {
        discardedModelCandidateIds.push(decision.candidateId);
      }
      continue;
    }
    if (acceptedModelDecision.has(decision.candidateId)) {
      diagnostics.push({ code: 'DUPLICATE_MODEL_DECISION', candidateId: decision.candidateId });
      continue;
    }
    acceptedModelDecision.set(decision.candidateId, decision);
  }

  const conflictedContinuityGroups = new Set<string>();
  for (const candidate of candidates) {
    const groupKey = candidate.continuityGroup?.trim();
    if (!groupKey || conflictedContinuityGroups.has(groupKey)) continue;
    const groupDecisions = candidates
      .filter((member) => member.continuityGroup?.trim() === groupKey)
      .map((member) => acceptedModelDecision.get(member.id))
      .filter((decision): decision is z.infer<typeof modelDecisionSchema> => Boolean(decision));
    if (groupDecisions.some((decision) => decision.disposition === 'keep')
      && groupDecisions.some((decision) => decision.disposition !== 'keep')) {
      conflictedContinuityGroups.add(groupKey);
      for (const decision of groupDecisions) {
        if (decision.disposition === 'keep') {
          diagnostics.push({
            code: 'CONTINUITY_GROUP_MODEL_CONFLICT',
            candidateId: decision.candidateId,
          });
        }
      }
    }
  }

  const modelSelectedOrder = [...acceptedModelDecision.values()]
    .filter((decision) => {
      if (decision.disposition !== 'keep') return false;
      const groupKey = candidateById.get(decision.candidateId)?.continuityGroup?.trim();
      return !groupKey || !conflictedContinuityGroups.has(groupKey);
    })
    .map((decision) => decision.candidateId);
  if (acceptedModelDecision.size === 0) {
    return {
      ...fallback(deterministic, 'NO_VALID_MODEL_SELECTION', discardedModelCandidateIds),
      diagnostics,
    };
  }
  const modelSelectedSet = new Set(modelSelectedOrder);
  for (const selectedId of [...modelSelectedOrder]) {
    const candidate = candidateById.get(selectedId);
    const groupKey = candidate?.continuityGroup?.trim();
    if (!groupKey || conflictedContinuityGroups.has(groupKey)) continue;
    for (const member of candidates) {
      if (member.continuityGroup?.trim() !== groupKey || modelSelectedSet.has(member.id)) continue;
      modelSelectedSet.add(member.id);
      modelSelectedOrder.push(member.id);
      diagnostics.push({ code: 'CONTINUITY_GROUP_EXPANDED', candidateId: member.id });
    }
  }

  const eligible = preliminaryDecisions(candidates).filter((item) => {
    const deterministicDecision = deterministicById.get(item.candidate.id);
    if (!deterministicDecision) return false;
    const onlySoftSelectionRejection = deterministicDecision.disposition === 'manual'
      && deterministicDecision.reasonCodes.every((reason) => (
        reason === 'SELECTION_LIMIT' || reason === 'SOURCE_ROLE_UNKNOWN'
      ));
    return modelSelectedSet.has(item.candidate.id)
      && (deterministicDecision.disposition === 'keep' || onlySoftSelectionRejection);
  });
  const eligibleIds = new Set(eligible.map((item) => item.candidate.id));
  for (const candidateId of modelSelectedOrder) {
    if (!eligibleIds.has(candidateId)) {
      diagnostics.push({ code: 'MODEL_DECISION_BLOCKED_BY_RULE', candidateId });
    }
  }
  const bounded = selectBoundedContinuityGroups(eligible, modelSelectedOrder);
  const selected = new Set(bounded.selectedIds);
  for (const candidateId of bounded.overflowIds) {
    diagnostics.push({ code: 'MODEL_SELECTION_LIMIT', candidateId });
  }
  const decisions = deterministic.decisions.map((base) => {
    const result = cloneDecision(base);
    const modelDecision = acceptedModelDecision.get(base.candidateId);
    if (selected.has(base.candidateId)) {
      result.disposition = 'keep';
      result.reasonCodes = [];
      const directOrGroupDecision = modelDecision
        || (result.continuity
          ? [...acceptedModelDecision.values()].find((decision) => (
            candidateById.get(decision.candidateId)?.continuityGroup?.trim() === result.continuity?.groupKey
            && decision.disposition === 'keep'
          ))
          : undefined);
      if (directOrGroupDecision) {
        result.translation = directOrGroupDecision.translation;
        result.contentRole = directOrGroupDecision.contentRole;
      }
      return result;
    }
    if (base.reasonCodes.some((reason) => reason !== 'SELECTION_LIMIT')) return result;
    if (modelDecision?.disposition === 'manual') {
      result.disposition = 'manual';
      result.reasonCodes = ['MODEL_MANUAL'];
      result.translation = modelDecision.translation;
      result.contentRole = modelDecision.contentRole;
    } else if (modelDecision?.disposition === 'reject') {
      result.disposition = 'reject';
      result.reasonCodes = ['MODEL_REJECTED'];
      result.translation = modelDecision.translation;
      result.contentRole = modelDecision.contentRole;
    } else {
      result.disposition = 'manual';
      result.reasonCodes = result.continuity
        && conflictedContinuityGroups.has(result.continuity.groupKey)
        ? ['CONTINUITY_GROUP_MODEL_CONFLICT']
        : bounded.overflowIds.includes(base.candidateId)
          ? ['SELECTION_LIMIT']
          : ['MODEL_NOT_SELECTED'];
    }
    return result;
  });

  return {
    version: '1.0',
    mode: 'model',
    consideredCandidateIds: deterministic.consideredCandidateIds,
    selectedCandidateIds: bounded.selectedIds,
    decisions,
    selectionTarget: selectionTarget(
      deterministic.decisions.filter((decision) => (
        decision.disposition === 'keep'
        || (decision.disposition === 'manual'
          && decision.reasonCodes.every((reason) => (
            reason === 'SELECTION_LIMIT' || reason === 'SOURCE_ROLE_UNKNOWN'
          )))
      )).length,
      bounded.selectedIds.length,
    ),
    discardedModelCandidateIds,
    diagnostics,
    fallbackReason: null,
  };
}
