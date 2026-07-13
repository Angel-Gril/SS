import {
  publishLogisticsRuleRevision,
  rollbackLogisticsRuleRelease,
  type LogisticsReleaseManifest,
  type LogisticsRuleReleaseDatabase,
  type PublishLogisticsRuleRevisionInput,
  type RollbackLogisticsRuleReleaseInput,
} from './logistics-rule-release.js';
import { createOzonGlobalCalculatorLocationClient } from './ozon-global-calculator-locations.js';

export type OzonLocationDirectory = Pick<
  ReturnType<typeof createOzonGlobalCalculatorLocationClient>,
  'listCountries' | 'listCities' | 'listDestinations'
>;

export class LogisticsRuleAdminServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'LogisticsRuleAdminServiceError';
  }
}

export interface LogisticsRuleAdminPreflightReport {
  source: 'server-derived';
  blockers: unknown[];
  warnings: unknown[];
  [key: string]: unknown;
}

export interface LogisticsRuleAdminPreflightResult {
  status: 'READY' | 'BLOCKED';
  revisionId: string;
  channelId: string;
  report: LogisticsRuleAdminPreflightReport;
  manifest?: LogisticsReleaseManifest;
}

export interface LogisticsRuleAdminRepository {
  deriveAndPersistDraft(input: {
    actorUserId: string;
    channelId: string;
    assignmentId: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  readDraft(input: { revisionId: string }): Promise<unknown>;
  diffDraft(input: { revisionId: string; channelId: string }): Promise<unknown>;
  readWorkspace(input: { channelId?: string; revisionId?: string }): Promise<unknown>;
  suggestMethodBinding(input: MethodBindingSuggestionInput): Promise<unknown>;
  reviewMethodBinding(input: MethodBindingReviewInput): Promise<unknown>;
  suggestOfficialResolution(input: OfficialResolutionSuggestionInput): Promise<unknown>;
  reviewOfficialResolution(input: OfficialResolutionReviewInput): Promise<unknown>;
  preflightDraft(input: {
    actorUserId: string;
    revisionId: string;
    channelId: string;
    expectedSequence: number;
  }): Promise<LogisticsRuleAdminPreflightResult>;
  retireChannel(input: {
    actorUserId: string;
    channelId: string;
    expectedSequence: number;
    reason: string;
  }): Promise<unknown>;
  readChannelReceipts(input: {
    channelId: string;
    limit: number;
  }): Promise<unknown>;
}

export type LogisticsReviewDecision = 'CONFIRMED' | 'REJECTED';

export interface MethodBindingSuggestionInput {
  actorUserId: string;
  channelId: string;
  revisionId: string;
  deliveryMethodId: string;
  stableServiceKey: string;
  note: string;
}

export interface MethodBindingReviewInput {
  actorUserId: string;
  channelId: string;
  revisionId: string;
  bindingId: string;
  decision: LogisticsReviewDecision;
  note: string;
  expectedUpdatedAt: string;
}

export interface OfficialResolutionSuggestionInput {
  actorUserId: string;
  channelId: string;
  revisionId: string;
  requirementKey: string;
  note: string;
}

export interface OfficialResolutionReviewInput {
  actorUserId: string;
  channelId: string;
  revisionId: string;
  resolutionId: string;
  decision: LogisticsReviewDecision;
  selectedServiceKey?: string;
  note: string;
  expectedUpdatedAt: string;
}

export interface LogisticsRuleAdminService {
  readWorkspace(input: { channelId?: string; revisionId?: string }): Promise<unknown>;
  suggestMethodBinding(input: MethodBindingSuggestionInput): Promise<unknown>;
  reviewMethodBinding(input: MethodBindingReviewInput): Promise<unknown>;
  suggestOfficialResolution(input: OfficialResolutionSuggestionInput): Promise<unknown>;
  reviewOfficialResolution(input: OfficialResolutionReviewInput): Promise<unknown>;
  listOfficialCountries(): Promise<unknown>;
  listOfficialCities(countryUid: string): Promise<unknown>;
  listOfficialDestinations(): Promise<unknown>;
  importDraft(input: {
    actorUserId: string;
    channelId: string;
    assignmentId: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  readDraft(input: { revisionId: string }): Promise<unknown>;
  diffDraft(input: { revisionId: string; channelId: string }): Promise<unknown>;
  preflightDraft(input: {
    actorUserId: string;
    revisionId: string;
    channelId: string;
    expectedSequence: number;
  }): Promise<Omit<LogisticsRuleAdminPreflightResult, 'manifest'>>;
  publishDraft(input: {
    actorUserId: string;
    revisionId: string;
    channelId: string;
    expectedSequence: number;
    reason: string;
  }): Promise<unknown>;
  rollbackRelease(input: {
    actorUserId: string;
    channelId: string;
    targetReleaseId: string;
    expectedSequence: number;
    reason: string;
  }): Promise<unknown>;
  retireChannel(input: {
    actorUserId: string;
    channelId: string;
    expectedSequence: number;
    reason: string;
  }): Promise<unknown>;
  readChannelReceipts(input: {
    channelId: string;
    limit: number;
  }): Promise<unknown>;
}

interface CreateLogisticsRuleAdminServiceOptions {
  repository: LogisticsRuleAdminRepository;
  releaseDatabase: LogisticsRuleReleaseDatabase;
  deploymentId?: string;
  schemaMajor?: number;
  publishRevision?: (
    database: LogisticsRuleReleaseDatabase,
    input: PublishLogisticsRuleRevisionInput,
  ) => Promise<unknown>;
  rollbackRelease?: (
    database: LogisticsRuleReleaseDatabase,
    input: RollbackLogisticsRuleReleaseInput,
  ) => Promise<unknown>;
  locationDirectory?: OzonLocationDirectory;
}

function publicPreflight(
  value: LogisticsRuleAdminPreflightResult,
): Omit<LogisticsRuleAdminPreflightResult, 'manifest'> {
  return {
    status: value.status,
    revisionId: value.revisionId,
    channelId: value.channelId,
    report: value.report,
  };
}

export function createLogisticsRuleAdminService(
  options: CreateLogisticsRuleAdminServiceOptions,
): LogisticsRuleAdminService {
  const publishRevision = options.publishRevision || publishLogisticsRuleRevision;
  const rollbackRelease = options.rollbackRelease || rollbackLogisticsRuleRelease;
  const locationDirectory = options.locationDirectory || createOzonGlobalCalculatorLocationClient();

  return {
    readWorkspace(input) {
      return options.repository.readWorkspace(input);
    },

    suggestMethodBinding(input) {
      return options.repository.suggestMethodBinding(input);
    },

    reviewMethodBinding(input) {
      return options.repository.reviewMethodBinding(input);
    },

    suggestOfficialResolution(input) {
      return options.repository.suggestOfficialResolution(input);
    },

    reviewOfficialResolution(input) {
      return options.repository.reviewOfficialResolution(input);
    },

    listOfficialCountries() {
      return locationDirectory.listCountries();
    },

    listOfficialCities(countryUid) {
      return locationDirectory.listCities(countryUid);
    },

    listOfficialDestinations() {
      return locationDirectory.listDestinations();
    },

    importDraft(input) {
      return options.repository.deriveAndPersistDraft(input);
    },

    readDraft(input) {
      return options.repository.readDraft(input);
    },

    diffDraft(input) {
      return options.repository.diffDraft(input);
    },

    async preflightDraft(input) {
      const preflight = await options.repository.preflightDraft(input);
      return publicPreflight(preflight);
    },

    async publishDraft(input) {
      const preflight = await options.repository.preflightDraft(input);
      if (preflight.status !== 'READY') {
        throw new LogisticsRuleAdminServiceError(
          'PREFLIGHT_BLOCKED',
          'The server-derived logistics publication preflight is blocked',
        );
      }
      if (!preflight.manifest) {
        throw new LogisticsRuleAdminServiceError(
          'SERVER_PREFLIGHT_INVALID',
          'The authoritative preflight did not produce a release manifest',
          500,
        );
      }
      return publishRevision(options.releaseDatabase, {
        deploymentId: options.deploymentId,
        schemaMajor: options.schemaMajor,
        channelId: input.channelId,
        revisionId: input.revisionId,
        expectedSequence: input.expectedSequence,
        actorUserId: input.actorUserId,
        reason: input.reason,
        manifest: preflight.manifest,
      });
    },

    rollbackRelease(input) {
      return rollbackRelease(options.releaseDatabase, {
        ...input,
        deploymentId: options.deploymentId,
        schemaMajor: options.schemaMajor,
      });
    },

    retireChannel(input) {
      return options.repository.retireChannel(input);
    },

    readChannelReceipts(input) {
      return options.repository.readChannelReceipts(input);
    },
  };
}
