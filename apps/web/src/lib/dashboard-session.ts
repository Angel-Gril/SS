import type { AuthUser } from 'shared';
import { api, ApiRequestTimeoutError, type ApiRequestOptions } from '@/lib/api';

export type DashboardSessionResult =
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unavailable'; reason: 'timeout' | 'network' | 'maintenance' | 'response' }
  | { status: 'cancelled' };

/** A failed read cannot prove logout or grant access to the protected layout. */
export async function loadDashboardSession(options: ApiRequestOptions = {}): Promise<DashboardSessionResult> {
  try {
    const response = await api.get<AuthUser>('/api/user/me', options);
    if (options.signal?.aborted) return { status: 'cancelled' };
    const user = response.data;
    if (response.code === 1 && user && !Array.isArray(user)
      && typeof user.id === 'string' && user.id.trim().length > 0
      && (user.role === 'ADMIN' || user.role === 'USER' || user.role === 'STAFF')) {
      return { status: 'authenticated', user };
    }
    return { status: 'unavailable', reason: response.maintenance ? 'maintenance' : 'response' };
  } catch (error) {
    if (options.signal?.aborted) return { status: 'cancelled' };
    return { status: 'unavailable', reason: error instanceof ApiRequestTimeoutError ? 'timeout' : 'network' };
  }
}
