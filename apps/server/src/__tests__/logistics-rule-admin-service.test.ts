import { describe, expect, it, vi } from 'vitest';
import { createLogisticsRuleAdminService } from '../services/logistics-rule-admin.js';

const MANIFEST = {
  schemaVersion: '1',
  minimumExtensionVersion: '1.0.0',
  destination: {
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    destinationLabel: 'Moscow',
    destinationCountryCode: 'RU',
  },
  selectedServiceKeys: ['service-1'],
  defaultServiceKeys: ['service-1'],
  deliveryMethodBindingIds: ['binding-1'],
  officialResolutions: [],
  routeClassifications: { 'service-1': 'RU' },
  validationReport: { source: 'server-derived', blockers: [] },
  revisionId: 'revision-1',
};

function repository(status: 'READY' | 'BLOCKED' = 'READY') {
  return {
    readWorkspace: vi.fn(async () => ({ channel: { id: 'channel-1' } })),
    suggestMethodBinding: vi.fn(async () => ({ id: 'binding-1', status: 'SUGGESTED' })),
    reviewMethodBinding: vi.fn(async () => ({ id: 'binding-1', status: 'CONFIRMED' })),
    suggestOfficialResolution: vi.fn(async () => ({ id: 'resolution-1', status: 'SUGGESTED' })),
    reviewOfficialResolution: vi.fn(async () => ({ id: 'resolution-1', status: 'CONFIRMED' })),
    deriveAndPersistDraft: vi.fn(async () => ({ id: 'revision-1', validationStatus: 'PASSED' })),
    readDraft: vi.fn(async () => ({ id: 'revision-1', validationStatus: 'PASSED' })),
    diffDraft: vi.fn(async () => ({
      revisionId: 'revision-1',
      added: [],
      changed: [],
      removed: [],
    })),
    preflightDraft: vi.fn(async () => ({
      status,
      revisionId: 'revision-1',
      channelId: 'channel-1',
      report: {
        source: 'server-derived' as const,
        blockers: status === 'READY' ? [] : [{ code: 'official_branch_uncovered' }],
        warnings: [],
      },
      manifest: MANIFEST,
    })),
    retireChannel: vi.fn(async () => ({ channelId: 'channel-1' })),
    readChannelReceipts: vi.fn(async () => ({ channelId: 'channel-1', records: [] })),
  };
}

describe('logistics rule admin service', () => {
  it('delegates pilot management operations and the injectable Official directory', async () => {
    const repo = repository();
    const locations = {
      listCountries: vi.fn(async () => ({ kind: 'countries', records: [] })),
      listCities: vi.fn(async (countryUid: string) => ({
        kind: 'cities',
        countryUid,
        records: [],
      })),
      listDestinations: vi.fn(async () => ({ kind: 'destinations', records: [] })),
    };
    const service = createLogisticsRuleAdminService({
      repository: repo,
      releaseDatabase: {} as any,
      locationDirectory: locations as any,
    });
    const note = 'checked';

    await service.readWorkspace({ channelId: 'channel-1', revisionId: 'revision-1' });
    await service.suggestMethodBinding({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      deliveryMethodId: 'method-1',
      stableServiceKey: 'service-1',
      note,
    });
    await service.reviewMethodBinding({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      bindingId: 'binding-1',
      decision: 'CONFIRMED',
      note,
      expectedUpdatedAt: '2026-07-13T04:00:00.000Z',
    });
    await service.suggestOfficialResolution({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note,
    });
    await service.reviewOfficialResolution({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      resolutionId: 'resolution-1',
      decision: 'REJECTED',
      note,
      expectedUpdatedAt: '2026-07-13T04:00:00.000Z',
    });
    await service.listOfficialCountries();
    await service.listOfficialCities('china-uid');
    await service.listOfficialDestinations();

    expect(repo.readWorkspace).toHaveBeenCalledWith({
      channelId: 'channel-1',
      revisionId: 'revision-1',
    });
    expect(repo.reviewMethodBinding).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: 'binding-1' }),
    );
    expect(repo.reviewOfficialResolution).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionId: 'resolution-1' }),
    );
    expect(locations.listCountries).toHaveBeenCalledTimes(1);
    expect(locations.listCities).toHaveBeenCalledWith('china-uid');
    expect(locations.listDestinations).toHaveBeenCalledTimes(1);
  });
  it('delegates draft import to the server derivation repository', async () => {
    const repo = repository();
    const service = createLogisticsRuleAdminService({
      repository: repo,
      releaseDatabase: {} as any,
    });
    const payload = { schema: 'ozon-logistics-draft/v1', rawProviderRows: [{ id: 'provider-1' }] };

    await service.importDraft({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload,
    });

    expect(repo.deriveAndPersistDraft).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload,
    });
  });

  it('does not expose the server-owned manifest in a preflight response', async () => {
    const repo = repository();
    const service = createLogisticsRuleAdminService({
      repository: repo,
      releaseDatabase: {} as any,
    });

    const result = await service.preflightDraft({
      actorUserId: 'admin-1',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      expectedSequence: 0,
    });

    expect(result).toEqual({
      status: 'READY',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      report: { source: 'server-derived', blockers: [], warnings: [] },
    });
    expect(result).not.toHaveProperty('manifest');
  });

  it('blocks publication when authoritative server preflight is blocked', async () => {
    const repo = repository('BLOCKED');
    const publishRevision = vi.fn();
    const service = createLogisticsRuleAdminService({
      repository: repo,
      releaseDatabase: {} as any,
      publishRevision,
    });

    await expect(
      service.publishDraft({
        actorUserId: 'admin-1',
        revisionId: 'revision-1',
        channelId: 'channel-1',
        expectedSequence: 0,
        reason: '发布试点规则',
      }),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_BLOCKED', statusCode: 422 });
    expect(publishRevision).not.toHaveBeenCalled();
  });

  it('publishes only the manifest produced by authoritative server preflight', async () => {
    const repo = repository('READY');
    const release = { id: 'release-1', sequence: 1 };
    const publishRevision = vi.fn(async () => release);
    const service = createLogisticsRuleAdminService({
      repository: repo,
      releaseDatabase: { name: 'release-database' } as any,
      deploymentId: 'local-test',
      schemaMajor: 1,
      publishRevision,
    });

    const result = await service.publishDraft({
      actorUserId: 'admin-1',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      expectedSequence: 0,
      reason: '发布试点规则',
    });

    expect(result).toBe(release);
    expect(publishRevision).toHaveBeenCalledWith(
      { name: 'release-database' },
      {
        actorUserId: 'admin-1',
        revisionId: 'revision-1',
        channelId: 'channel-1',
        deploymentId: 'local-test',
        schemaMajor: 1,
        expectedSequence: 0,
        reason: '发布试点规则',
        manifest: MANIFEST,
      },
    );
  });

  it('delegates rollback to the existing immutable release service', async () => {
    const rollback = { id: 'release-2', sequence: 2, releaseKind: 'ROLLBACK' };
    const rollbackRelease = vi.fn(async () => rollback);
    const service = createLogisticsRuleAdminService({
      repository: repository(),
      releaseDatabase: { name: 'release-database' } as any,
      deploymentId: 'local-test',
      schemaMajor: 1,
      rollbackRelease,
    });

    const result = await service.rollbackRelease({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      targetReleaseId: 'release-1',
      expectedSequence: 1,
      reason: '回滚错误报价',
    });

    expect(result).toBe(rollback);
    expect(rollbackRelease).toHaveBeenCalledWith(
      { name: 'release-database' },
      {
        actorUserId: 'admin-1',
        channelId: 'channel-1',
        targetReleaseId: 'release-1',
        expectedSequence: 1,
        reason: '回滚错误报价',
        deploymentId: 'local-test',
        schemaMajor: 1,
      },
    );
  });
});
