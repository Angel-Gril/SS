import { getLegalProfile, type LegalProfile, type LegalProfileId } from 'shared';

const LEGAL_PROFILE_IDS = new Set<LegalProfileId>([
  'local',
  'cloud-cn',
  'cloud-global',
  'self-hosted',
]);

function isLegalProfileId(value: string): value is LegalProfileId {
  return LEGAL_PROFILE_IDS.has(value as LegalProfileId);
}

export function resolveLegalProfileId(options: {
  configuredProfile?: string | null;
  hostname?: string | null;
  runtimeMode?: string | null;
} = {}): LegalProfileId {
  const configuredProfile = String(options.configuredProfile || '').trim().toLowerCase();
  if (isLegalProfileId(configuredProfile)) return configuredProfile;

  const hostname = String(options.hostname || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  if (hostname === 'ss-erp.cn' || hostname.endsWith('.ss-erp.cn')) return 'cloud-cn';
  if (hostname === 'ss-erp.com' || hostname.endsWith('.ss-erp.com')) return 'cloud-global';
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return 'local';

  return options.runtimeMode === 'cloud' ? 'cloud-global' : 'local';
}

export function getWebLegalProfile(hostname?: string | null): LegalProfile {
  return getLegalProfile(resolveLegalProfileId({
    configuredProfile: process.env.NEXT_PUBLIC_LEGAL_PROFILE || process.env.LEGAL_PROFILE,
    hostname,
    runtimeMode: process.env.NEXT_PUBLIC_RUNTIME_MODE,
  }));
}
