import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  issueExtensionDeviceAccessToken,
  type ExtensionDeviceAuthConfig,
} from '../lib/extension-device-auth.js';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OUTSTANDING_PAIRING_LIMIT = 5;
const DEFAULT_EXTENSION_DEVICE_SCOPES = [
  'logistics:discover',
  'logistics:read',
  'logistics:receipt',
  'logistics:capture',
] as const;

export const EXTENSION_DEVICE_SCOPES = [
  ...DEFAULT_EXTENSION_DEVICE_SCOPES,
  'capture:write',
  'listing:write',
  'listing:review',
  'media:execute',
  'byok:media:ingest',
  'listing:publish',
] as const;

export const EXTENSION_DEVICE_REVOCATION_REASONS = [
  'PAIRING_APPROVED',
  'OWNER_REVOKED',
  'PASSWORD_RESET',
  'ACCOUNT_SUSPENDED',
  'ACTOR_UNLINKED',
  'SHOP_TRANSFERRED',
  'AUTHORIZATION_INVALID',
  'SESSION_EXPIRED',
  'REFRESH_REUSE_DETECTED',
  'ASSIGNMENT_REVOKED',
  'ASSIGNMENT_RETIRED',
  'SHOP_UNLINKED',
  'WAREHOUSE_RETIRED',
  'SCOPE_REVOKED',
] as const;

export type ExtensionDeviceRevocationReason =
  typeof EXTENSION_DEVICE_REVOCATION_REASONS[number];

export interface ExtensionDeviceSessionSnapshot {
  id: string;
  deploymentId: string;
  deviceId: string;
  actorUserId: string;
  ownerUserId: string;
  scopes: string[];
  currentJti: string;
  expiresAt: Date;
}

export interface ExtensionDeviceSessionRepository {
  countOutstandingPairingCodes(ownerUserId: string, now: Date): Promise<number>;
  shopsBelongToOwner(ownerUserId: string, shopIds: string[]): Promise<boolean>;
  consumePairingClaimAttemptBudget(input: {
    codeDigest: string;
    deviceId: string;
    now: Date;
  }): Promise<boolean>;
  createPairingCode(input: {
    deploymentId: string;
    actorUserId: string;
    ownerUserId: string;
    codeDigest: string;
    shopIds: string[];
    scopes: string[];
    deviceLabel: string | null;
    resumeSessionId: string | null;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<
    | { kind: 'created'; id: string }
    | { kind: 'limit' }
    | { kind: 'invalid_resume' }
  >;
  claimPairingCodeAtomically(input: {
    codeDigest: string;
    deploymentId: string;
    deviceId: string;
    deviceLabel: string | null;
    sessionId: string;
    currentJti: string;
    refreshFamilyId: string;
    refreshDigest: string;
    sessionExpiresAt: Date;
    refreshExpiresAt: Date;
    now: Date;
  }): Promise<
    | { kind: 'claimed'; session: ExtensionDeviceSessionSnapshot }
    | { kind: 'invalid' }
  >;
  rotateRefreshCredentialOrRevokeReuse(input: {
    refreshDigest: string;
    nextRefreshDigest: string;
    nextJti: string;
    nextRefreshExpiresAt: Date;
    now: Date;
  }): Promise<
    | { kind: 'rotated'; session: ExtensionDeviceSessionSnapshot }
    | { kind: 'reuse_revoked' }
    | { kind: 'invalid' }
  >;
}

export class ExtensionDeviceSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionDeviceSessionError';
  }
}

function normalizeIds(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeScopes(values: string[] | undefined): string[] {
  const scopes = values == null ? [...DEFAULT_EXTENSION_DEVICE_SCOPES] : normalizeIds(values);
  if (!scopes.length
    || scopes.length > EXTENSION_DEVICE_SCOPES.length
    || scopes.some((scope) => !EXTENSION_DEVICE_SCOPES.includes(scope as any))) {
    throw new ExtensionDeviceSessionError('invalid_device_scope', 400, 'Device scope is invalid');
  }
  return scopes;
}

function normalizeLabel(value: string | undefined): string | null {
  const label = String(value || '').trim();
  return label ? label.slice(0, 120) : null;
}

function randomCredential(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

function credentialDigest(secret: string, kind: 'pairing' | 'refresh', credential: string): string {
  return createHmac('sha256', secret).update(`${kind}\0${credential}`).digest('hex');
}

function issueAccessToken(session: ExtensionDeviceSessionSnapshot, authConfig: ExtensionDeviceAuthConfig): string {
  return issueExtensionDeviceAccessToken({
    sessionId: session.id,
    tokenId: session.currentJti,
    deviceId: session.deviceId,
    ownerUserId: session.ownerUserId,
    actorUserId: session.actorUserId,
    scopes: session.scopes,
  }, authConfig);
}

export function createExtensionDeviceSessionService(options: {
  repository: ExtensionDeviceSessionRepository;
  authConfig: ExtensionDeviceAuthConfig;
  now?: () => Date;
}) {
  const { repository, authConfig } = options;
  const now = options.now || (() => new Date());

  return {
    async createPairingCode(input: {
      actorUserId: string;
      ownerUserId: string;
      actorParentId: string | null;
      actorRole?: string;
      shopIds: string[];
      scopes?: string[];
      deviceLabel?: string;
      resumeSessionId?: string;
    }) {
      const actorRole = input.actorRole || 'USER';
      if (input.actorParentId
        || input.actorUserId !== input.ownerUserId
        || !['USER', 'ADMIN'].includes(actorRole)) {
        throw new ExtensionDeviceSessionError('pairing_owner_required', 403, 'Tenant owner is required');
      }
      const shopIds = normalizeIds(input.shopIds);
      const scopes = normalizeScopes(input.scopes);
      const resumeSessionId = input.resumeSessionId == null
        ? null
        : String(input.resumeSessionId).trim();
      if (resumeSessionId !== null && (!resumeSessionId || resumeSessionId.length > 200)) {
        throw new ExtensionDeviceSessionError(
          'resume_session_unavailable', 404, 'Resume session is unavailable',
        );
      }
      if (!shopIds.length || shopIds.length > 50) {
        throw new ExtensionDeviceSessionError('invalid_shop_scope', 400, 'Shop scope is required');
      }
      const createdAt = now();
      if (await repository.countOutstandingPairingCodes(input.ownerUserId, createdAt) >= OUTSTANDING_PAIRING_LIMIT) {
        throw new ExtensionDeviceSessionError('pairing_limit_reached', 429, 'Too many outstanding pairing codes');
      }
      if (!await repository.shopsBelongToOwner(input.ownerUserId, shopIds)) {
        throw new ExtensionDeviceSessionError('invalid_shop_scope', 404, 'Shop scope is unavailable');
      }

      const code = randomCredential(16);
      const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_MS);
      const row = await repository.createPairingCode({
        deploymentId: authConfig.deploymentId,
        actorUserId: input.actorUserId,
        ownerUserId: input.ownerUserId,
        codeDigest: credentialDigest(authConfig.secret, 'pairing', code),
        shopIds,
        scopes,
        deviceLabel: normalizeLabel(input.deviceLabel),
        resumeSessionId,
        expiresAt,
        createdAt,
      });
      if (row.kind === 'limit') {
        throw new ExtensionDeviceSessionError('pairing_limit_reached', 429, 'Too many outstanding pairing codes');
      }
      if (row.kind === 'invalid_resume') {
        throw new ExtensionDeviceSessionError(
          'resume_session_unavailable', 404, 'Resume session is unavailable',
        );
      }
      return {
        id: row.id,
        code,
        expiresAt,
        deploymentId: authConfig.deploymentId,
        shopIds,
        scopes,
        ...(resumeSessionId ? { resumeSessionId } : {}),
      };
    },

    async claimPairingCode(input: {
      code: string;
      deviceId: string;
      deviceLabel?: string;
      deploymentId: string;
    }) {
      if (String(input.deploymentId || '').trim() !== authConfig.deploymentId) {
        throw new ExtensionDeviceSessionError('wrong_deployment', 400, 'Pairing belongs to another deployment');
      }
      const code = String(input.code || '').trim();
      const deviceId = String(input.deviceId || '').trim();
      if (code.length < 20 || !deviceId || deviceId.length > 200) {
        throw new ExtensionDeviceSessionError('invalid_pairing_code', 400, 'Pairing code is invalid');
      }

      const claimedAt = now();
      const codeDigest = credentialDigest(authConfig.secret, 'pairing', code);
      if (!await repository.consumePairingClaimAttemptBudget({ codeDigest, deviceId, now: claimedAt })) {
        throw new ExtensionDeviceSessionError(
          'pairing_claim_rate_limited', 429, 'Pairing claim rate limit exceeded',
        );
      }
      const refreshToken = randomCredential(32);
      const result = await repository.claimPairingCodeAtomically({
        codeDigest,
        deploymentId: authConfig.deploymentId,
        deviceId,
        deviceLabel: normalizeLabel(input.deviceLabel),
        sessionId: randomUUID(),
        currentJti: randomUUID(),
        refreshFamilyId: randomUUID(),
        refreshDigest: credentialDigest(authConfig.secret, 'refresh', refreshToken),
        sessionExpiresAt: new Date(claimedAt.getTime() + SESSION_TTL_MS),
        refreshExpiresAt: new Date(claimedAt.getTime() + SESSION_TTL_MS),
        now: claimedAt,
      });
      if (result.kind !== 'claimed') {
        throw new ExtensionDeviceSessionError('invalid_pairing_code', 400, 'Pairing code is invalid');
      }
      return {
        session: result.session,
        accessToken: issueAccessToken(result.session, authConfig),
        refreshToken,
      };
    },

    async refresh(input: { refreshToken: string }) {
      const refreshToken = String(input.refreshToken || '').trim();
      if (refreshToken.length < 32) {
        throw new ExtensionDeviceSessionError('invalid_refresh_token', 401, 'Refresh credential is invalid');
      }
      const refreshedAt = now();
      const nextRefreshToken = randomCredential(32);
      const result = await repository.rotateRefreshCredentialOrRevokeReuse({
        refreshDigest: credentialDigest(authConfig.secret, 'refresh', refreshToken),
        nextRefreshDigest: credentialDigest(authConfig.secret, 'refresh', nextRefreshToken),
        nextJti: randomUUID(),
        nextRefreshExpiresAt: new Date(refreshedAt.getTime() + SESSION_TTL_MS),
        now: refreshedAt,
      });
      if (result.kind === 'reuse_revoked') {
        throw new ExtensionDeviceSessionError('refresh_reuse_detected', 401, 'Refresh credential reuse detected');
      }
      if (result.kind !== 'rotated') {
        throw new ExtensionDeviceSessionError('invalid_refresh_token', 401, 'Refresh credential is invalid');
      }
      return {
        session: result.session,
        accessToken: issueAccessToken(result.session, authConfig),
        refreshToken: nextRefreshToken,
      };
    },
  };
}
