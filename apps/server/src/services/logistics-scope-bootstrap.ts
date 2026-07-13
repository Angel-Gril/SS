import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createOzonGlobalCalculatorLocationClient } from './ozon-global-calculator-locations.js';

const PROBE_TTL_MS = 5 * 60 * 1000;
const PILOT_SCHEMA_MAJOR = 1;
const STATIC_PILOT_CATALOG_VERSION = 'reviewed-static-pilot-v1';
const STATIC_PILOT = {
  officialLocation: {
    countryUid: '13a6e0b2-f138-597d-a3ff-071876394e41',
    countryLabel: 'China',
    cityUid: 'e166f0f3-c160-564f-b04f-15a6cd04cd15',
    cityLabel: 'Xiamen',
    countryCode: 'CN',
  },
  destination: {
    countryUid: '42fb1c32-0cfe-5c96-9fb5-7f8e8449f28c',
    countryLabel: 'Russia',
    locationUid: '0c5b2444-70a0-4932-980c-b4dc0d3f02b5',
    locationLabel: 'Moscow',
    countryCode: 'RU',
  },
} as const;

export type LogisticsScopeBootstrapStatus = 'CANDIDATE' | 'ACTIVATED';
export type LogisticsCompanyProbeStatus =
  | 'ISSUED'
  | 'CLAIMED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'EXPIRED';

export interface LogisticsScopeDeviceContext {
  sessionId: string;
  ownerUserId: string;
  allowedShopIds: string[];
}

export interface LogisticsOpenApiScope {
  tenantId: string;
  shopId: string;
  warehouseId: string;
  deliveryMethodId: string;
  shopPlatform: string;
  shopStatus: string;
  openApiClientId: string | null;
  platformWarehouseId: string;
  warehouseName: string;
  warehouseStatus: string | null;
  warehouseRawData: Record<string, unknown>;
  warehouseSyncedAt: Date;
  warehouseAddress: {
    countryCode: string | null;
    city: string | null;
    street?: string | null;
    zipCode?: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  platformMethodId: number;
  deliveryMethodName: string;
  deliveryMethodStatus: string | null;
  providerId: number | null;
}

export interface LogisticsScopeBootstrapCandidate {
  id: string;
  tenantId: string;
  shopId: string;
  warehouseId: string;
  deliveryMethodId: string;
  status: LogisticsScopeBootstrapStatus;
  evidenceChecksum: string;
  openApiEvidence: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface LogisticsCompanyProbeRow {
  id: string;
  bootstrapId: string;
  status: LogisticsCompanyProbeStatus;
  nonceDigest: string;
  issuedEvidenceChecksum: string;
  tenantId: string;
  shopId: string;
  warehouseId: string;
  deliveryMethodId: string;
  platformWarehouseId: string;
  platformMethodId: number;
  claimedBySessionId: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

export interface LogisticsCompanyProbeEvidence {
  companyId: string;
  warehouse: { platformWarehouseId: string };
  deliveryMethod: { platformMethodId: number };
}

export interface LogisticsScopeBootstrapRepository {
  listWorkspace(input: {
    tenantId?: string;
    shopId?: string;
    warehouseId?: string;
    bootstrapId?: string;
    deploymentId: string;
    schemaMajor: number;
  }): Promise<unknown>;
  getCompanyProbe(input: { probeId: string }): Promise<unknown>;
  loadOpenApiScope(input: {
    tenantId: string;
    shopId: string;
    warehouseId: string;
    deliveryMethodId: string;
  }): Promise<LogisticsOpenApiScope | null>;
  upsertBootstrapCandidate(input: {
    id: string;
    actorUserId: string;
    tenantId: string;
    shopId: string;
    warehouseId: string;
    deliveryMethodId: string;
    status: 'CANDIDATE';
    evidenceChecksum: string;
    openApiEvidence: Record<string, unknown>;
    now: Date;
  }): Promise<LogisticsScopeBootstrapCandidate>;
  createCompanyProbe(input: {
    id: string;
    actorUserId: string;
    bootstrapId: string;
    status: 'ISSUED';
    nonceDigest: string;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<LogisticsCompanyProbeRow>;
  listPendingCompanyProbes(input: {
    device: LogisticsScopeDeviceContext;
    now: Date;
  }): Promise<LogisticsCompanyProbeRow[]>;
  claimCompanyProbe(input: {
    probeId: string;
    nonceDigest: string;
    device: LogisticsScopeDeviceContext;
    now: Date;
  }): Promise<{ state: 'claimed' | 'duplicate' | 'not_found' | 'expired' | 'replayed' }>;
  submitCompanyProbe(input: {
    probeId: string;
    nonceDigest: string;
    evidence: LogisticsCompanyProbeEvidence;
    device: LogisticsScopeDeviceContext;
    now: Date;
  }): Promise<{
    state: 'submitted' | 'duplicate' | 'not_found' | 'expired' | 'replayed' | 'mismatch';
    duplicate: boolean;
  }>;
  reviewCompanyProbe(input: {
    probeId: string;
    actorUserId: string;
    decision: 'CONFIRMED' | 'REJECTED';
    reason: string;
    now: Date;
  }): Promise<{
    probeId: string;
    status: 'CONFIRMED' | 'REJECTED';
    companyBindingId?: string;
    companyBindingStatus?: 'VERIFIED';
  }>;
  activateOriginScope(input: {
    actorUserId: string;
    bootstrapId: string;
    companyBindingId: string;
    deploymentId: string;
    schemaMajor: number;
    reason: string;
    officialLocation: {
      countryUid: string;
      countryLabel: string;
      cityUid: string;
      cityLabel: string;
      countryCode: string;
    };
    destination: {
      countryUid: string;
      countryLabel: string;
      locationUid: string;
      locationLabel: string;
      countryCode: string;
    };
    officialEvidence: Record<string, unknown>;
    now: Date;
  }): Promise<{
    bootstrapId: string;
    originBindingId: string;
    channelId: string;
    assignmentId: string;
    duplicate: boolean;
  }>;
}

export class LogisticsScopeBootstrapError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'LogisticsScopeBootstrapError';
  }
}

interface LocationDirectoryResult<T> {
  catalogVersion: string;
  fetchedAt?: string;
  records: T[];
}

interface LogisticsLocationDirectory {
  listCountries(): Promise<LocationDirectoryResult<{ uid: string; name: string }>>;
  listCities(countryUid: string): Promise<LocationDirectoryResult<{ uid: string; name: string }>>;
  listDestinations(): Promise<
    LocationDirectoryResult<{
      countryUid: string;
      countryName: string;
      locationUid: string;
      locationName: string;
    }>
  >;
}

interface CreateLogisticsScopeBootstrapServiceOptions {
  repository: LogisticsScopeBootstrapRepository;
  deploymentId: string;
  tokenSecret: string;
  now?: () => Date;
  id?: () => string;
  locationDirectory?: LogisticsLocationDirectory;
  allowStaticPilotLocationFallback?: boolean;
}

function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validIdentifier(value: unknown): value is string {
  const normalized = requiredText(value);
  return normalized.length > 0 && normalized.length <= 300;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface FrozenOpenApiAddressEvidence {
  rawData: {
    address_info: {
      address: string;
      latitude: number;
      longitude: number;
      utc?: string;
    };
  };
  checksum: string;
  syncedAt: string;
}

function canonicalAddressInfo(rawData: unknown) {
  const raw = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};
  const value =
    raw.address_info && typeof raw.address_info === 'object'
      ? (raw.address_info as Record<string, unknown>)
      : {};
  const address = String(value.address || '').trim();
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const utc = String(value.utc || '').trim();
  return {
    address,
    latitude,
    longitude,
    ...(utc ? { utc } : {}),
  };
}

export function freezeOpenApiAddressEvidence(
  rawData: unknown,
  syncedAt: Date | string,
): FrozenOpenApiAddressEvidence | null {
  const addressInfo = canonicalAddressInfo(rawData);
  const parsedSyncedAt = new Date(syncedAt);
  if (!addressInfo || Number.isNaN(parsedSyncedAt.getTime())) return null;
  return {
    rawData: { address_info: addressInfo },
    checksum: sha256(JSON.stringify(addressInfo)),
    syncedAt: parsedSyncedAt.toISOString(),
  };
}

export function matchesFrozenOpenApiAddressEvidence(
  frozen: unknown,
  currentRawData: unknown,
  currentSyncedAt: Date | string,
): frozen is FrozenOpenApiAddressEvidence {
  const item =
    frozen && typeof frozen === 'object' ? (frozen as Partial<FrozenOpenApiAddressEvidence>) : {};
  const frozenSnapshot = freezeOpenApiAddressEvidence(item.rawData, String(item.syncedAt || ''));
  const currentSnapshot = freezeOpenApiAddressEvidence(currentRawData, currentSyncedAt);
  return Boolean(
    frozenSnapshot &&
    currentSnapshot &&
    item.checksum === frozenSnapshot.checksum &&
    frozenSnapshot.checksum === currentSnapshot.checksum &&
    frozenSnapshot.syncedAt === currentSnapshot.syncedAt,
  );
}

function claimToken(secret: string, deploymentId: string, probeId: string): string {
  return createHmac('sha256', secret)
    .update('v1:' + deploymentId + ':' + probeId)
    .digest('base64url');
}

function secureEqual(left: string, right: string): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

function assertDevice(device: LogisticsScopeDeviceContext): void {
  if (
    !validIdentifier(device.sessionId) ||
    !validIdentifier(device.ownerUserId) ||
    !Array.isArray(device.allowedShopIds) ||
    device.allowedShopIds.some((shopId) => !validIdentifier(shopId))
  ) {
    throw new LogisticsScopeBootstrapError(
      'BINDING_PROBE_UNAVAILABLE',
      404,
      'Binding probe is unavailable',
    );
  }
}

function assertReason(reason: string): string {
  const normalized = requiredText(reason);
  if (normalized.length < 5 || normalized.length > 500) {
    throw new LogisticsScopeBootstrapError(
      'INVALID_REVIEW_REASON',
      400,
      'A bounded review reason is required',
    );
  }
  return normalized;
}

const ACTIVE_SCOPE_STATUSES = new Set(['ACTIVE', 'CREATED', 'WORKING']);

export function isActiveLogisticsScopeStatus(value: unknown): boolean {
  return ACTIVE_SCOPE_STATUSES.has(
    String(value || '')
      .trim()
      .toUpperCase(),
  );
}

function evidenceFor(scope: LogisticsOpenApiScope): Record<string, unknown> {
  const openApiAddressEvidence = freezeOpenApiAddressEvidence(
    scope.warehouseRawData,
    scope.warehouseSyncedAt,
  );
  if (!openApiAddressEvidence) {
    throw new LogisticsScopeBootstrapError(
      'OPEN_API_ADDRESS_EVIDENCE_MISMATCH',
      409,
      'OpenAPI address evidence is incomplete',
    );
  }
  return {
    shop: {
      platform: scope.shopPlatform,
      status: scope.shopStatus,
      openApiClientId: scope.openApiClientId,
    },
    warehouse: {
      platformWarehouseId: scope.platformWarehouseId,
      name: scope.warehouseName,
      status: scope.warehouseStatus,
      address: {
        countryCode: scope.warehouseAddress.countryCode,
        city: scope.warehouseAddress.city,
        street: scope.warehouseAddress.street || null,
        zipCode: scope.warehouseAddress.zipCode || null,
        latitude: scope.warehouseAddress.latitude,
        longitude: scope.warehouseAddress.longitude,
      },
      openApiAddressEvidence,
    },
    deliveryMethod: {
      platformMethodId: scope.platformMethodId,
      name: scope.deliveryMethodName,
      providerId: scope.providerId,
      status: scope.deliveryMethodStatus,
    },
  };
}

function mapRepositoryState(state: string): never {
  if (state === 'expired') {
    throw new LogisticsScopeBootstrapError('BINDING_PROBE_EXPIRED', 410, 'Binding probe expired');
  }
  if (state === 'replayed') {
    throw new LogisticsScopeBootstrapError(
      'BINDING_PROBE_REPLAYED',
      409,
      'Binding probe proof was already consumed',
    );
  }
  if (state === 'mismatch') {
    throw new LogisticsScopeBootstrapError(
      'BINDING_PROBE_EVIDENCE_MISMATCH',
      409,
      'Binding probe evidence does not match the synced OpenAPI scope',
    );
  }
  throw new LogisticsScopeBootstrapError(
    'BINDING_PROBE_UNAVAILABLE',
    404,
    'Binding probe is unavailable',
  );
}

function exactRecord<T>(records: T[], predicate: (record: T) => boolean): T | null {
  return records.find(predicate) || null;
}
function matchesStaticPilot(input: {
  officialLocation: {
    countryUid: string;
    countryLabel: string;
    cityUid: string;
    cityLabel: string;
    countryCode: string;
  };
  destination: {
    countryUid: string;
    countryLabel: string;
    locationUid: string;
    locationLabel: string;
    countryCode: string;
  };
}): boolean {
  const origin = input.officialLocation;
  const destination = input.destination;
  return (
    origin.countryUid === STATIC_PILOT.officialLocation.countryUid &&
    origin.countryLabel === STATIC_PILOT.officialLocation.countryLabel &&
    origin.cityUid === STATIC_PILOT.officialLocation.cityUid &&
    origin.cityLabel === STATIC_PILOT.officialLocation.cityLabel &&
    origin.countryCode === STATIC_PILOT.officialLocation.countryCode &&
    destination.countryUid === STATIC_PILOT.destination.countryUid &&
    destination.countryLabel === STATIC_PILOT.destination.countryLabel &&
    destination.locationUid === STATIC_PILOT.destination.locationUid &&
    destination.locationLabel === STATIC_PILOT.destination.locationLabel &&
    destination.countryCode === STATIC_PILOT.destination.countryCode
  );
}

function directoryNetworkErrorCode(
  error: unknown,
): 'network_timeout' | 'network_unavailable' | null {
  if (!error || typeof error !== 'object') return null;
  const name =
    typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'network_timeout';
  if (name === 'TypeError' && /fetch failed|failed to fetch|network/i.test(message)) {
    return 'network_unavailable';
  }
  return null;
}

export function createLogisticsScopeBootstrapService(
  options: CreateLogisticsScopeBootstrapServiceOptions,
) {
  const now = options.now || (() => new Date());
  const id = options.id || randomUUID;
  const directory =
    options.locationDirectory ||
    (createOzonGlobalCalculatorLocationClient() as unknown as LogisticsLocationDirectory);
  const allowStaticPilotLocationFallback =
    options.allowStaticPilotLocationFallback ??
    process.env.OZON_GLOBAL_CALCULATOR_STATIC_PILOT_FALLBACK_ENABLED === 'true';

  if (!validIdentifier(options.deploymentId) || options.tokenSecret.length < 32) {
    throw new Error('Logistics scope bootstrap token configuration is invalid');
  }

  function expectedClaimToken(probeId: string): string {
    return claimToken(options.tokenSecret, options.deploymentId, probeId);
  }

  function assertClaimProof(probeId: string, provided: string): string {
    if (!validIdentifier(probeId) || !validIdentifier(provided)) {
      mapRepositoryState('not_found');
    }
    const expected = expectedClaimToken(probeId);
    if (!secureEqual(expected, provided)) mapRepositoryState('not_found');
    return sha256(provided);
  }

  return {
    listWorkspace(input: {
      tenantId?: string;
      shopId?: string;
      warehouseId?: string;
      bootstrapId?: string;
    }) {
      return options.repository.listWorkspace({
        ...input,
        deploymentId: options.deploymentId,
        schemaMajor: PILOT_SCHEMA_MAJOR,
      });
    },

    getCompanyProbe(input: { probeId: string }) {
      return options.repository.getCompanyProbe(input);
    },

    async bootstrapScope(input: {
      actorUserId: string;
      tenantId: string;
      shopId: string;
      warehouseId: string;
      deliveryMethodId: string;
    }) {
      if (
        ![
          input.actorUserId,
          input.tenantId,
          input.shopId,
          input.warehouseId,
          input.deliveryMethodId,
        ].every(validIdentifier)
      ) {
        throw new LogisticsScopeBootstrapError(
          'INVALID_SCOPE',
          400,
          'Scope identifiers are invalid',
        );
      }
      const scope = await options.repository.loadOpenApiScope(input);
      if (!scope) {
        throw new LogisticsScopeBootstrapError(
          'OPEN_API_SCOPE_UNAVAILABLE',
          404,
          'Synced OpenAPI scope is unavailable',
        );
      }
      if (
        scope.tenantId !== input.tenantId ||
        scope.shopId !== input.shopId ||
        scope.warehouseId !== input.warehouseId ||
        scope.deliveryMethodId !== input.deliveryMethodId ||
        scope.shopPlatform !== 'OZON' ||
        !validIdentifier(scope.platformWarehouseId) ||
        !Number.isSafeInteger(scope.platformMethodId) ||
        scope.platformMethodId <= 0
      ) {
        throw new LogisticsScopeBootstrapError(
          'OPEN_API_SCOPE_MISMATCH',
          409,
          'Synced OpenAPI evidence does not form an exact Ozon scope',
        );
      }
      if (
        scope.shopStatus !== 'ACTIVE' ||
        !isActiveLogisticsScopeStatus(scope.warehouseStatus) ||
        !isActiveLogisticsScopeStatus(scope.deliveryMethodStatus)
      ) {
        throw new LogisticsScopeBootstrapError(
          'OPEN_API_SCOPE_INACTIVE',
          409,
          'Shop, warehouse, and delivery method must all be active',
        );
      }
      const openApiEvidence = evidenceFor(scope);
      return options.repository.upsertBootstrapCandidate({
        id: id(),
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        shopId: input.shopId,
        warehouseId: input.warehouseId,
        deliveryMethodId: input.deliveryMethodId,
        status: 'CANDIDATE',
        evidenceChecksum: sha256(JSON.stringify(openApiEvidence)),
        openApiEvidence,
        now: now(),
      });
    },

    async issueCompanyProbe(input: { actorUserId: string; bootstrapId: string }) {
      if (!validIdentifier(input.actorUserId) || !validIdentifier(input.bootstrapId)) {
        throw new LogisticsScopeBootstrapError(
          'INVALID_PROBE_ISSUE',
          400,
          'Probe issue is invalid',
        );
      }
      const probeId = id();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + PROBE_TTL_MS);
      const token = expectedClaimToken(probeId);
      const created = await options.repository.createCompanyProbe({
        id: probeId,
        actorUserId: input.actorUserId,
        bootstrapId: input.bootstrapId,
        status: 'ISSUED',
        nonceDigest: sha256(token),
        issuedAt,
        expiresAt,
      });
      return {
        probeId: created.id,
        status: created.status,
        expiresAt: created.expiresAt.toISOString(),
      };
    },

    async listPendingCompanyProbes(input: { device: LogisticsScopeDeviceContext }) {
      assertDevice(input.device);
      const current = now();
      const probes = await options.repository.listPendingCompanyProbes({
        device: input.device,
        now: current,
      });
      return probes.flatMap((probe) => {
        const token = expectedClaimToken(probe.id);
        if (
          !secureEqual(sha256(token), probe.nonceDigest) ||
          probe.expiresAt.getTime() <= current.getTime()
        )
          return [];
        return [
          {
            probeId: probe.id,
            bootstrapId: probe.bootstrapId,
            status: probe.status,
            claimToken: token,
            expiresAt: probe.expiresAt.toISOString(),
            expected: {
              deploymentId: options.deploymentId,
              tenantId: probe.tenantId,
              shopId: probe.shopId,
              warehouse: {
                id: probe.warehouseId,
                platformWarehouseId: probe.platformWarehouseId,
              },
              deliveryMethod: {
                id: probe.deliveryMethodId,
                platformMethodId: probe.platformMethodId,
              },
            },
          },
        ];
      });
    },

    async claimCompanyProbe(input: {
      probeId: string;
      claimToken: string;
      device: LogisticsScopeDeviceContext;
    }) {
      assertDevice(input.device);
      const result = await options.repository.claimCompanyProbe({
        probeId: input.probeId,
        nonceDigest: assertClaimProof(input.probeId, input.claimToken),
        device: input.device,
        now: now(),
      });
      if (result.state !== 'claimed' && result.state !== 'duplicate') {
        mapRepositoryState(result.state);
      }
      return {
        probeId: input.probeId,
        status: 'CLAIMED' as const,
        duplicate: result.state === 'duplicate',
      };
    },

    async submitCompanyProbe(input: {
      probeId: string;
      claimToken: string;
      evidence: LogisticsCompanyProbeEvidence;
      device: LogisticsScopeDeviceContext;
    }) {
      assertDevice(input.device);
      if (
        !validIdentifier(input.evidence?.companyId) ||
        !validIdentifier(input.evidence?.warehouse?.platformWarehouseId) ||
        !Number.isSafeInteger(input.evidence?.deliveryMethod?.platformMethodId) ||
        input.evidence.deliveryMethod.platformMethodId <= 0
      ) {
        throw new LogisticsScopeBootstrapError(
          'INVALID_BINDING_PROBE_EVIDENCE',
          400,
          'Binding probe evidence is invalid',
        );
      }
      const result = await options.repository.submitCompanyProbe({
        probeId: input.probeId,
        nonceDigest: assertClaimProof(input.probeId, input.claimToken),
        evidence: {
          companyId: requiredText(input.evidence.companyId),
          warehouse: {
            platformWarehouseId: requiredText(input.evidence.warehouse.platformWarehouseId),
          },
          deliveryMethod: {
            platformMethodId: input.evidence.deliveryMethod.platformMethodId,
          },
        },
        device: input.device,
        now: now(),
      });
      if (result.state !== 'submitted' && result.state !== 'duplicate') {
        mapRepositoryState(result.state);
      }
      return {
        probeId: input.probeId,
        status: 'SUBMITTED' as const,
        duplicate: result.duplicate,
      };
    },

    reviewCompanyProbe(input: {
      probeId: string;
      actorUserId: string;
      decision: 'CONFIRMED' | 'REJECTED';
      reason: string;
    }) {
      if (
        !validIdentifier(input.probeId) ||
        !validIdentifier(input.actorUserId) ||
        !['CONFIRMED', 'REJECTED'].includes(input.decision)
      ) {
        throw new LogisticsScopeBootstrapError(
          'INVALID_PROBE_REVIEW',
          400,
          'Probe review is invalid',
        );
      }
      return options.repository.reviewCompanyProbe({
        ...input,
        reason: assertReason(input.reason),
        now: now(),
      });
    },

    async confirmOriginAndActivate(input: {
      actorUserId: string;
      bootstrapId: string;
      companyBindingId: string;
      reason: string;
      officialLocation: {
        countryUid: string;
        countryLabel: string;
        cityUid: string;
        cityLabel: string;
        countryCode: string;
      };
      destination: {
        countryUid: string;
        countryLabel: string;
        locationUid: string;
        locationLabel: string;
        countryCode: string;
      };
    }) {
      const reason = assertReason(input.reason);
      let countries: Awaited<ReturnType<LogisticsLocationDirectory['listCountries']>>;
      let cities: Awaited<ReturnType<LogisticsLocationDirectory['listCities']>>;
      let destinations: Awaited<ReturnType<LogisticsLocationDirectory['listDestinations']>>;
      try {
        countries = await directory.listCountries();
        [cities, destinations] = await Promise.all([
          directory.listCities(input.officialLocation.countryUid),
          directory.listDestinations(),
        ]);
      } catch (error) {
        const errorCode = directoryNetworkErrorCode(error);
        if (!allowStaticPilotLocationFallback || !errorCode || !matchesStaticPilot(input)) {
          throw error;
        }
        const country = {
          uid: STATIC_PILOT.officialLocation.countryUid,
          name: STATIC_PILOT.officialLocation.countryLabel,
        };
        const city = {
          uid: STATIC_PILOT.officialLocation.cityUid,
          name: STATIC_PILOT.officialLocation.cityLabel,
        };
        const destination = {
          countryUid: STATIC_PILOT.destination.countryUid,
          countryName: STATIC_PILOT.destination.countryLabel,
          locationUid: STATIC_PILOT.destination.locationUid,
          locationName: STATIC_PILOT.destination.locationLabel,
        };
        return options.repository.activateOriginScope({
          ...input,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
          reason,
          officialEvidence: {
            source: STATIC_PILOT_CATALOG_VERSION,
            staticCatalogVersion: STATIC_PILOT_CATALOG_VERSION,
            liveDirectory: { status: 'unavailable', errorCode },
            countriesCatalogVersion: STATIC_PILOT_CATALOG_VERSION,
            countriesFetchedAt: null,
            citiesCatalogVersion: STATIC_PILOT_CATALOG_VERSION,
            citiesFetchedAt: null,
            destinationsCatalogVersion: STATIC_PILOT_CATALOG_VERSION,
            destinationsFetchedAt: null,
            origin: { country, city },
            destination,
          },
          now: now(),
        });
      }
      const country = exactRecord(
        countries.records,
        (record) =>
          record.uid === input.officialLocation.countryUid &&
          record.name === input.officialLocation.countryLabel,
      );
      if (!country) {
        throw new LogisticsScopeBootstrapError(
          'OFFICIAL_LOCATION_MISMATCH',
          409,
          'Official origin country does not match the allowlisted directory',
        );
      }
      const city = exactRecord(
        cities.records,
        (record) =>
          record.uid === input.officialLocation.cityUid &&
          record.name === input.officialLocation.cityLabel,
      );
      const destination = exactRecord(
        destinations.records,
        (record) =>
          record.countryUid === input.destination.countryUid &&
          record.countryName === input.destination.countryLabel &&
          record.locationUid === input.destination.locationUid &&
          record.locationName === input.destination.locationLabel,
      );
      if (!city || !destination) {
        throw new LogisticsScopeBootstrapError(
          'OFFICIAL_LOCATION_MISMATCH',
          409,
          'Official location or destination does not match the allowlisted directory',
        );
      }
      const fixedPilot =
        country.name === 'China' &&
        city.name === 'Xiamen' &&
        destination.countryName === 'Russia' &&
        destination.locationName === 'Moscow' &&
        input.officialLocation.countryCode === 'CN' &&
        input.destination.countryCode === 'RU';
      if (!fixedPilot) {
        throw new LogisticsScopeBootstrapError(
          'PILOT_SCOPE_REQUIRED',
          409,
          'The first pilot is fixed to China/Xiamen and Russia/Moscow',
        );
      }
      return options.repository.activateOriginScope({
        ...input,
        deploymentId: options.deploymentId,
        schemaMajor: PILOT_SCHEMA_MAJOR,
        reason,
        officialEvidence: {
          countriesCatalogVersion: countries.catalogVersion,
          countriesFetchedAt: countries.fetchedAt || null,
          citiesCatalogVersion: cities.catalogVersion,
          citiesFetchedAt: cities.fetchedAt || null,
          destinationsCatalogVersion: destinations.catalogVersion,
          destinationsFetchedAt: destinations.fetchedAt || null,
          origin: { country, city },
          destination,
        },
        now: now(),
      });
    },
  };
}

export type LogisticsScopeBootstrapService = ReturnType<
  typeof createLogisticsScopeBootstrapService
>;
