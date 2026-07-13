export type LogisticsRuleAction =
  | 'draft:import'
  | 'draft:read'
  | 'binding:verify'
  | 'assignment:manage'
  | 'release:publish'
  | 'release:rollback'
  | 'device:pair'
  | 'device:revoke'
  | 'scope:discover'
  | 'release:read'
  | 'receipt:write';

export type LogisticsRuleActor =
  | {
    kind: 'account';
    isSuperAdmin: boolean;
    isTenantOwner: boolean;
  }
  | {
    kind: 'device';
    scopes: readonly string[];
  };

export class LogisticsRuleAuthorizationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 403,
  ) {
    super(message);
    this.name = 'LogisticsRuleAuthorizationError';
  }
}

const SUPER_ADMIN_ACTIONS = new Set<LogisticsRuleAction>([
  'draft:import',
  'draft:read',
  'binding:verify',
  'assignment:manage',
  'release:publish',
  'release:rollback',
]);

const TENANT_OWNER_ACTIONS = new Set<LogisticsRuleAction>([
  'device:pair',
  'device:revoke',
]);

const DEVICE_ACTION_SCOPES = new Map<LogisticsRuleAction, string>([
  ['scope:discover', 'logistics:discover'],
  ['release:read', 'logistics:read'],
  ['receipt:write', 'logistics:receipt'],
]);

export function assertLogisticsRuleActionAllowed(
  actor: LogisticsRuleActor,
  action: LogisticsRuleAction,
): void {
  const deviceScope = DEVICE_ACTION_SCOPES.get(action);
  if (deviceScope) {
    if (actor.kind !== 'device') {
      throw new LogisticsRuleAuthorizationError(
        'DEVICE_AUTH_REQUIRED',
        'This logistics action requires extension-device authentication',
      );
    }
    if (!actor.scopes.includes(deviceScope)) {
      throw new LogisticsRuleAuthorizationError(
        'DEVICE_SCOPE_REQUIRED',
        `The extension device lacks ${deviceScope}`,
      );
    }
    return;
  }

  if (actor.kind !== 'account') {
    throw new LogisticsRuleAuthorizationError(
      'LOGISTICS_ACTION_FORBIDDEN',
      'Extension devices cannot perform logistics administration actions',
    );
  }
  if (SUPER_ADMIN_ACTIONS.has(action) && actor.isSuperAdmin) return;
  if (TENANT_OWNER_ACTIONS.has(action) && (actor.isTenantOwner || actor.isSuperAdmin)) return;

  throw new LogisticsRuleAuthorizationError(
    'LOGISTICS_ACTION_FORBIDDEN',
    'The account cannot perform this logistics action',
  );
}
