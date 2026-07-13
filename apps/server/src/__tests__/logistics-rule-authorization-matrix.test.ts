import { describe, expect, it } from 'vitest';
import {
  assertLogisticsRuleActionAllowed,
  type LogisticsRuleActor,
  type LogisticsRuleAction,
} from '../services/logistics-rule-authorization.js';

const actors: Record<string, LogisticsRuleActor> = {
  superAdmin: { kind: 'account', isSuperAdmin: true, isTenantOwner: true },
  tenantOwner: { kind: 'account', isSuperAdmin: false, isTenantOwner: true },
  staff: { kind: 'account', isSuperAdmin: false, isTenantOwner: false },
  device: {
    kind: 'device',
    scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
  },
};

const adminActions: LogisticsRuleAction[] = [
  'draft:import',
  'draft:read',
  'binding:verify',
  'assignment:manage',
  'release:publish',
  'release:rollback',
];

describe('logistics rule pilot authorization matrix', () => {
  it('reserves draft review, binding and release transitions for super administrators', () => {
    for (const action of adminActions) {
      expect(() => assertLogisticsRuleActionAllowed(actors.superAdmin!, action)).not.toThrow();
      for (const actor of [actors.tenantOwner!, actors.staff!, actors.device!]) {
        expect(() => assertLogisticsRuleActionAllowed(actor, action)).toThrow(
          expect.objectContaining({ code: 'LOGISTICS_ACTION_FORBIDDEN', statusCode: 403 }),
        );
      }
    }
  });

  it('allows a tenant owner to pair and revoke owned devices but denies staff and devices', () => {
    for (const action of ['device:pair', 'device:revoke'] as const) {
      expect(() => assertLogisticsRuleActionAllowed(actors.superAdmin!, action)).not.toThrow();
      expect(() => assertLogisticsRuleActionAllowed(actors.tenantOwner!, action)).not.toThrow();
      expect(() => assertLogisticsRuleActionAllowed(actors.staff!, action)).toThrow();
      expect(() => assertLogisticsRuleActionAllowed(actors.device!, action)).toThrow();
    }
  });

  it('maps each device operation to one explicit scope', () => {
    expect(() => assertLogisticsRuleActionAllowed(actors.device!, 'scope:discover')).not.toThrow();
    expect(() => assertLogisticsRuleActionAllowed(actors.device!, 'release:read')).not.toThrow();
    expect(() => assertLogisticsRuleActionAllowed(actors.device!, 'receipt:write')).not.toThrow();

    const readOnly: LogisticsRuleActor = { kind: 'device', scopes: ['logistics:read'] };
    expect(() => assertLogisticsRuleActionAllowed(readOnly, 'release:read')).not.toThrow();
    expect(() => assertLogisticsRuleActionAllowed(readOnly, 'scope:discover')).toThrow(
      expect.objectContaining({ code: 'DEVICE_SCOPE_REQUIRED' }),
    );
    expect(() => assertLogisticsRuleActionAllowed(readOnly, 'receipt:write')).toThrow(
      expect.objectContaining({ code: 'DEVICE_SCOPE_REQUIRED' }),
    );
  });

  it('never lets an account token call a device-only distribution action', () => {
    for (const action of ['scope:discover', 'release:read', 'receipt:write'] as const) {
      expect(() => assertLogisticsRuleActionAllowed(actors.superAdmin!, action)).toThrow(
        expect.objectContaining({ code: 'DEVICE_AUTH_REQUIRED' }),
      );
    }
  });
});
