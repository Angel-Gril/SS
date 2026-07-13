import { describe, expect, it } from 'vitest';
import { resolveLogisticsAssignmentAccess } from '../services/logistics-rule-distribution.js';

const device = {
  sessionId: 'device-session-a',
  ownerUserId: 'tenant-a',
  activeShopIds: ['shop-a'],
};

const assignment = {
  id: 'assignment-a',
  tenantId: 'tenant-a',
  shopId: 'shop-a',
  retiredAt: null,
};

describe('logistics assignment discovery privacy', () => {
  it('allows only a current assignment covered by live owner and shop grants', () => {
    expect(resolveLogisticsAssignmentAccess({ device, assignment, priorGrant: null }))
      .toEqual({ state: 'allowed', assignmentId: 'assignment-a' });
  });

  it.each([
    null,
    { ...assignment, tenantId: 'tenant-b' },
    { ...assignment, shopId: 'shop-b' },
    { ...assignment, retiredAt: new Date('2026-07-12T00:00:00.000Z') },
  ])('returns non-enumerating not_found for a guessed or foreign assignment', (candidate) => {
    expect(resolveLogisticsAssignmentAccess({
      device,
      assignment: candidate,
      priorGrant: null,
      requestedAssignmentId: 'assignment-a',
    })).toEqual({ state: 'not_found' });
  });

  it('returns gone only for a scope previously delivered to this exact device session', () => {
    const priorGrant = {
      deviceSessionId: 'device-session-a',
      assignmentId: 'assignment-a',
      status: 'REVOKED',
      revokeReason: 'shop_transferred',
    };

    expect(resolveLogisticsAssignmentAccess({
      device,
      assignment: { ...assignment, tenantId: 'tenant-b' },
      priorGrant,
    })).toEqual({
      state: 'gone',
      assignmentId: 'assignment-a',
      reasonCode: 'shop_transferred',
    });

    expect(resolveLogisticsAssignmentAccess({
      device: { ...device, sessionId: 'device-session-b' },
      assignment: { ...assignment, tenantId: 'tenant-b' },
      priorGrant,
    })).toEqual({ state: 'not_found' });
  });

  it('does not expose tenant, shop, or release metadata in denied results', () => {
    const result = resolveLogisticsAssignmentAccess({
      device,
      assignment: { ...assignment, tenantId: 'tenant-b' },
      priorGrant: null,
    });

    expect(result).toEqual({ state: 'not_found' });
    expect(JSON.stringify(result)).not.toContain('tenant-b');
    expect(JSON.stringify(result)).not.toContain('shop-a');
  });

  it('maps internal revoke details to a fixed public reason code', () => {
    expect(resolveLogisticsAssignmentAccess({
      device,
      assignment: { ...assignment, tenantId: 'tenant-b' },
      priorGrant: {
        deviceSessionId: 'device-session-a',
        assignmentId: 'assignment-a',
        status: 'REVOKED',
        revokeReason: 'tenant_b_contract_internal_note',
      },
    })).toEqual({
      state: 'gone',
      assignmentId: 'assignment-a',
      reasonCode: 'scope_revoked',
    });
  });
});
