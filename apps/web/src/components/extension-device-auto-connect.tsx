import { useEffect } from 'react';
import { api, getApiBase } from '@/lib/api';
import { sendToExtension } from '@/lib/extension-device-bridge';
import {
  equalStringSets,
  singleActiveOzonShopIds,
} from '@/lib/extension-device-pairing';

interface ShopOption {
  id: string;
  platform: string;
  status?: string;
}

interface PairingCode {
  id: string;
  code: string;
  deploymentId: string;
}

interface DeviceSession {
  id: string;
  status: string;
  shopIds: string[];
  scopes: string[];
}

interface ExtensionDeviceStatus {
  state: 'paired' | 'authorization_required' | 'invalid' | 'unreachable' | 'unconfigured';
  sessionId?: string;
  ownerUserId?: string;
}

const extensionDeviceAuthEnabled =
  process.env.NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED === 'true';
const AUTO_CONNECT_SCOPES = ['capture:write'];
const AUTO_CONNECT_LOCK_NAME = 'ss-erp:extension-device-auto-connect:v1';
const AUTO_CONNECT_ATTEMPT_KEY = 'ss-erp:extension-device-auto-connect-at:v1';
const AUTO_CONNECT_COOLDOWN_MS = 30_000;

function recentlyAttempted(): boolean {
  try {
    const lastAttempt = Number(window.localStorage.getItem(AUTO_CONNECT_ATTEMPT_KEY)) || 0;
    return lastAttempt > 0 && Date.now() - lastAttempt < AUTO_CONNECT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function rememberAttempt(): void {
  try {
    window.localStorage.setItem(AUTO_CONNECT_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // A storage-denied page may still complete one bounded attempt under the Web Lock.
  }
}

async function cancelPairingCode(pairingCodeId: string): Promise<void> {
  try {
    await api.delete('/api/extension-device/pairing-codes/' + encodeURIComponent(pairingCodeId));
  } catch {
    // A successfully consumed one-time code is already closed server-side.
  }
}

export async function runAutoConnect(cancelled: () => boolean): Promise<void> {
  const statusResponse = await sendToExtension<ExtensionDeviceStatus>({
    type: 'ss-erp:extension-device-status',
    verify: true,
  }, 8000);
  if (cancelled() || !statusResponse.ok || !statusResponse.data) return;
  const status = statusResponse.data;
  if (status.state !== 'authorization_required' || status.ownerUserId) return;
  if (recentlyAttempted()) return;
  rememberAttempt();

  const [shopResponse, userResponse] = await Promise.all([
    api.get<ShopOption[]>('/api/shops'),
    api.get<{ id: string }>('/api/user/me'),
  ]);
  if (cancelled() || shopResponse.code !== 1 || !Array.isArray(shopResponse.data)
    || userResponse.code !== 1 || !userResponse.data) return;
  const ownerUserId = String(userResponse.data.id || '').trim();
  const shopIds = singleActiveOzonShopIds(shopResponse.data);
  if (!ownerUserId || !shopIds.length) return;

  const pairingResponse = await api.post<PairingCode>('/api/extension-device/pairing-codes', {
    shopIds,
    scopes: AUTO_CONNECT_SCOPES,
    deviceLabel: 'Chrome 自动连接',
  });
  if (pairingResponse.code !== 1 || !pairingResponse.data) return;
  const pairing = pairingResponse.data;
  try {
    if (cancelled()) return;
    await sendToExtension<ExtensionDeviceStatus>({
      type: 'ss-erp:extension-device-claim',
      baseUrl: getApiBase(),
      deploymentId: pairing.deploymentId,
      code: pairing.code,
      deviceLabel: 'Chrome 自动连接',
      onlyIfAuthorizationRequired: true,
    }, 10_000);
    if (cancelled()) return;

    const [claimedResponse, sessionsResponse] = await Promise.all([
      sendToExtension<ExtensionDeviceStatus>({
        type: 'ss-erp:extension-device-status',
        verify: true,
      }, 8000),
      api.get<DeviceSession[]>('/api/extension-device/sessions'),
    ]);
    const claimedStatus = claimedResponse.data;
    const sessions = sessionsResponse.code === 1 && Array.isArray(sessionsResponse.data)
      ? sessionsResponse.data
      : [];
    const claimedSession = sessions.find((session) => session.id === claimedStatus?.sessionId);
    if (!cancelled() && claimedResponse.ok && claimedStatus?.state === 'paired'
      && claimedStatus.ownerUserId === ownerUserId
      && claimedSession?.status === 'ACTIVE'
      && equalStringSets(claimedSession.shopIds, shopIds)
      && equalStringSets(claimedSession.scopes, AUTO_CONNECT_SCOPES)) {
      window.dispatchEvent(new CustomEvent('ss-erp:extension-device-connected'));
    }
  } finally {
    await cancelPairingCode(pairing.id);
  }
}

export async function runWithAutoConnectLock(task: () => Promise<void>): Promise<void> {
  if (navigator.locks && typeof navigator.locks.request === 'function') {
    await navigator.locks.request(
      AUTO_CONNECT_LOCK_NAME,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock) await task();
      },
    );
    return;
  }
  await task();
}

export function ExtensionDeviceAutoConnect() {
  useEffect(() => {
    if (!extensionDeviceAuthEnabled) return undefined;
    let disposed = false;
    let running = false;
    const connect = () => {
      if (disposed || running) return;
      running = true;
      void runWithAutoConnectLock(() => runAutoConnect(() => disposed))
        .catch(() => {
          // Silent bootstrap is best-effort; the explicit pairing dialog remains the recovery path.
        })
        .finally(() => {
          running = false;
        });
    };
    const onBridgeReady = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      const bridgeEvent = data?.event as Record<string, unknown> | undefined;
      if (data?.direction === 'ss-erp:from-extension'
        && data.broadcast === true
        && bridgeEvent?.type === 'ss-erp:extension-bridge-ready') {
        connect();
      }
    };
    window.addEventListener('message', onBridgeReady);
    connect();
    return () => {
      disposed = true;
      window.removeEventListener('message', onBridgeReady);
    };
  }, []);
  return null;
}
