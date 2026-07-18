import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH,
  AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH,
  compareAiMediaPlanningStrings,
  isAiMediaPlanningJsonWithinBudget,
} from './ai-media-planning-contract.js';

export const AI_IMAGE_PROMPT_PLAN_VERSION = '2.0' as const;
export const AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES = 5;

export type SkuIdentityImpact =
  | 'color'
  | 'structure'
  | 'capacity'
  | 'bundle'
  | 'packaging'
  | 'other_identity'
  | 'unknown'
  | 'non_visual';

export interface ImagePromptPlanSku {
  skuKey: string;
  attributes: Array<{
    key: string;
    value: string;
    identityImpact: SkuIdentityImpact;
  }>;
}

export interface ImagePromptPlanImage {
  candidateId: string;
  skuKeys: string[];
  contentRole: 'identity' | 'context' | 'detail' | 'unknown';
  evidenceIds: string[];
}

export interface ImagePromptPlanVerifiedFact {
  path: string;
  value: unknown;
  evidenceIds: string[];
  skuKeys?: string[];
}

export interface ImagePromptPlanInput {
  skus: ImagePromptPlanSku[];
  images: ImagePromptPlanImage[];
  verifiedFacts: ImagePromptPlanVerifiedFact[];
  galleryGoals?: string[];
}

export interface ImageCompatibilityGroup {
  groupKey: string;
  identitySignature: string;
  skuKeys: string[];
}

export interface ImagePromptPlanReference {
  candidateId: string;
  evidenceIds: string[];
}

export interface ImagePromptPlanSlot {
  slotKey: string;
  goal: string;
  status: 'READY' | 'MANUAL_REQUIRED';
  aspectRatio: '3:4';
  ownership: {
    level: 'sku' | 'compatibility_group';
    key: string;
  };
  references: ImagePromptPlanReference[];
  factEvidenceIds: string[];
  safetyConstraints: string[];
  acceptanceChecks: string[];
}

export interface ImagePromptPlanDiagnostic {
  code: 'UNKNOWN_SLOT_ID' | 'DUPLICATE_SLOT_ID' | 'UNKNOWN_REFERENCE_ID' | 'INCOMPATIBLE_REFERENCE_ID';
  slotKey: string;
  candidateId?: string;
}

export interface ImagePromptPlan {
  version: typeof AI_IMAGE_PROMPT_PLAN_VERSION;
  mode: 'rule_based' | 'model' | 'fallback';
  compatibilityGroups: ImageCompatibilityGroup[];
  slots: ImagePromptPlanSlot[];
  verifiedFacts: ImagePromptPlanVerifiedFact[];
  manualSelectionAllowed: true;
  recoverable: true;
  diagnostics: ImagePromptPlanDiagnostic[];
  fallbackReason: 'INVALID_MODEL_OUTPUT' | null;
}

const DEFAULT_GALLERY_GOALS = [
  'scene',
  'detail',
  'function',
  'fitment',
  'spec',
  'package',
  'poster',
] as const;

const modelOutputSchema = z.object({
  version: z.literal(AI_IMAGE_PROMPT_PLAN_VERSION),
  slots: z.array(z.object({
    slotKey: z.string().min(1).max(AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH),
    referenceCandidateIds: z.array(z.string().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH)).max(30),
  }).strict()).max(500),
}).strict();

const MAX_VERIFIED_FACTS = 500;
const MAX_FACT_JSON_BYTES = 64 * 1024;
const MAX_FACTS_JSON_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 10_000;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJsonClone(
  value: unknown,
  state: { nodes: number; ancestors: Set<object> } = { nodes: 0, ancestors: new Set<object>() },
  depth = 0,
): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new TypeError('Image prompt plan verified facts exceed JSON limits');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Image prompt plan verified facts require finite JSON numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) throw new TypeError('Image prompt plan verified facts contain circular JSON');
    if (value.length > 2_000) throw new TypeError('Image prompt plan verified facts exceed JSON array limits');
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError('Image prompt plan verified facts cannot persist sparse JSON arrays');
      }
    }
    state.ancestors.add(value);
    try {
      return value.map((item) => canonicalJsonClone(item, state, depth + 1));
    } finally {
      state.ancestors.delete(value);
    }
  }
  if (!isPlainObject(value)) throw new TypeError('Image prompt plan verified facts must be persistable JSON');
  if (state.ancestors.has(value)) throw new TypeError('Image prompt plan verified facts contain circular JSON');
  const keys = Object.keys(value).sort();
  if (keys.length > 1_000) throw new TypeError('Image prompt plan verified facts exceed JSON object limits');
  state.ancestors.add(value);
  try {
    const entries: Array<[string, unknown]> = [];
    for (const key of keys) {
      if (!key || key.length > 500) throw new TypeError('Image prompt plan verified facts contain invalid JSON keys');
      entries.push([key, canonicalJsonClone(value[key], state, depth + 1)]);
    }
    return Object.fromEntries(entries);
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeVerifiedFacts(input: ImagePromptPlanInput): ImagePromptPlanVerifiedFact[] {
  if (input.verifiedFacts.length > MAX_VERIFIED_FACTS) {
    throw new TypeError('Image prompt plan has too many verified facts to persist as JSON');
  }
  const normalizedFacts: ImagePromptPlanVerifiedFact[] = input.verifiedFacts.map((fact) => {
    if (!fact.path.startsWith('/') || fact.path.length > 2_048) {
      throw new TypeError('Image prompt plan verified fact path is invalid');
    }
    const evidenceIds = [...new Set(fact.evidenceIds)].sort();
    if (evidenceIds.length < 1 || evidenceIds.some((evidenceId) => (
      !evidenceId
      || evidenceId !== evidenceId.trim()
      || evidenceId.length > AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH
    ))) {
      throw new TypeError('Image prompt plan verified fact evidence is invalid');
    }
    const normalizedSkuKeys = fact.skuKeys ? [...new Set(fact.skuKeys)].sort() : [];
    const skuKeys = normalizedSkuKeys.length > 0 ? normalizedSkuKeys : undefined;
    const value = canonicalJsonClone(fact.value);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_FACT_JSON_BYTES) {
      throw new TypeError('Image prompt plan verified fact exceeds JSON persistence limits');
    }
    return {
      path: fact.path,
      value,
      evidenceIds,
      ...(skuKeys ? { skuKeys } : {}),
    };
  });
  const byScopeAndPath = new Map<string, ImagePromptPlanVerifiedFact>();
  for (const fact of normalizedFacts) {
    const key = JSON.stringify([fact.path, fact.skuKeys || []]);
    const existing = byScopeAndPath.get(key);
    if (!existing) {
      byScopeAndPath.set(key, fact);
      continue;
    }
    if (JSON.stringify(existing.value) !== JSON.stringify(fact.value)) {
      throw new TypeError(`Image prompt plan has conflicting verified facts at ${fact.path}`);
    }
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...fact.evidenceIds])].sort();
  }
  const facts = [...byScopeAndPath.values()].sort((left, right) => (
    compareAiMediaPlanningStrings(left.path, right.path)
    || compareAiMediaPlanningStrings((left.skuKeys || []).join('\u0000'), (right.skuKeys || []).join('\u0000'))
    || compareAiMediaPlanningStrings(JSON.stringify(left.value), JSON.stringify(right.value))
    || compareAiMediaPlanningStrings(left.evidenceIds.join('\u0000'), right.evidenceIds.join('\u0000'))
  ));
  if (Buffer.byteLength(JSON.stringify(facts), 'utf8') > MAX_FACTS_JSON_BYTES) {
    throw new TypeError('Image prompt plan verified facts exceed JSON persistence limits');
  }
  return facts;
}

function ensureUniqueInputs(input: ImagePromptPlanInput): void {
  const skuKeys = new Set<string>();
  for (const sku of input.skus) {
    if (!sku.skuKey
      || sku.skuKey !== sku.skuKey.trim()
      || sku.skuKey.length > AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH) {
      throw new Error('Image prompt plan SKU key is invalid');
    }
    if (skuKeys.has(sku.skuKey)) throw new Error(`Duplicate image prompt plan SKU key: ${sku.skuKey}`);
    skuKeys.add(sku.skuKey);
  }
  const candidateIds = new Set<string>();
  for (const image of input.images) {
    if (!image.candidateId
      || image.candidateId !== image.candidateId.trim()
      || image.candidateId.length > AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH) {
      throw new Error('Image prompt plan candidate ID is invalid');
    }
    if (candidateIds.has(image.candidateId)) {
      throw new Error(`Duplicate image prompt plan candidate ID: ${image.candidateId}`);
    }
    candidateIds.add(image.candidateId);
    if (image.skuKeys.some((skuKey) => !skuKeys.has(skuKey))) {
      throw new Error(`Image prompt plan candidate references an unknown SKU: ${image.candidateId}`);
    }
  }
  for (const fact of input.verifiedFacts) {
    if (fact.skuKeys?.some((skuKey) => !skuKeys.has(skuKey))) {
      throw new Error(`Image prompt plan fact references an unknown SKU: ${fact.path}`);
    }
  }
}

function identitySignature(sku: ImagePromptPlanSku): string {
  const dimensions = sku.attributes
    .filter((attribute) => attribute.identityImpact !== 'color' && attribute.identityImpact !== 'non_visual')
    .map((attribute) => ({
      impact: attribute.identityImpact,
      key: normalized(attribute.key),
      value: normalized(attribute.value),
    }))
    .sort((left, right) => (
      compareAiMediaPlanningStrings(left.impact, right.impact)
      || compareAiMediaPlanningStrings(left.key, right.key)
      || compareAiMediaPlanningStrings(left.value, right.value)
    ));
  return JSON.stringify({
    dimensions,
    unknownOwner: sku.attributes.some((attribute) => attribute.identityImpact === 'unknown')
      ? sku.skuKey
      : null,
  });
}

function groupKey(signature: string): string {
  return `visual-${createHash('sha256').update(signature || 'base-product').digest('hex').slice(0, 24)}`;
}

function compatibilityGroups(skus: ImagePromptPlanSku[]): ImageCompatibilityGroup[] {
  const grouped = new Map<string, string[]>();
  for (const sku of skus) {
    const signature = identitySignature(sku);
    const members = grouped.get(signature) || [];
    members.push(sku.skuKey);
    grouped.set(signature, members);
  }
  return [...grouped.entries()]
    .map(([signature, skuKeys]) => ({
      groupKey: groupKey(signature),
      identitySignature: signature,
      skuKeys: [...skuKeys].sort(),
    }))
    .sort((left, right) => (
      compareAiMediaPlanningStrings(left.identitySignature, right.identitySignature)
      || compareAiMediaPlanningStrings(left.skuKeys.join('|'), right.skuKeys.join('|'))
    ));
}

function imagePriority(image: ImagePromptPlanImage, preferredSkuKey?: string): number {
  const skuPriority = preferredSkuKey && image.skuKeys.includes(preferredSkuKey)
    ? 0
    : image.skuKeys.length === 0 ? 1 : 2;
  const rolePriority = image.contentRole === 'identity'
    ? 0
    : image.contentRole === 'detail' ? 1 : image.contentRole === 'context' ? 2 : 3;
  return skuPriority * 10 + rolePriority;
}

function normalizeReferenceEvidenceIds(evidenceIds: string[]): string[] {
  return [...new Set(evidenceIds.filter((evidenceId) => (
    evidenceId.length >= 1
    && evidenceId.length <= 500
    && evidenceId === evidenceId.trim()
  )))].sort();
}

function hasBoundEvidence(image: ImagePromptPlanImage): boolean {
  return normalizeReferenceEvidenceIds(image.evidenceIds).length > 0;
}

function referencesForSku(input: ImagePromptPlanInput, skuKey: string): ImagePromptPlanImage[] {
  return input.images
    .filter((image) => hasBoundEvidence(image)
      && (image.skuKeys.length === 0 || image.skuKeys.includes(skuKey)))
    .sort((left, right) => (
      imagePriority(left, skuKey) - imagePriority(right, skuKey)
      || compareAiMediaPlanningStrings(left.candidateId, right.candidateId)
    ));
}

function referencesForGroup(input: ImagePromptPlanInput, group: ImageCompatibilityGroup): ImagePromptPlanImage[] {
  const members = new Set(group.skuKeys);
  return input.images
    .filter((image) => hasBoundEvidence(image)
      && (image.skuKeys.length === 0 || image.skuKeys.every((skuKey) => members.has(skuKey))))
    .sort((left, right) => (
      imagePriority(left) - imagePriority(right)
      || compareAiMediaPlanningStrings(left.candidateId, right.candidateId)
    ));
}

function toReferences(images: ImagePromptPlanImage[]): ImagePromptPlanReference[] {
  return images.slice(0, AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES).map((image) => ({
    candidateId: image.candidateId,
    evidenceIds: normalizeReferenceEvidenceIds(image.evidenceIds),
  }));
}

function factsForSku(input: ImagePromptPlanInput, skuKey: string): ImagePromptPlanVerifiedFact[] {
  return input.verifiedFacts.filter((fact) => !fact.skuKeys?.length || fact.skuKeys.includes(skuKey));
}

function factsForGroup(
  input: ImagePromptPlanInput,
  group: ImageCompatibilityGroup,
): ImagePromptPlanVerifiedFact[] {
  const members = new Set(group.skuKeys);
  return input.verifiedFacts.filter((fact) => {
    if (!fact.skuKeys?.length) return true;
    return fact.skuKeys.length === members.size
      && fact.skuKeys.every((skuKey) => members.has(skuKey));
  });
}

function factEvidenceIds(facts: ImagePromptPlanVerifiedFact[]): string[] {
  return [...new Set(facts.flatMap((fact) => fact.evidenceIds))].sort();
}

function safetyConstraints(): string[] {
  return [
    'preserve_product_identity',
    'use_verified_facts_only',
    'do_not_invent_text_or_certifications',
    'do_not_change_bundle_or_packaging',
  ];
}

function acceptanceChecks(goal: string): string[] {
  return [
    'aspect_ratio_3_4',
    'product_matches_references',
    'no_unverified_claims',
    `goal_${goal}_is_visually_satisfied`,
  ];
}

function galleryGoals(input: ImagePromptPlanInput): string[] {
  const supplied = input.galleryGoals
    ?.map((goal) => normalized(goal).replace(/[^a-z0-9_-]+/g, '_'))
    .filter(Boolean);
  const goals = supplied?.length ? supplied : [...DEFAULT_GALLERY_GOALS];
  if (goals.length > 14) throw new Error('Image prompt plan supports at most 14 gallery goals');
  if (new Set(goals).size !== goals.length) throw new Error('Image prompt plan gallery goals must be unique');
  return goals;
}

function cloneSlot(slot: ImagePromptPlanSlot): ImagePromptPlanSlot {
  return {
    ...slot,
    ownership: { ...slot.ownership },
    references: slot.references.map((reference) => ({
      ...reference,
      evidenceIds: [...reference.evidenceIds],
    })),
    factEvidenceIds: [...slot.factEvidenceIds],
    safetyConstraints: [...slot.safetyConstraints],
    acceptanceChecks: [...slot.acceptanceChecks],
  };
}

export function createRuleBasedImagePromptPlan(input: ImagePromptPlanInput): ImagePromptPlan {
  ensureUniqueInputs(input);
  const normalizedInput: ImagePromptPlanInput = {
    ...input,
    verifiedFacts: normalizeVerifiedFacts(input),
  };
  const groups = compatibilityGroups(normalizedInput.skus);
  const slots: ImagePromptPlanSlot[] = [];
  for (const sku of [...normalizedInput.skus].sort((left, right) => (
    compareAiMediaPlanningStrings(left.skuKey, right.skuKey)
  ))) {
    slots.push({
      slotKey: `sku:${sku.skuKey}:hero`,
      goal: 'sku_hero',
      status: referencesForSku(normalizedInput, sku.skuKey).length > 0 ? 'READY' : 'MANUAL_REQUIRED',
      aspectRatio: '3:4',
      ownership: { level: 'sku', key: sku.skuKey },
      references: toReferences(referencesForSku(normalizedInput, sku.skuKey)),
      factEvidenceIds: factEvidenceIds(factsForSku(normalizedInput, sku.skuKey)),
      safetyConstraints: safetyConstraints(),
      acceptanceChecks: acceptanceChecks('sku_hero'),
    });
  }
  const goals = galleryGoals(normalizedInput);
  for (const group of groups) {
    const references = toReferences(referencesForGroup(normalizedInput, group));
    goals.forEach((goal, index) => {
      slots.push({
        slotKey: `group:${group.groupKey}:gallery:${index + 1}`,
        goal,
        status: references.length > 0 ? 'READY' : 'MANUAL_REQUIRED',
        aspectRatio: '3:4',
        ownership: { level: 'compatibility_group', key: group.groupKey },
        references: references.map((reference) => ({
          ...reference,
          evidenceIds: [...reference.evidenceIds],
        })),
        factEvidenceIds: factEvidenceIds(factsForGroup(normalizedInput, group)),
        safetyConstraints: safetyConstraints(),
        acceptanceChecks: acceptanceChecks(goal),
      });
    });
  }
  return {
    version: AI_IMAGE_PROMPT_PLAN_VERSION,
    mode: 'rule_based',
    compatibilityGroups: groups,
    slots,
    verifiedFacts: normalizedInput.verifiedFacts.map((fact) => ({
      ...fact,
      evidenceIds: [...fact.evidenceIds],
      ...(fact.skuKeys ? { skuKeys: [...fact.skuKeys] } : {}),
    })),
    manualSelectionAllowed: true,
    recoverable: true,
    diagnostics: [],
    fallbackReason: null,
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

function compatibleImagesForSlot(
  input: ImagePromptPlanInput,
  slot: ImagePromptPlanSlot,
  groups: ImageCompatibilityGroup[],
): ImagePromptPlanImage[] {
  if (slot.ownership.level === 'sku') return referencesForSku(input, slot.ownership.key);
  const group = groups.find((item) => item.groupKey === slot.ownership.key);
  return group ? referencesForGroup(input, group) : [];
}

export function normalizeAiImagePromptPlanOutput(
  input: ImagePromptPlanInput,
  modelOutput: unknown,
): ImagePromptPlan {
  const base = createRuleBasedImagePromptPlan(input);
  const parsed = parseModelOutput(modelOutput);
  if (!parsed) {
    return {
      ...base,
      mode: 'fallback',
      fallbackReason: 'INVALID_MODEL_OUTPUT',
      slots: base.slots.map(cloneSlot),
    };
  }

  const diagnostics: ImagePromptPlanDiagnostic[] = [];
  const slotById = new Map(base.slots.map((slot) => [slot.slotKey, slot]));
  const modelSlots = new Map<string, z.infer<typeof modelOutputSchema>['slots'][number]>();
  for (const modelSlot of parsed.slots) {
    if (!slotById.has(modelSlot.slotKey)) {
      diagnostics.push({ code: 'UNKNOWN_SLOT_ID', slotKey: modelSlot.slotKey });
      continue;
    }
    if (modelSlots.has(modelSlot.slotKey)) {
      diagnostics.push({ code: 'DUPLICATE_SLOT_ID', slotKey: modelSlot.slotKey });
      continue;
    }
    modelSlots.set(modelSlot.slotKey, modelSlot);
  }

  const allCandidateIds = new Set(input.images.map((image) => image.candidateId));
  const imageById = new Map(input.images.map((image) => [image.candidateId, image]));
  const slots = base.slots.map((slot) => {
    const modelSlot = modelSlots.get(slot.slotKey);
    if (!modelSlot) return cloneSlot(slot);
    const compatibleIds = new Set(compatibleImagesForSlot(input, slot, base.compatibilityGroups)
      .map((image) => image.candidateId));
    const seen = new Set<string>();
    const accepted: ImagePromptPlanImage[] = [];
    for (const candidateId of modelSlot.referenceCandidateIds) {
      if (seen.has(candidateId)) continue;
      seen.add(candidateId);
      if (!allCandidateIds.has(candidateId)) {
        diagnostics.push({ code: 'UNKNOWN_REFERENCE_ID', slotKey: slot.slotKey, candidateId });
        continue;
      }
      if (!compatibleIds.has(candidateId)) {
        diagnostics.push({ code: 'INCOMPATIBLE_REFERENCE_ID', slotKey: slot.slotKey, candidateId });
        continue;
      }
      const image = imageById.get(candidateId);
      if (image) accepted.push(image);
    }
    const result = cloneSlot(slot);
    if (accepted.length > 0) result.references = toReferences(accepted);
    return result;
  });

  return {
    ...base,
    mode: 'model',
    slots,
    diagnostics,
  };
}
