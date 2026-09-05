type RuntimeEnvironment = Record<string, string | undefined>;

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function assertRuntimeModeSafety(environment: RuntimeEnvironment): void {
  const productionOrCloud = environment.NODE_ENV === 'production'
    || environment.RUNTIME_MODE === 'cloud';
  if (!productionOrCloud) return;

  if (isEnabled(environment.REDIS_DISABLED)) {
    throw new Error('REDIS_DISABLED is not allowed in production or cloud runtime');
  }
  if (!String(environment.REDIS_URL || '').trim()) {
    throw new Error('REDIS_URL is required in production or cloud runtime');
  }
}
