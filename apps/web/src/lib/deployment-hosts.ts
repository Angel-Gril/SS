const INTERNATIONAL_DEFAULTS = {
  userHostname: 'app.ss-erp.com',
  adminHostname: 'admin.ss-erp.com',
  marketingHostname: 'ss-erp.com',
} as const;

function normalizeHostname(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const configuredUserHostname = normalizeHostname(process.env.NEXT_PUBLIC_USER_HOSTNAME);

export const deploymentHosts = Object.freeze({
  userHostname: configuredUserHostname || INTERNATIONAL_DEFAULTS.userHostname,
  adminHostname: normalizeHostname(process.env.NEXT_PUBLIC_ADMIN_HOSTNAME) || INTERNATIONAL_DEFAULTS.adminHostname,
  marketingHostname: normalizeHostname(process.env.NEXT_PUBLIC_MARKETING_HOSTNAME) || INTERNATIONAL_DEFAULTS.marketingHostname,
});

export const deploymentHostMode = Object.freeze({
  splitAdmin: deploymentHosts.adminHostname !== deploymentHosts.userHostname,
  splitMarketing: deploymentHosts.marketingHostname !== deploymentHosts.userHostname
    && deploymentHosts.marketingHostname !== deploymentHosts.adminHostname,
});

export function resolvePublicAppHostname(runtimeMode: string | undefined): string {
  return (configuredUserHostname || runtimeMode === 'cloud') ? deploymentHosts.userHostname : '';
}

export function resolveCrossDeploymentHref(
  currentHostname: string,
  sourceHostname: string,
  targetHostname: string,
  pathname: string,
): string {
  const current = normalizeHostname(currentHostname);
  if (!current || current !== sourceHostname || sourceHostname === targetHostname) return pathname;
  return `https://${targetHostname}${pathname}`;
}

export function deploymentOrigin(hostname: string): string {
  return hostname ? `https://${hostname}` : '';
}
