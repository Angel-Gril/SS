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

export function isLegacyExtensionTokenIssuanceEnabled(env: Environment = process.env): boolean {
  return strictBooleanFlag(env, 'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS', true);
}

export function isLogisticsDistributionEnabled(env: Environment = process.env): boolean {
  return strictBooleanFlag(env, 'LOGISTICS_DISTRIBUTION_ENABLED', false);
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

export function validateExtensionDeviceAuthEnvironment(env: Environment = process.env): void {
  const distributionEnabled = isLogisticsDistributionEnabled(env);
  isLegacyExtensionTokenIssuanceEnabled(env);
  if (envText(env, 'NODE_ENV') !== 'production' || !distributionEnabled) return;

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
  const deploymentId = envText(env, 'SS_ERP_DEPLOYMENT_ID');
  const issuer = envText(env, 'AUTH_JWT_ISSUER');
  const deviceSecret = envText(env, 'EXTENSION_DEVICE_JWT_SECRET');
  if (deploymentId === 'local-dev'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(deploymentId)) {
    throw new Error('SS_ERP_DEPLOYMENT_ID is not valid for production');
  }
  if (issuer === 'ss-erp-local'
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(issuer)) {
    throw new Error('AUTH_JWT_ISSUER is not valid for production');
  }
  if (deviceSecret.length < 32) {
    throw new Error('EXTENSION_DEVICE_JWT_SECRET must be at least 32 characters');
  }
  if (deviceSecret === envText(env, 'JWT_SECRET')) {
    throw new Error('EXTENSION_DEVICE_JWT_SECRET must differ from JWT_SECRET');
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
