import { describe, expect, it } from 'vitest';
import { resolveExtensionDeviceRefreshRevocationReason } from '../services/extension-device-session-prisma.js';

const base = {
  credentialExpired: false,
  sessionExpired: false,
  familyStatus: 'ACTIVE',
  sessionStatus: 'ACTIVE',
  ownerStatus: 'ACTIVE',
  actorStatus: 'ACTIVE',
  ownerRole: 'USER',
  actorRole: 'USER',
  actorParentId: null as string | null,
  actorMatchesOwner: true,
  totalGrants: 1,
  validGrants: 1,
};

describe('extension device refresh revocation policy', () => {
  it.each([
    [{ familyStatus: 'REVOKED' }, null],
    [{ sessionStatus: 'REVOKED' }, null],
    [{ credentialExpired: true }, 'SESSION_EXPIRED'],
    [{ sessionExpired: true }, 'SESSION_EXPIRED'],
    [{ ownerStatus: 'SUSPENDED' }, 'ACCOUNT_SUSPENDED'],
    [{ actorStatus: 'SUSPENDED' }, 'ACCOUNT_SUSPENDED'],
    [{ ownerRole: 'STAFF' }, 'AUTHORIZATION_INVALID'],
    [{ actorRole: 'STAFF' }, 'AUTHORIZATION_INVALID'],
    [{ actorParentId: 'owner-1' }, 'ACTOR_UNLINKED'],
    [{ actorMatchesOwner: false }, 'ACTOR_UNLINKED'],
    [{ totalGrants: 0, validGrants: 0 }, 'SHOP_TRANSFERRED'],
    [{ totalGrants: 1, validGrants: 0 }, 'SHOP_TRANSFERRED'],
    [{}, null],
  ] as const)('maps refresh state %j to %s', (changed, expected) => {
    expect(resolveExtensionDeviceRefreshRevocationReason({ ...base, ...changed })).toBe(expected);
  });
});
