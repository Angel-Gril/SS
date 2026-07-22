import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  getConfig,
  getDefaultValue,
  getStrictConfig,
  SystemConfigSchema,
  type SystemConfigKey,
  type SystemConfigValue,
} from '../config/system-config-schema.js';
import { getRuntimeMode } from '../adapters/runtime-config.js';
import { redis } from './redis.js';

export type HumanChallengeProvider = 'disabled' | 'cloudflare-turnstile' | 'builtin-pow';
export type HumanChallengeAction = 'login' | 'sms_login' | 'register_sms' | 'password_reset_sms' | 'admin_login';

const ACTIONS = new Set<HumanChallengeAction>(['login', 'sms_login', 'register_sms', 'password_reset_sms', 'admin_login']);
export interface HumanChallengeRuntimeConfig {
  provider: HumanChallengeProvider;
  providerConfigValid: boolean;
  difficulty: number;
  ttlSeconds: number;
  signingSecret: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  allowedHostnames: string[];
  hostnameConfigValid: boolean;
  source: 'env' | 'system-config';
}

function isProvider(value: unknown): value is HumanChallengeProvider {
  return value === 'cloudflare-turnstile' || value === 'builtin-pow' || value === 'disabled';
}

async function readConfig<K extends SystemConfigKey>(key: K): Promise<SystemConfigValue<K>> {
  try {
    return await getConfig(key);
  } catch {
    return getDefaultValue(key);
  }
}

function splitCsv(value: string): string[] {
  return [...new Set(value.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

async function readProviderConfig(): Promise<{ value: HumanChallengeProvider; valid: boolean }> {
  try {
    return { value: await getStrictConfig('auth_human_challenge_provider'), valid: true };
  } catch (error) {
    console.error(`[human-challenge] invalid provider configuration: ${String(error)}`);
    return { value: 'disabled', valid: false };
  }
}

async function readAllowedHostnamesConfig(): Promise<{ value: string; valid: boolean }> {
  try {
    return { value: await getStrictConfig('auth_turnstile_allowed_hostnames'), valid: true };
  } catch (error) {
    console.error(`[human-challenge] invalid Turnstile hostname allowlist: ${String(error)}`);
    return { value: '', valid: false };
  }
}

export async function getHumanChallengeRuntimeConfig(): Promise<HumanChallengeRuntimeConfig> {
  const rawEnvProvider = process.env.HUMAN_CHALLENGE_PROVIDER;
  const hasExplicitEnvProvider = typeof rawEnvProvider === 'string' && rawEnvProvider.trim().length > 0;
  const legacyEnvTurnstileEnabled = process.env.FEATURE_TURNSTILE_LOGIN === 'true';
  const hasEnvProvider = hasExplicitEnvProvider || legacyEnvTurnstileEnabled;
  const [dbProvider, legacyTurnstileEnabled, dbSecret, dbDifficulty, dbTtl, dbHostnames, dbSiteKey, dbTurnstileSecret] = await Promise.all([
    readProviderConfig(), readConfig('feature_turnstile_login'), readConfig('auth_pow_signing_secret'),
    readConfig('auth_pow_difficulty'), readConfig('auth_pow_ttl_seconds'),
    readAllowedHostnamesConfig(), readConfig('auth_turnstile_site_key'),
    readConfig('auth_turnstile_secret_key'),
  ]);
  const configuredProvider = hasExplicitEnvProvider
    ? isProvider(rawEnvProvider) ? rawEnvProvider : 'disabled'
    : legacyEnvTurnstileEnabled
      ? 'cloudflare-turnstile'
      : legacyTurnstileEnabled && dbProvider.value === 'disabled'
        ? 'cloudflare-turnstile'
        : dbProvider.value;
  const runtimeMode = getRuntimeMode();
  const provider = runtimeMode === 'cloud' ? configuredProvider : 'disabled';
  const providerConfigValid = runtimeMode !== 'cloud'
    || (hasExplicitEnvProvider ? isProvider(rawEnvProvider) : legacyEnvTurnstileEnabled || dbProvider.valid);
  const rawEnvHostnames = process.env.TURNSTILE_ALLOWED_HOSTNAMES || '';
  const hasEnvHostnames = rawEnvHostnames.trim().length > 0;
  const rawAllowedHostnames = hasEnvHostnames ? rawEnvHostnames : dbHostnames.value;
  const parsedAllowedHostnames = SystemConfigSchema.auth_turnstile_allowed_hostnames.safeParse(rawAllowedHostnames);
  const hostnameConfigValid = (hasEnvHostnames || dbHostnames.valid) && parsedAllowedHostnames.success;
  return {
    provider,
    providerConfigValid,
    difficulty: Math.min(5, Math.max(1, Number(process.env.HUMAN_CHALLENGE_POW_DIFFICULTY || dbDifficulty))),
    ttlSeconds: Math.min(600, Math.max(30, Number(process.env.HUMAN_CHALLENGE_TTL_SECONDS || dbTtl))),
    signingSecret: process.env.HUMAN_CHALLENGE_SIGNING_SECRET || dbSecret || '',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || dbSiteKey,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || dbTurnstileSecret,
    allowedHostnames: hostnameConfigValid ? splitCsv(rawAllowedHostnames) : [],
    hostnameConfigValid,
    source: hasEnvProvider ? 'env' : 'system-config',
  };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function issueHumanChallenge(action: HumanChallengeAction) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported human challenge action');
  const config = await getHumanChallengeRuntimeConfig();
  if (!config.providerConfigValid) throw new Error('HUMAN_CHALLENGE_PROVIDER configuration is invalid');
  const selected = config.provider;
  if (selected === 'cloudflare-turnstile'
    && (!config.hostnameConfigValid || config.allowedHostnames.length === 0)) {
    throw new Error('TURNSTILE_ALLOWED_HOSTNAMES configuration is invalid or empty');
  }
  if (selected !== 'builtin-pow') return { provider: selected, action };
  if (config.signingSecret.length < 32) throw new Error('HUMAN_CHALLENGE_SIGNING_SECRET must contain at least 32 characters');
  const payload = Buffer.from(JSON.stringify({
    v: 1, action, challenge: randomBytes(24).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + config.ttlSeconds,
    jti: randomBytes(16).toString('base64url'), difficulty: config.difficulty,
  })).toString('base64url');
  const token = `${payload}.${sign(payload, config.signingSecret)}`;
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return { provider: selected, action, token, challenge: parsed.challenge, difficulty: config.difficulty, expiresInSeconds: config.ttlSeconds };
}

export async function verifyHumanChallenge(input: { action: HumanChallengeAction; token: string; ip?: string }): Promise<boolean> {
  const config = await getHumanChallengeRuntimeConfig();
  const selected = config.provider;
  if (!config.providerConfigValid) return false;
  if (selected === 'disabled') return true;
  if (!input.token) return false;
  if (selected === 'cloudflare-turnstile') return verifyTurnstile(input, config);
  const [payload, signature, nonce, extra] = input.token.split('.');
  if (!payload || !signature || nonce === undefined || extra !== undefined) return false;
  if (config.signingSecret.length < 32) return false;
  const expected = sign(payload, config.signingSecret);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { action: string; challenge: string; exp: number; jti: string; difficulty: number };
    if (data.action !== input.action || data.exp < Math.floor(Date.now() / 1000) || !ACTIONS.has(data.action as HumanChallengeAction)) return false;
    const proof = createHash('sha256').update(`${payload}.${signature}:${nonce}`).digest('hex');
    if (!proof.startsWith('0'.repeat(data.difficulty)) || data.difficulty !== config.difficulty) return false;
    return await redis.set(`human-challenge:used:${data.jti}`, '1', 'EX', config.ttlSeconds, 'NX') === 'OK';
  } catch { return false; }
}

async function verifyTurnstile(input: { action: HumanChallengeAction; token: string; ip?: string }, config: HumanChallengeRuntimeConfig): Promise<boolean> {
  const secret = config.turnstileSecretKey;
  if (!secret || !config.hostnameConfigValid) return false;
  try {
    const body = new URLSearchParams({ secret, response: input.token, ...(input.ip ? { remoteip: input.ip } : {}) });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const data = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const allowed = config.allowedHostnames;
    const responseHostname = String(data.hostname || '').trim().toLowerCase();
    return data.success === true
      && data.action === input.action
      && allowed.length > 0
      && allowed.includes(responseHostname);
  } catch { return false; }
}

export async function getPublicHumanChallengeConfig() {
  const config = await getHumanChallengeRuntimeConfig();
  return { humanChallengeProvider: config.provider, turnstileSiteKey: config.provider === 'cloudflare-turnstile' ? config.turnstileSiteKey : '', powDifficulty: config.difficulty, powTtlSeconds: config.ttlSeconds };
}
