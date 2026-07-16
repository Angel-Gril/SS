import jwt, { type JwtPayload as JsonJwtPayload } from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';

type Environment = Record<string, string | undefined>;

const DEVICE_TOKEN_TYPE = 'extension_device';
const DEVICE_TOKEN_USE = 'access';
const MAX_DEVICE_ACCESS_TTL_SECONDS = 15 * 60;

export interface ExtensionDeviceAuthConfig {
  deploymentId: string;
  issuer: string;
  audience: string;
  secret: string;
}

export interface ExtensionDeviceAccessClaims extends JsonJwtPayload {
  typ: typeof DEVICE_TOKEN_TYPE;
  tokenUse: typeof DEVICE_TOKEN_USE;
  deploymentId: string;
  sid: string;
  deviceId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  sub: string;
  jti: string;
}

export interface ExtensionDeviceContext extends ExtensionDeviceAccessClaims {
  sessionId: string;
  tokenId: string;
  allowedShopIds?: string[];
}

export interface ExtensionDeviceLiveAuthorization {
  sessionId: string;
  status: string;
  expiresAt: Date;
  currentJti: string;
  deploymentId: string;
  deviceId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  ownerStatus: string;
  actorStatus: string;
  ownerRole: string;
  actorRole: string;
  actorParentId: string | null;
  shopGrants: Array<{ shopId: string; status: string }>;
}

export interface IssueExtensionDeviceAccessTokenInput {
  sessionId: string;
  tokenId: string;
  deviceId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
}

export class ExtensionDeviceAuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionDeviceAuthError';
  }
}

function envText(env: Environment, key: string): string {
  return String(env[key] || '').trim();
}

function strictBooleanFlag(env: Environment, key: string, defaultValue: boolean): boolean {
  const raw = envText(env, key);
  if (!raw) return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

export type ExtensionAuthMode = 'compat' | 'device-only';

export function resolveExtensionAuthMode(env: Environment = process.env): ExtensionAuthMode {
  const value = envText(env, 'EXTENSION_AUTH_MODE') || 'compat';
  if (value === 'compat' || value === 'device-only') return value;
  throw new Error('EXTENSION_AUTH_MODE must be compat or device-only');
}

export function isLegacyExtensionTokenIssuanceEnabled(env: Environment = process.env): boolean {
  return resolveExtensionAuthMode(env) === 'compat'
    && strictBooleanFlag(env, 'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS', true);
}

export function isLogisticsDistributionEnabled(env: Environment = process.env): boolean {
  return strictBooleanFlag(env, 'LOGISTICS_DISTRIBUTION_ENABLED', false);
}

export function isExtensionDeviceAuthEnabled(env: Environment = process.env): boolean {
  const configured = envText(env, 'EXTENSION_DEVICE_AUTH_ENABLED');
  const explicitlyEnabled = configured
    ? strictBooleanFlag(env, 'EXTENSION_DEVICE_AUTH_ENABLED', false)
    : false;
  return explicitlyEnabled || isLogisticsDistributionEnabled(env);
}

export function resolveExtensionDeviceAuthConfig(
  env: Environment = process.env,
): ExtensionDeviceAuthConfig {
  const deploymentId = envText(env, 'SS_ERP_DEPLOYMENT_ID') || 'local-dev';
  const issuer = envText(env, 'AUTH_JWT_ISSUER') || 'ss-erp-local';
  const secret = envText(env, 'EXTENSION_DEVICE_JWT_SECRET')
    || envText(env, 'JWT_SECRET')
    || 'dev-secret-change-me';
  return {
    deploymentId,
    issuer,
    audience: `ss-erp-extension:${deploymentId}`,
    secret,
  };
}

function validateResolvedDeviceAuthConfig(env: Environment): void {
  const required = [
    'SS_ERP_DEPLOYMENT_ID',
    'AUTH_JWT_ISSUER',
    'EXTENSION_DEVICE_JWT_SECRET',
  ];
  for (const key of required) {
    if (!envText(env, key)) {
      throw new Error(`${key} is required for extension-device authentication`);
    }
  }
  const config = resolveExtensionDeviceAuthConfig(env);
  if (config.deploymentId === 'local-dev'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(config.deploymentId)) {
    throw new Error('SS_ERP_DEPLOYMENT_ID is not valid for production');
  }
  if (config.issuer === 'ss-erp-local'
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(config.issuer)) {
    throw new Error('AUTH_JWT_ISSUER is not valid for production');
  }
  if (config.secret.length < 32) {
    throw new Error('EXTENSION_DEVICE_JWT_SECRET must be at least 32 characters');
  }
  if (config.secret === envText(env, 'JWT_SECRET')) {
    throw new Error('EXTENSION_DEVICE_JWT_SECRET must differ from JWT_SECRET');
  }
}

export function validateExtensionDeviceAuthEnvironment(env: Environment = process.env): void {
  const mode = resolveExtensionAuthMode(env);
  isLogisticsDistributionEnabled(env);
  const deviceAuthEnabled = isExtensionDeviceAuthEnabled(env);
  const acceptsLegacy = strictBooleanFlag(env, 'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS', true);

  if (mode === 'device-only') {
    if (acceptsLegacy) {
      throw new Error('AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS must be false in device-only mode');
    }
    if (!deviceAuthEnabled) {
      throw new Error('EXTENSION_DEVICE_AUTH_ENABLED must be true in device-only mode');
    }
    validateResolvedDeviceAuthConfig(env);
    return;
  }

  if (envText(env, 'NODE_ENV') === 'production' && deviceAuthEnabled) {
    validateResolvedDeviceAuthConfig(env);
  }
}

function requiredClaim(value: unknown, name: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new ExtensionDeviceAuthError('invalid_device_token', 401, `Missing ${name}`);
  }
  return normalized;
}

function invalidDeviceToken(): ExtensionDeviceAuthError {
  return new ExtensionDeviceAuthError('invalid_device_token', 401, 'Invalid device token');
}

export function issueExtensionDeviceAccessToken(
  input: IssueExtensionDeviceAccessTokenInput,
  config: ExtensionDeviceAuthConfig = resolveExtensionDeviceAuthConfig(),
): string {
  return jwt.sign({
    typ: DEVICE_TOKEN_TYPE,
    tokenUse: DEVICE_TOKEN_USE,
    deploymentId: config.deploymentId,
    sid: input.sessionId,
    deviceId: input.deviceId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    scopes: input.scopes,
  }, config.secret, {
    algorithm: 'HS256',
    issuer: config.issuer,
    audience: config.audience,
    subject: input.sessionId,
    jwtid: input.tokenId,
    expiresIn: MAX_DEVICE_ACCESS_TTL_SECONDS,
  });
}

export function verifyExtensionDeviceAccessTokenCryptographically(
  token: string,
  config: ExtensionDeviceAuthConfig = resolveExtensionDeviceAuthConfig(),
  requiredScopes: readonly string[] = [],
): ExtensionDeviceAccessClaims {
  let decoded: string | JsonJwtPayload;
  try {
    decoded = jwt.verify(token, config.secret, {
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
    });
  } catch {
    throw invalidDeviceToken();
  }

  if (typeof decoded === 'string') throw invalidDeviceToken();
  if (decoded.typ !== DEVICE_TOKEN_TYPE || decoded.tokenUse !== DEVICE_TOKEN_USE) {
    throw invalidDeviceToken();
  }
  if (requiredClaim(decoded.deploymentId, 'deploymentId') !== config.deploymentId) {
    throw invalidDeviceToken();
  }

  const sid = requiredClaim(decoded.sid, 'sid');
  const subject = requiredClaim(decoded.sub, 'sub');
  const jti = requiredClaim(decoded.jti, 'jti');
  if (!Number.isInteger(decoded.iat)
    || !Number.isInteger(decoded.exp)
    || Number(decoded.iat) <= 0
    || Number(decoded.exp) <= Number(decoded.iat)
    || Number(decoded.exp) - Number(decoded.iat) > MAX_DEVICE_ACCESS_TTL_SECONDS) {
    throw invalidDeviceToken();
  }
  if (subject !== sid) throw invalidDeviceToken();
  requiredClaim(decoded.deviceId, 'deviceId');
  requiredClaim(decoded.ownerUserId, 'ownerUserId');
  requiredClaim(decoded.actorUserId, 'actorUserId');

  if (!Array.isArray(decoded.scopes)
    || decoded.scopes.some((scope) => typeof scope !== 'string' || !scope.trim())) {
    throw invalidDeviceToken();
  }
  const scopes = [...new Set(decoded.scopes.map((scope) => scope.trim()))];
  const missingScope = requiredScopes.some((scope) => !scopes.includes(scope));
  if (missingScope) {
    throw new ExtensionDeviceAuthError('insufficient_scope', 403, 'Device scope is not allowed');
  }

  return {
    ...decoded,
    typ: DEVICE_TOKEN_TYPE,
    tokenUse: DEVICE_TOKEN_USE,
    deploymentId: config.deploymentId,
    sid,
    sub: subject,
    jti,
    deviceId: requiredClaim(decoded.deviceId, 'deviceId'),
    ownerUserId: requiredClaim(decoded.ownerUserId, 'ownerUserId'),
    actorUserId: requiredClaim(decoded.actorUserId, 'actorUserId'),
    scopes,
  };
}

function extractDeviceBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function authenticateExtensionDeviceTokenCryptographically(options: {
  config?: ExtensionDeviceAuthConfig;
  requiredScopes?: readonly string[];
} = {}) {
  const config = options.config || resolveExtensionDeviceAuthConfig();
  const requiredScopes = options.requiredScopes || [];

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractDeviceBearerToken(request);
    if (!token) {
      return reply.status(401).send({
        code: 0,
        errorCode: 'device_token_required',
        msg: '缺少设备令牌',
      });
    }

    try {
      const claims = verifyExtensionDeviceAccessTokenCryptographically(token, config, requiredScopes);
      (request as any).device = {
        ...claims,
        sessionId: claims.sid,
        tokenId: claims.jti,
      } satisfies ExtensionDeviceContext;
    } catch (error) {
      const authError = error instanceof ExtensionDeviceAuthError
        ? error
        : invalidDeviceToken();
      return reply.status(authError.statusCode).send({
        code: 0,
        errorCode: authError.code,
        msg: authError.statusCode === 403 ? '设备权限不足' : '无效的设备令牌',
      });
    }
  };
}

export function authenticateExtensionDevice(options: {
  config?: ExtensionDeviceAuthConfig;
  requiredScopes?: readonly string[];
  loadAuthorization: (sessionId: string) => Promise<ExtensionDeviceLiveAuthorization | null>;
  shopIdFromRequest?: (request: FastifyRequest) => string | null | undefined;
  now?: () => Date;
}) {
  const config = options.config || resolveExtensionDeviceAuthConfig();
  const requiredScopes = options.requiredScopes || [];
  const now = options.now || (() => new Date());

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractDeviceBearerToken(request);
    if (!token) {
      return reply.status(401).send({
        code: 0,
        errorCode: 'device_token_required',
        msg: '缺少设备令牌',
      });
    }

    let claims: ExtensionDeviceAccessClaims;
    try {
      claims = verifyExtensionDeviceAccessTokenCryptographically(token, config, requiredScopes);
    } catch (error) {
      const authError = error instanceof ExtensionDeviceAuthError
        ? error
        : invalidDeviceToken();
      return reply.status(authError.statusCode).send({
        code: 0,
        errorCode: authError.code,
        msg: authError.statusCode === 403 ? '设备权限不足' : '无效的设备令牌',
      });
    }

    const authorization = await options.loadAuthorization(claims.sid);
    const identitiesMatch = authorization
      && authorization.sessionId === claims.sid
      && authorization.currentJti === claims.jti
      && authorization.deploymentId === claims.deploymentId
      && authorization.deviceId === claims.deviceId
      && authorization.ownerUserId === claims.ownerUserId
      && authorization.actorUserId === claims.actorUserId;
    const sessionIsActive = identitiesMatch
      && authorization.status === 'ACTIVE'
      && authorization.expiresAt.getTime() > now().getTime();
    const accountsAreActive = sessionIsActive
      && authorization.ownerStatus === 'ACTIVE'
      && authorization.actorStatus === 'ACTIVE'
      && ['USER', 'ADMIN'].includes(authorization.ownerRole)
      && ['USER', 'ADMIN'].includes(authorization.actorRole)
      && authorization.actorParentId === null
      && authorization.actorUserId === authorization.ownerUserId;

    if (!accountsAreActive) {
      return reply.status(401).send({
        code: 0,
        errorCode: 'invalid_device_token',
        msg: '无效的设备令牌',
      });
    }

    if (requiredScopes.some((scope) => !authorization.scopes.includes(scope))) {
      return reply.status(403).send({
        code: 0,
        errorCode: 'insufficient_scope',
        msg: '设备权限不足',
      });
    }

    const requestedShopId = options.shopIdFromRequest?.(request);
    if (requestedShopId) {
      const grant = authorization.shopGrants.find(({ shopId }) => shopId === requestedShopId);
      if (!grant) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      if (grant.status !== 'ACTIVE') {
        return reply.status(410).send({
          code: 0,
          errorCode: 'device_shop_revoked',
          msg: '设备的店铺授权已撤销',
        });
      }
    }

    const liveScopes = claims.scopes.filter((scope) => authorization.scopes.includes(scope));
    (request as any).device = {
      ...claims,
      scopes: liveScopes,
      sessionId: claims.sid,
      tokenId: claims.jti,
      allowedShopIds: authorization.shopGrants
        .filter(({ status }) => status === 'ACTIVE')
        .map(({ shopId }) => shopId),
    } satisfies ExtensionDeviceContext;
  };
}
