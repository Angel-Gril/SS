import { createHash } from 'node:crypto';

export class LogisticsRuleReleaseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'LogisticsRuleReleaseError';
  }
}

type JsonObject = Record<string, unknown>;

interface ScopeExpectation {
  tenantId: string;
  shopId: string;
  warehouseId: string;
}

interface DeliveryMethodBinding extends ScopeExpectation {
  id: string;
  deliveryMethodId: string;
  stableServiceKey: string;
  sourceRevisionId: string;
  status: string;
  confirmedById: string | null;
  confirmedAt: Date | null;
  retiredAt: Date | null;
}

interface CompanyBinding {
  tenantId: string;
  shopId: string;
  ozonCompanyId: string;
  status: string;
  openApiVerifiedAt: Date | null;
  sellerProbeVerifiedAt: Date | null;
  openApiIntersectionVerifiedAt: Date | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  invalidatedAt: Date | null;
  retiredAt: Date | null;
}

interface OriginBinding extends ScopeExpectation {
  originCountryUid: string;
  originCityUid: string;
  originCountryCode?: string | null;
  status: string;
  openApiAddressVerifiedAt: Date | null;
  officialLocationVerifiedAt: Date | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  invalidatedAt: Date | null;
  retiredAt: Date | null;
}

interface ChannelScope extends ScopeExpectation {
  ozonCompanyId: string;
  originCountryUid: string;
  originCityUid: string;
  originCountryCode?: string | null;
}

interface OfficialFormulaResolution extends ScopeExpectation {
  id: string;
  officialFingerprint: string;
  sellerSourceRevisionId: string;
  candidateSetChecksum: string;
  candidateServiceKeys: unknown;
  selectedServiceKey: string | null;
  status: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  evidence: unknown;
  invalidatedAt: Date | null;
}

interface OfficialResolutionExpectation extends ScopeExpectation {
  requirementKey: string;
  officialFingerprint: string;
  sellerSourceRevisionId: string;
  candidateSetChecksum: string;
}

export function assertEffectiveDeliveryMethodBinding<T extends DeliveryMethodBinding>(
  binding: T,
  expected: ScopeExpectation & { sourceRevisionId: string },
): T {
  if (
    binding.tenantId !== expected.tenantId ||
    binding.shopId !== expected.shopId ||
    binding.warehouseId !== expected.warehouseId
  ) {
    throw new LogisticsRuleReleaseError(
      'METHOD_BINDING_SCOPE_MISMATCH',
      'Delivery-method binding does not belong to the release scope',
    );
  }
  if (binding.sourceRevisionId !== expected.sourceRevisionId) {
    throw new LogisticsRuleReleaseError(
      'STALE_METHOD_BINDING',
      'Delivery-method binding was reviewed against another formula revision',
    );
  }
  if (
    binding.status !== 'CONFIRMED' ||
    !binding.confirmedById ||
    !binding.confirmedAt ||
    binding.retiredAt
  ) {
    throw new LogisticsRuleReleaseError(
      'UNCONFIRMED_METHOD_BINDING',
      'Actual delivery method must be explicitly confirmed',
    );
  }
  return binding;
}

export function assertVerifiedScopeBindings<
  TCompany extends CompanyBinding,
  TOrigin extends OriginBinding,
>(
  channel: ChannelScope,
  companyBinding: TCompany | null | undefined,
  originBinding: TOrigin | null | undefined,
): { companyBinding: TCompany; originBinding: TOrigin } {
  if (
    !companyBinding ||
    companyBinding.status !== 'VERIFIED' ||
    companyBinding.invalidatedAt ||
    companyBinding.retiredAt ||
    !companyBinding.openApiVerifiedAt ||
    !companyBinding.sellerProbeVerifiedAt ||
    !companyBinding.openApiIntersectionVerifiedAt ||
    !companyBinding.verifiedById ||
    !companyBinding.verifiedAt
  ) {
    throw new LogisticsRuleReleaseError(
      'UNVERIFIED_COMPANY_BINDING',
      'Shop/company binding lacks independent OpenAPI and Seller-probe verification',
    );
  }
  if (
    companyBinding.tenantId !== channel.tenantId ||
    companyBinding.shopId !== channel.shopId ||
    companyBinding.ozonCompanyId !== channel.ozonCompanyId
  ) {
    throw new LogisticsRuleReleaseError(
      'COMPANY_BINDING_SCOPE_MISMATCH',
      'Shop/company binding does not match the release channel',
    );
  }
  if (
    !originBinding ||
    originBinding.status !== 'VERIFIED' ||
    originBinding.invalidatedAt ||
    originBinding.retiredAt ||
    !originBinding.openApiAddressVerifiedAt ||
    !originBinding.officialLocationVerifiedAt ||
    !originBinding.verifiedById ||
    !originBinding.verifiedAt
  ) {
    throw new LogisticsRuleReleaseError(
      'UNVERIFIED_ORIGIN_BINDING',
      'Warehouse origin lacks OpenAPI address and Official location verification',
    );
  }
  if (
    originBinding.tenantId !== channel.tenantId ||
    originBinding.shopId !== channel.shopId ||
    originBinding.warehouseId !== channel.warehouseId ||
    originBinding.originCountryUid !== channel.originCountryUid ||
    originBinding.originCityUid !== channel.originCityUid
  ) {
    throw new LogisticsRuleReleaseError(
      'ORIGIN_BINDING_SCOPE_MISMATCH',
      'Warehouse origin binding does not match the release channel',
    );
  }
  return { companyBinding, originBinding };
}

function officialResolutionRequirementKey(
  resolution: Pick<OfficialFormulaResolution, 'evidence'>,
): string {
  const evidence =
    resolution.evidence && typeof resolution.evidence === 'object' && !Array.isArray(resolution.evidence)
      ? (resolution.evidence as JsonObject)
      : null;
  const requirementKey =
    typeof evidence?.requirementKey === 'string' ? evidence.requirementKey.trim() : '';
  if (!requirementKey) {
    throw new LogisticsRuleReleaseError(
      'STALE_OFFICIAL_RESOLUTION',
      'Official formula resolution has no immutable requirement identity',
    );
  }
  return requirementKey;
}

export function assertEffectiveOfficialFormulaResolution<T extends OfficialFormulaResolution>(
  resolution: T,
  expected: OfficialResolutionExpectation,
): T {
  if (
    resolution.tenantId !== expected.tenantId ||
    resolution.shopId !== expected.shopId ||
    resolution.warehouseId !== expected.warehouseId
  ) {
    throw new LogisticsRuleReleaseError(
      'OFFICIAL_RESOLUTION_SCOPE_MISMATCH',
      'Official formula resolution does not belong to the release scope',
    );
  }
  if (
    resolution.officialFingerprint !== expected.officialFingerprint ||
    resolution.sellerSourceRevisionId !== expected.sellerSourceRevisionId ||
    officialResolutionRequirementKey(resolution) !== expected.requirementKey ||
    resolution.candidateSetChecksum !== expected.candidateSetChecksum
  ) {
    throw new LogisticsRuleReleaseError(
      'STALE_OFFICIAL_RESOLUTION',
      'Official formula resolution no longer matches its source evidence',
    );
  }
  const candidates = Array.isArray(resolution.candidateServiceKeys)
    ? resolution.candidateServiceKeys
    : [];
  if (
    resolution.status !== 'CONFIRMED' ||
    resolution.invalidatedAt ||
    !resolution.selectedServiceKey ||
    !candidates.includes(resolution.selectedServiceKey) ||
    !resolution.reviewedById ||
    !resolution.reviewedAt ||
    !resolution.evidence
  ) {
    throw new LogisticsRuleReleaseError(
      'UNCONFIRMED_OFFICIAL_RESOLUTION',
      'Ambiguous Official formula match requires an evidence-backed review',
    );
  }
  return resolution;
}

export interface LogisticsReleaseManifest {
  schemaVersion: string;
  minimumExtensionVersion: string;
  destination: {
    destinationCountryUid: string;
    destinationLocationUid: string;
    destinationLabel: string;
    destinationCountryCode?: string;
  };
  selectedServiceKeys: string[];
  defaultServiceKeys: string[];
  deliveryMethodBindingIds: string[];
  officialResolutions: Array<{ id: string } & OfficialResolutionExpectation>;
  routeClassifications: unknown;
  validationReport: unknown;
  revisionId: string;
}

export interface PublishLogisticsRuleRevisionInput {
  channelId: string;
  revisionId: string;
  expectedSequence: number;
  actorUserId: string;
  deploymentId?: string;
  schemaMajor?: number;
  manifest: LogisticsReleaseManifest;
  reason?: string;
  now?: Date;
}

export interface RollbackLogisticsRuleReleaseInput {
  channelId: string;
  targetReleaseId: string;
  expectedSequence: number;
  actorUserId: string;
  deploymentId?: string;
  schemaMajor?: number;
  reason?: string;
  now?: Date;
}

interface TransactionClient {
  logisticsRuleChannel: {
    findUnique(args: unknown): Promise<any>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  logisticsRuleRevision: { findUnique(args: unknown): Promise<any> };
  logisticsRuleRelease: {
    findUnique(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
  };
  logisticsRuleAssignment: { findFirst(args: unknown): Promise<any> };
  shopDeliveryMethodRuleBinding: { findMany(args: unknown): Promise<any[]> };
  officialSellerFormulaResolution: { findMany(args: unknown): Promise<any[]> };
  logisticsRuleEvent: { create(args: unknown): Promise<any> };
}

export interface LogisticsRuleReleaseDatabase {
  $transaction<T>(
    callback: (tx: TransactionClient) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ): Promise<T>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value instanceof Date ? value.toISOString() : value;
}

function checksum(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function assertConfidentiality(channel: any, revision: any): void {
  if (revision.sourceOwnerType === 'TENANT') {
    if (
      revision.confidentiality !== 'TENANT_PRIVATE' ||
      channel.channelType !== 'TENANT' ||
      !channel.tenantId ||
      revision.sourceTenantId !== channel.tenantId
    ) {
      throw new LogisticsRuleReleaseError(
        'CONFIDENTIALITY_VIOLATION',
        'Tenant-owned logistics content cannot enter a public or cross-tenant channel',
        403,
      );
    }
    return;
  }
  if (
    revision.sourceOwnerType !== 'PUBLIC' ||
    revision.confidentiality !== 'PUBLIC' ||
    channel.channelType !== 'PUBLIC'
  ) {
    throw new LogisticsRuleReleaseError(
      'CONFIDENTIALITY_VIOLATION',
      'Revision ownership and channel confidentiality are incompatible',
      403,
    );
  }
}

function assertCurrentValidation(
  status: string,
  validatedAt: Date | null,
  validUntil: Date | null,
  now: Date,
): void {
  if (status !== 'PASSED' || !validatedAt || !validUntil) {
    throw new LogisticsRuleReleaseError(
      'VALIDATION_REQUIRED',
      'A passed and timestamped validation report is required',
    );
  }
  if (validUntil.getTime() < now.getTime()) {
    throw new LogisticsRuleReleaseError(
      'VALIDATION_EXPIRED',
      'The release validation window has expired',
    );
  }
}

function assertChannelSequence(channel: any, expectedSequence: number): void {
  if (channel.currentSequence !== expectedSequence) {
    throw new LogisticsRuleReleaseError(
      'RELEASE_CONFLICT',
      'The logistics channel advanced since it was reviewed',
      409,
    );
  }
  if (channel.retiredAt)
    throw new LogisticsRuleReleaseError(
      'CHANNEL_RETIRED',
      'A retired logistics channel cannot publish',
    );
}

function assertChannelEnvironment(
  channel: any,
  expected: { deploymentId?: string; schemaMajor?: number },
): void {
  const hasExplicitIdentity =
    typeof channel.deploymentId === 'string' &&
    channel.deploymentId.trim().length > 0 &&
    Number.isInteger(channel.schemaMajor) &&
    channel.schemaMajor > 0;
  const matchesExpected =
    (!expected.deploymentId || channel.deploymentId === expected.deploymentId) &&
    (expected.schemaMajor === undefined || channel.schemaMajor === expected.schemaMajor);
  if (!hasExplicitIdentity || !matchesExpected) {
    throw new LogisticsRuleReleaseError(
      'CHANNEL_NOT_FOUND',
      'Logistics rule channel not found',
      404,
    );
  }
}

function channelScope(channel: any): ChannelScope {
  if (
    !channel.tenantId ||
    !channel.shopId ||
    !channel.warehouseId ||
    !channel.ozonCompanyId ||
    !channel.originCountryUid ||
    !channel.originCityUid
  ) {
    throw new LogisticsRuleReleaseError(
      'UNSCOPED_CHANNEL',
      'Tenant logistics channel requires explicit shop, warehouse, company and origin scope',
    );
  }
  return {
    tenantId: channel.tenantId,
    shopId: channel.shopId,
    warehouseId: channel.warehouseId,
    ozonCompanyId: channel.ozonCompanyId,
    originCountryUid: channel.originCountryUid,
    originCityUid: channel.originCityUid,
    originCountryCode: channel.originCountryCode,
  };
}

async function loadCurrentPreflight(
  tx: TransactionClient,
  channel: any,
  revision: any,
  manifest: LogisticsReleaseManifest,
): Promise<{
  assignment: any;
  bindings: DeliveryMethodBinding[];
  resolutions: OfficialFormulaResolution[];
}> {
  const scope = channelScope(channel);
  assertVerifiedScopeBindings(scope, channel.companyBinding, channel.originBinding);
  const assignment = await tx.logisticsRuleAssignment.findFirst({
    where: {
      channelId: channel.id,
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      warehouseId: scope.warehouseId,
      destinationCountryUid: manifest.destination.destinationCountryUid,
      destinationLocationUid: manifest.destination.destinationLocationUid,
      retiredAt: null,
    },
  });
  if (!assignment || assignment.destinationLabel !== manifest.destination.destinationLabel) {
    throw new LogisticsRuleReleaseError(
      'DESTINATION_ASSIGNMENT_REQUIRED',
      'Release destination must match an active reviewed assignment',
    );
  }

  const bindingIds = [...new Set(manifest.deliveryMethodBindingIds)];
  const bindings = (await tx.shopDeliveryMethodRuleBinding.findMany({
    where: { id: { in: bindingIds } },
  })) as DeliveryMethodBinding[];
  if (bindings.length !== bindingIds.length) {
    throw new LogisticsRuleReleaseError(
      'METHOD_BINDING_REQUIRED',
      'A referenced delivery-method binding is missing',
    );
  }
  for (const binding of bindings) {
    assertEffectiveDeliveryMethodBinding(binding, { ...scope, sourceRevisionId: revision.id });
  }
  const boundServices = new Set(bindings.map((binding) => binding.stableServiceKey));
  if (manifest.selectedServiceKeys.some((serviceKey) => !boundServices.has(serviceKey))) {
    throw new LogisticsRuleReleaseError(
      'METHOD_BINDING_REQUIRED',
      'Every selected service must have a confirmed actual-method binding',
    );
  }

  if (
    manifest.officialResolutions.some(
      (resolution) => resolution.sellerSourceRevisionId !== revision.id,
    )
  ) {
    throw new LogisticsRuleReleaseError(
      'STALE_OFFICIAL_RESOLUTION',
      'Official formula resolution must be reviewed against the published Seller revision',
    );
  }
  const resolutionIds = manifest.officialResolutions.map((resolution) => resolution.id);
  const resolutions = resolutionIds.length
    ? ((await tx.officialSellerFormulaResolution.findMany({
        where: { id: { in: resolutionIds } },
      })) as OfficialFormulaResolution[])
    : [];
  if (resolutions.length !== resolutionIds.length) {
    throw new LogisticsRuleReleaseError(
      'OFFICIAL_RESOLUTION_REQUIRED',
      'A referenced Official formula resolution is missing',
    );
  }
  const expectedById = new Map(
    manifest.officialResolutions.map((resolution) => [resolution.id, resolution]),
  );
  for (const resolution of resolutions) {
    if (resolution.sellerSourceRevisionId !== revision.id) {
      throw new LogisticsRuleReleaseError(
        'STALE_OFFICIAL_RESOLUTION',
        'Persisted Official formula resolution no longer matches the published Seller revision',
      );
    }
    assertEffectiveOfficialFormulaResolution(resolution, expectedById.get(resolution.id)!);
  }
  return { assignment, bindings, resolutions };
}

function scopeSnapshot(
  channel: any,
  destination: LogisticsReleaseManifest['destination'],
): JsonObject {
  return {
    channelId: channel.id,
    scopeKey: channel.scopeKey,
    deploymentId: channel.deploymentId,
    schemaMajor: channel.schemaMajor,
    tenantId: channel.tenantId,
    shopId: channel.shopId,
    warehouseId: channel.warehouseId,
    ozonCompanyId: channel.ozonCompanyId,
    originCountryUid: channel.originCountryUid,
    originCityUid: channel.originCityUid,
    originCountryCode: channel.originCountryCode,
    destinationCountryUid: destination.destinationCountryUid,
    destinationLocationUid: destination.destinationLocationUid,
    destinationLabel: destination.destinationLabel,
    destinationCountryCode: destination.destinationCountryCode || null,
  };
}

function assertRollbackTargetIntegrity(
  channel: any,
  target: any,
  revision: any,
  manifest: LogisticsReleaseManifest,
): void {
  const frozenPayload = target.frozenPayload;
  const valid =
    target.revisionId === revision.id &&
    target.contentChecksum === revision.contentChecksum &&
    manifest.revisionId === revision.id &&
    frozenPayload &&
    checksum(frozenPayload.revisionPayload) === checksum(revision.payload) &&
    checksum(frozenPayload.scope) === checksum(scopeSnapshot(channel, manifest.destination));
  if (!valid) {
    throw new LogisticsRuleReleaseError(
      'ROLLBACK_TARGET_INTEGRITY',
      'Rollback target no longer matches its immutable scope, content, or revision snapshot',
    );
  }
}

function snapshotBinding(binding: DeliveryMethodBinding): JsonObject {
  return {
    id: binding.id,
    deliveryMethodId: binding.deliveryMethodId,
    stableServiceKey: binding.stableServiceKey,
    sourceRevisionId: binding.sourceRevisionId,
    confirmedById: binding.confirmedById,
    confirmedAt: binding.confirmedAt,
  };
}

function snapshotResolution(resolution: OfficialFormulaResolution): JsonObject {
  return {
    id: resolution.id,
    officialFingerprint: resolution.officialFingerprint,
    sellerSourceRevisionId: resolution.sellerSourceRevisionId,
    requirementKey: officialResolutionRequirementKey(resolution),
    candidateSetChecksum: resolution.candidateSetChecksum,
    selectedServiceKey: resolution.selectedServiceKey,
    reviewedById: resolution.reviewedById,
    reviewedAt: resolution.reviewedAt,
  };
}

async function createTransition(
  tx: TransactionClient,
  args: {
    channel: any;
    revision: any;
    expectedSequence: number;
    actorUserId: string;
    reason?: string;
    frozenPayload: any;
    validatedAt: Date;
    validationValidUntil: Date;
    type: 'PUBLISHED' | 'ROLLED_BACK';
    rollbackTargetReleaseId?: string;
    now: Date;
  },
): Promise<any> {
  const sequence = args.expectedSequence + 1;
  const effectiveChecksum = checksum({
    sequence,
    channelId: args.channel.id,
    scopeKey: args.channel.scopeKey,
    contentChecksum: args.revision.contentChecksum,
    frozenPayload: args.frozenPayload,
  });
  const release = await tx.logisticsRuleRelease.create({
    data: {
      channelId: args.channel.id,
      sequence,
      revisionId: args.revision.id,
      releaseKind: args.type === 'ROLLED_BACK' ? 'ROLLBACK' : 'PUBLISH',
      rollbackTargetReleaseId: args.rollbackTargetReleaseId || null,
      contentChecksum: args.revision.contentChecksum,
      effectiveChecksum,
      frozenPayload: args.frozenPayload,
      validatedAt: args.validatedAt,
      validationValidUntil: args.validationValidUntil,
      publishedById: args.actorUserId,
      publishedAt: args.now,
    },
  });

  await tx.logisticsRuleEvent.create({
    data: {
      channelId: args.channel.id,
      releaseId: release.id,
      subjectType: 'RELEASE',
      subjectId: release.id,
      tenantId: args.channel.tenantId || null,
      actorUserId: args.actorUserId,
      type: args.type,
      scopeSnapshot: scopeSnapshot(args.channel, args.frozenPayload.manifest.destination),
      facts: {
        sequence,
        revisionId: args.revision.id,
        contentChecksum: args.revision.contentChecksum,
        effectiveChecksum,
        rollbackTargetReleaseId: args.rollbackTargetReleaseId || null,
        reason:
          args.reason?.trim() ||
          (args.type === 'PUBLISHED'
            ? 'Published by internal logistics workflow'
            : 'Rolled back by internal logistics workflow'),
      },
      createdAt: args.now,
    },
  });

  const moved = await tx.logisticsRuleChannel.updateMany({
    where: {
      id: args.channel.id,
      deploymentId: args.channel.deploymentId,
      schemaMajor: args.channel.schemaMajor,
      currentSequence: args.expectedSequence,
      retiredAt: null,
    },
    data: { currentSequence: sequence, currentReleaseId: release.id },
  });
  if (moved.count !== 1) {
    throw new LogisticsRuleReleaseError(
      'RELEASE_CONFLICT',
      'The logistics channel advanced during publication',
      409,
    );
  }
  return release;
}

function isRetryableConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2034' || code === 'P2002';
}

async function serializable<T>(
  database: LogisticsRuleReleaseDatabase,
  operation: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isRetryableConflict(error)) throw error;
      if (attempt === 1) {
        throw new LogisticsRuleReleaseError(
          'RELEASE_CONFLICT',
          'Concurrent logistics publication could not be serialized',
          409,
        );
      }
    }
  }
  throw new LogisticsRuleReleaseError(
    'RELEASE_CONFLICT',
    'Concurrent logistics publication could not be serialized',
    409,
  );
}

async function loadPublicationPreflight(
  tx: TransactionClient,
  input: PublishLogisticsRuleRevisionInput,
  now: Date,
): Promise<{
  channel: any;
  revision: any;
  preflight: {
    assignment: any;
    bindings: DeliveryMethodBinding[];
    resolutions: OfficialFormulaResolution[];
  };
}> {
  const channel = await tx.logisticsRuleChannel.findUnique({
    where: { id: input.channelId },
    include: { companyBinding: true, originBinding: true },
  });
  if (!channel)
    throw new LogisticsRuleReleaseError(
      'CHANNEL_NOT_FOUND',
      'Logistics rule channel not found',
      404,
    );
  assertChannelEnvironment(channel, input);
  assertChannelSequence(channel, input.expectedSequence);

  const revision = await tx.logisticsRuleRevision.findUnique({ where: { id: input.revisionId } });
  if (!revision)
    throw new LogisticsRuleReleaseError(
      'REVISION_NOT_FOUND',
      'Logistics rule revision not found',
      404,
    );
  if (input.manifest.revisionId !== revision.id) {
    throw new LogisticsRuleReleaseError(
      'REVISION_MISMATCH',
      'Release manifest references another formula revision',
    );
  }
  assertConfidentiality(channel, revision);
  assertCurrentValidation(
    revision.validationStatus,
    revision.validatedAt,
    revision.validationValidUntil,
    now,
  );
  const preflight = await loadCurrentPreflight(tx, channel, revision, input.manifest);
  return { channel, revision, preflight };
}

export interface LogisticsRulePublicationPreflight {
  channelId: string;
  revisionId: string;
  currentSequence: number;
  assignmentId: string;
  deliveryMethodBindingIds: string[];
  officialResolutionIds: string[];
}

export function preflightLogisticsRuleRevision(
  database: LogisticsRuleReleaseDatabase,
  input: PublishLogisticsRuleRevisionInput,
): Promise<LogisticsRulePublicationPreflight> {
  const now = input.now || new Date();
  return serializable(database, async (tx) => {
    const { channel, revision, preflight } = await loadPublicationPreflight(tx, input, now);
    return {
      channelId: channel.id,
      revisionId: revision.id,
      currentSequence: channel.currentSequence,
      assignmentId: preflight.assignment.id,
      deliveryMethodBindingIds: preflight.bindings.map((binding) => binding.id),
      officialResolutionIds: preflight.resolutions.map((resolution) => resolution.id),
    };
  });
}

export function publishLogisticsRuleRevision(
  database: LogisticsRuleReleaseDatabase,
  input: PublishLogisticsRuleRevisionInput,
): Promise<any> {
  const now = input.now || new Date();
  return serializable(database, async (tx) => {
    const { channel, revision, preflight } = await loadPublicationPreflight(tx, input, now);
    const frozenPayload = {
      scope: scopeSnapshot(channel, input.manifest.destination),
      revisionPayload: revision.payload,
      manifest: input.manifest,
      assignment: {
        id: preflight.assignment.id,
        destinationCountryUid: preflight.assignment.destinationCountryUid,
        destinationCountryCode: preflight.assignment.destinationCountryCode,
        destinationLocationUid: preflight.assignment.destinationLocationUid,
        destinationLabel: preflight.assignment.destinationLabel,
      },
      deliveryMethodBindings: preflight.bindings.map(snapshotBinding),
      officialResolutions: preflight.resolutions.map(snapshotResolution),
    };
    return createTransition(tx, {
      channel,
      revision,
      expectedSequence: input.expectedSequence,
      actorUserId: input.actorUserId,
      reason: input.reason,
      frozenPayload,
      validatedAt: revision.validatedAt,
      validationValidUntil: revision.validationValidUntil,
      type: 'PUBLISHED',
      now,
    });
  });
}

export function rollbackLogisticsRuleRelease(
  database: LogisticsRuleReleaseDatabase,
  input: RollbackLogisticsRuleReleaseInput,
): Promise<any> {
  const now = input.now || new Date();
  return serializable(database, async (tx) => {
    const channel = await tx.logisticsRuleChannel.findUnique({
      where: { id: input.channelId },
      include: { companyBinding: true, originBinding: true },
    });
    if (!channel)
      throw new LogisticsRuleReleaseError(
        'CHANNEL_NOT_FOUND',
        'Logistics rule channel not found',
        404,
      );
    assertChannelEnvironment(channel, input);
    assertChannelSequence(channel, input.expectedSequence);

    const target = await tx.logisticsRuleRelease.findUnique({
      where: { id: input.targetReleaseId },
    });
    if (!target || target.channelId !== channel.id) {
      throw new LogisticsRuleReleaseError(
        'ROLLBACK_TARGET_NOT_FOUND',
        'Rollback target does not belong to this channel',
        404,
      );
    }
    assertCurrentValidation('PASSED', target.validatedAt, target.validationValidUntil, now);
    const revision = await tx.logisticsRuleRevision.findUnique({
      where: { id: target.revisionId },
    });
    if (!revision)
      throw new LogisticsRuleReleaseError(
        'REVISION_NOT_FOUND',
        'Rollback revision is unavailable',
        404,
      );
    assertConfidentiality(channel, revision);
    const manifest = target.frozenPayload?.manifest as LogisticsReleaseManifest | undefined;
    if (!manifest)
      throw new LogisticsRuleReleaseError(
        'INVALID_RELEASE_PAYLOAD',
        'Rollback target has no frozen release manifest',
      );
    assertRollbackTargetIntegrity(channel, target, revision, manifest);
    await loadCurrentPreflight(tx, channel, revision, manifest);
    return createTransition(tx, {
      channel,
      revision,
      expectedSequence: input.expectedSequence,
      actorUserId: input.actorUserId,
      reason: input.reason,
      frozenPayload: target.frozenPayload,
      validatedAt: target.validatedAt,
      validationValidUntil: target.validationValidUntil,
      type: 'ROLLED_BACK',
      rollbackTargetReleaseId: target.id,
      now,
    });
  });
}
