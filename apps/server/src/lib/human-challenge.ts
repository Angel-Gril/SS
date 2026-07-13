import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig, getDefaultValue, type SystemConfigKey, type SystemConfigValue } from '../config/system-config-schema.js';
import { getRuntimeMode } from '../adapters/runtime-config.js';
import { redis } from './redis.js';

export type HumanChallengeProvider = 'disabled' | 'cloudflare-turnstile' | 'builtin-pow';
export type HumanChallengeAction = 'login' | 'register_sms' | 'password_reset_sms' | 'admin_login';

const ACTIONS = new Set<HumanChallengeAction>(['login', 'register_sms', 'password_reset_sms', 'admin_login']);

export interface HumanChallengeRuntimeConfig {
  provider: HumanChallengeProvider;
  difficulty: number;
  ttlSeconds: number;
  signingSecret: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  allowedHostnames: string[];
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
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export async function getHumanChallengeRuntimeConfig(): Promise<HumanChallengeRuntimeConfig> {
  const envProvider = process.env.HUMAN_CHALLENGE_PROVIDER;
  const hasEnvProvider = isProvider(envProvider) || process.env.FEATURE_TURNSTILE_LOGIN === 'true';
  const [dbProvider, legacyTurnstileEnabled, dbSecret, dbDifficulty, dbTtl, dbHostnames, dbSiteKey, dbTurnstileSecret] = await Promise.all([
    readConfig('auth_human_challenge_provider'), readConfig('feature_turnstile_login'), readConfig('auth_pow_signing_secret'),
    readConfig('auth_pow_difficulty'), readConfig('auth_pow_ttl_seconds'),
    readConfig('auth_turnstile_allowed_hostnames'), readConfig('auth_turnstile_site_key'),
    readConfig('auth_turnstile_secret_key'),
  ]);
  const configuredProvider = isProvider(envProvider)
    ? envProvider
    : process.env.FEATURE_TURNSTILE_LOGIN === 'true' ? 'cloudflare-turnstile' : legacyTurnstileEnabled && dbProvider === 'disabled' ? 'cloudflare-turnstile' : dbProvider;
  const provider = getRuntimeMode() === 'cloud' ? configuredProvider : 'disabled';
  return {
    provider,
    difficulty: Math.min(5, Math.max(1, Number(process.env.HUMAN_CHALLENGE_POW_DIFFICULTY || dbDifficulty))),
    ttlSeconds: Math.min(600, Math.max(30, Number(process.env.HUMAN_CHALLENGE_TTL_SECONDS || dbTtl))),
    signingSecret: process.env.HUMAN_CHALLENGE_SIGNING_SECRET || dbSecret || '',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || dbSiteKey,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || dbTurnstileSecret,
    allowedHostnames: splitCsv(process.env.TURNSTILE_ALLOWED_HOSTNAMES || dbHostnames),
    source: hasEnvProvider ? 'env' : 'system-config',
  };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function issueHumanChallenge(action: HumanChallengeAction) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported human challenge action');
  const config = await getHumanChallengeRuntimeConfig();
  const selected = config.provider;
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
  if (!secret) return false;
  try {
    const body = new URLSearchParams({ secret, response: input.token, ...(input.ip ? { remoteip: input.ip } : {}) });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const data = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const allowed = config.allowedHostnames;
    return data.success === true && data.action === input.action && (allowed.length === 0 || (!!data.hostname && allowed.includes(data.hostname)));
  } catch { return false; }
}

export async function getPublicHumanChallengeConfig() {
  const config = await getHumanChallengeRuntimeConfig();
  return { humanChallengeProvider: config.provider, turnstileSiteKey: config.provider === 'cloudflare-turnstile' ? config.turnstileSiteKey : '', powDifficulty: config.difficulty, powTtlSeconds: config.ttlSeconds };
}
