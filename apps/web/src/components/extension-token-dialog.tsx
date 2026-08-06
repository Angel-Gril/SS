'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Cable, Check, Copy, Key, Loader2, MonitorUp, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { api, getApiBase, type ApiResponse } from '@/lib/api';
import { equalStringSets } from '@/lib/extension-device-pairing';

interface ExtensionTokenDialogProps {
  trigger?: React.ReactNode;
}

interface ShopOption {
  id: string;
  name: string;
  platform: string;
  status?: string;
}

interface PairingCode {
  id: string;
  code: string;
  deploymentId: string;
  expiresAt: string;
  shopIds: string[];
  scopes: string[];
}

interface DeviceSession {
  id: string;
  deviceId: string;
  deviceLabel: string | null;
  status: string;
  shopIds: string[];
  scopes: string[];
  expiresAt: string;
  lastSeenAt: string | null;
  createdAt: string;
}

interface ExtensionDeviceStatus {
  state: 'paired' | 'authorization_required' | 'invalid' | 'unreachable' | 'unconfigured';
  version?: string;
  endpoint?: string;
  sessionId?: string;
  deploymentId?: string;
  deviceId?: string;
  ownerUserId?: string;
  scopes?: string[];
  expiresAt?: string;
}

interface ExtensionBridgeResponse {
  ok?: boolean;
  data?: ExtensionDeviceStatus;
  error?: string;
}

type View = 'pairing' | 'legacy';
type CopyTarget = 'url' | 'deployment' | 'code' | 'token' | null;

const logisticsDistributionEnabled =
  process.env.NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED === 'true';
const extensionDeviceAuthEnabled =
  process.env.NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED === 'true' ||
  logisticsDistributionEnabled;

const DEVICE_SCOPE_OPTIONS = [
  { value: 'logistics:discover', label: '物流发现' },
  { value: 'logistics:read', label: '物流读取' },
  { value: 'logistics:receipt', label: '物流回执' },
  { value: 'logistics:capture', label: '物流采集' },
  { value: 'capture:write', label: '来源采集' },
  { value: 'listing:write', label: '草稿编辑' },
  { value: 'listing:review', label: '草稿审核' },
  { value: 'media:execute', label: 'AI 媒体执行' },
  { value: 'byok:media:ingest', label: 'BYOK 图片接收' },
  { value: 'listing:publish', label: 'Ozon 发布', highRisk: true },
] as const;

const DEFAULT_DEVICE_SCOPES = [
  'capture:write',
  'listing:write',
  'listing:review',
  'media:execute',
];

function responseErrorCode(response: ApiResponse<unknown>): string {
  const value = response as unknown as Record<string, unknown>;
  const error =
    value.error && typeof value.error === 'object' ? (value.error as Record<string, unknown>) : {};
  return String(value.errorCode || error.code || 'REQUEST_FAILED');
}

function shortDeviceId(value: string): string {
  return value.length > 18 ? value.slice(0, 8) + '...' + value.slice(-6) : value;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function endpointHost(value?: string): string {
  if (!value) return '';
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//u, '').replace(/\/+$/u, '');
  }
}

function deviceGrantMismatch(input: {
  status: ExtensionDeviceStatus | null;
  session: DeviceSession | null;
  ownerUserId: string;
  shopIds: string[];
  scopes: string[];
}): boolean {
  const { status, session, ownerUserId, shopIds, scopes } = input;
  if (status?.state !== 'paired' || !ownerUserId || status.ownerUserId !== ownerUserId) return false;
  if (!equalStringSets(status.scopes || [], scopes)) return true;
  if (!session || session.id !== status.sessionId) return true;
  if (!equalStringSets(session.scopes, scopes)) return true;
  if (!shopIds.length) return false;
  return !equalStringSets(session.shopIds, shopIds);
}

function claimedStatusMatches(
  status: ExtensionDeviceStatus | null | undefined,
  session: DeviceSession | null | undefined,
  input: {
    ownerUserId: string;
    replacedSessionId: string;
    shopIds: string[];
    scopes: string[];
  },
): status is ExtensionDeviceStatus & { state: 'paired' } {
  const { ownerUserId, replacedSessionId, shopIds, scopes } = input;
  if (status?.state !== 'paired' || status.ownerUserId !== ownerUserId
    || !status.sessionId || (replacedSessionId && status.sessionId === replacedSessionId)
    || !session || session.id !== status.sessionId || session.status !== 'ACTIVE') return false;
  return equalStringSets(status.scopes || [], scopes)
    && equalStringSets(session.scopes, scopes)
    && equalStringSets(session.shopIds, shopIds);
}

export function ExtensionTokenDialog({ trigger }: ExtensionTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(extensionDeviceAuthEnabled ? 'pairing' : 'legacy');
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(DEFAULT_DEVICE_SCOPES);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [currentOwnerUserId, setCurrentOwnerUserId] = useState('');
  const [loadingContext, setLoadingContext] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [extensionConnection, setExtensionConnection] = useState<
    'checking' | 'unavailable' | 'unpaired' | 'paired' | 'error'
  >('checking');
  const [extensionConnectionDetail, setExtensionConnectionDetail] = useState('');
  const [extensionDeviceStatus, setExtensionDeviceStatus] = useState<ExtensionDeviceStatus | null>(
    null,
  );
  const [revokingId, setRevokingId] = useState('');
  const [token, setToken] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState('');
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyDisabled, setLegacyDisabled] = useState(false);
  const [copied, setCopied] = useState<CopyTarget>(null);
  const pairingGenerationRef = useRef(0);
  const hydratedSessionRef = useRef('');

  const erpUrl = typeof window !== 'undefined' ? getApiBase() : '';
  const shopNameById = useMemo(() => new Map(shops.map((shop) => [shop.id, shop.name])), [shops]);
  const currentDeviceSession = useMemo(
    () => sessions.find((session) => session.id === extensionDeviceStatus?.sessionId) || null,
    [extensionDeviceStatus?.sessionId, sessions],
  );
  const extensionNeedsAuthorization = deviceGrantMismatch({
    status: extensionDeviceStatus,
    session: currentDeviceSession,
    ownerUserId: currentOwnerUserId,
    shopIds: selectedShopIds,
    scopes: selectedScopes,
  });
  const pairingSelectionLocked = connecting || pairingBusy || Boolean(pairing);
  const pairingFields: Array<[label: string, value: string, target: Exclude<CopyTarget, null>]> =
    pairing
      ? [
          ['ERP 地址', erpUrl, 'url'],
          ['部署标识', pairing.deploymentId, 'deployment'],
          ['配对码', pairing.code, 'code'],
        ]
      : [];

  function beginPairingGeneration(): number {
    pairingGenerationRef.current += 1;
    return pairingGenerationRef.current;
  }

  function isCurrentPairingGeneration(generation: number): boolean {
    return pairingGenerationRef.current === generation;
  }

  function handleOpenChange(nextOpen: boolean) {
    beginPairingGeneration();
    if (nextOpen) hydratedSessionRef.current = '';
    if (!nextOpen) {
      setLoadingContext(false);
      setPairingBusy(false);
      setConnecting(false);
    }
    setOpen(nextOpen);
  }

  function sendToExtension(
    message: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<ExtensionBridgeResponse> {
    if (typeof window === 'undefined') {
      return Promise.resolve({ ok: false, error: '当前环境无法连接扩展' });
    }
    const requestId = `extension-device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (response: ExtensionBridgeResponse) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        window.clearTimeout(timer);
        resolve(response);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.direction !== 'ss-erp:from-extension' || data.requestId !== requestId) return;
        finish((data.response || { ok: false, error: '扩展未返回结果' }) as ExtensionBridgeResponse);
      };
      const timer = window.setTimeout(() => {
        finish({ ok: false, error: '未检测到 SS ERP 扩展，请确认已安装并刷新当前页面' });
      }, timeoutMs);
      window.addEventListener('message', onMessage);
      window.postMessage({
        direction: 'ss-erp:to-extension',
        requestId,
        message,
      }, window.location.origin);
    });
  }

  function showConnectedExtension(status: ExtensionDeviceStatus, generation: number) {
    if (!isCurrentPairingGeneration(generation)) return;
    setExtensionDeviceStatus(status);
    setExtensionConnection('paired');
    const host = endpointHost(status.endpoint);
    setExtensionConnectionDetail(
      `设备已连接${host ? ` · ${host}` : ''}${status.version ? ` · v${status.version}` : ''}`,
    );
  }

  async function detectExtensionConnection(
    ownerUserId: string,
    generation: number,
    updateUi = true,
  ) {
    if (!isCurrentPairingGeneration(generation)) return null;
    if (updateUi) {
      setExtensionConnection('checking');
      setExtensionConnectionDetail('正在检测当前浏览器扩展...');
    }
    const response = await sendToExtension({
      type: 'ss-erp:extension-device-status',
      verify: true,
    }, 8000);
    if (!isCurrentPairingGeneration(generation)) return null;
    if (!response.ok || !response.data) {
      if (updateUi) {
        setExtensionDeviceStatus(null);
        setExtensionConnection('unavailable');
        setExtensionConnectionDetail(response.error || '未检测到 SS ERP 扩展');
      }
      return null;
    }
    if (!updateUi) return response.data;
    setExtensionDeviceStatus(response.data);
    const host = endpointHost(response.data.endpoint);
    if (response.data.state === 'paired') {
      if (ownerUserId && response.data.ownerUserId !== ownerUserId) {
        setExtensionConnection('error');
        setExtensionConnectionDetail(
          `当前扩展已连接其他 ERP 账号${host ? ` · ${host}` : ''}，请先解除配对`,
        );
      } else {
        showConnectedExtension(response.data, generation);
      }
    } else if (response.data.state === 'invalid') {
      setExtensionConnection('error');
      setExtensionConnectionDetail(
        `原设备授权已失效${host ? ` · ${host}` : ''}，请重新连接`,
      );
    } else if (response.data.state === 'unreachable') {
      setExtensionConnection('error');
      setExtensionConnectionDetail(
        `暂时无法验证设备授权${host ? ` · ${host}` : ''}，请检查网络后重试`,
      );
    } else if (response.data.state === 'authorization_required') {
      setExtensionConnection('unpaired');
      setExtensionConnectionDetail(
        `已检测 ERP${host ? ` · ${host}` : ''}，等待当前账号授权`,
      );
    } else {
      setExtensionConnection('unpaired');
      setExtensionConnectionDetail(
        `已检测到扩展${response.data.version ? ` · v${response.data.version}` : ''}，等待连接 ERP`,
      );
    }
    return response.data;
  }

  async function loadPairingContext(generation: number): Promise<string> {
    if (!isCurrentPairingGeneration(generation)) return '';
    setLoadingContext(true);
    let ownerUserId = '';
    try {
      const [shopResponse, sessionResponse, userResponse] = await Promise.all([
        api.get<ShopOption[]>('/api/shops'),
        api.get<DeviceSession[]>('/api/extension-device/sessions'),
        api.get<{ id: string }>('/api/user/me'),
      ]);
      const ozonShops =
        shopResponse.code === 1 && Array.isArray(shopResponse.data)
          ? shopResponse.data.filter(
              (shop) => shop.platform === 'OZON' && shop.status !== 'DISABLED',
            )
          : [];
      if (!isCurrentPairingGeneration(generation)) return '';
      setShops(ozonShops);
      setSelectedShopIds((current) => {
        const allowed = current.filter((id) => ozonShops.some((shop) => shop.id === id));
        if (allowed.length) return allowed;
        return ozonShops.length === 1 ? [ozonShops[0]!.id] : [];
      });
      setSessions(
        sessionResponse.code === 1 && Array.isArray(sessionResponse.data)
          ? sessionResponse.data
          : [],
      );
      ownerUserId = userResponse.code === 1 && userResponse.data
        ? String(userResponse.data.id || '')
        : '';
      setCurrentOwnerUserId(ownerUserId);
    } catch (error) {
      if (!isCurrentPairingGeneration(generation)) return '';
      toast({
        title: '设备连接信息读取失败',
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPairingGeneration(generation)) setLoadingContext(false);
    }
    return ownerUserId;
  }

  async function refreshDeviceSessions(generation: number): Promise<DeviceSession[] | null> {
    const response = await api.get<DeviceSession[]>('/api/extension-device/sessions');
    if (!isCurrentPairingGeneration(generation)) return null;
    if (response.code !== 1 || !Array.isArray(response.data)) {
      throw new Error(response.msg || responseErrorCode(response));
    }
    setSessions(response.data);
    return response.data;
  }

  function refreshPairingContext() {
    const generation = beginPairingGeneration();
    void loadPairingContext(generation)
      .then((ownerUserId) => detectExtensionConnection(ownerUserId, generation));
  }

  function refreshExtensionDetection() {
    const generation = beginPairingGeneration();
    void detectExtensionConnection(currentOwnerUserId, generation);
  }

  useEffect(() => {
    if (open && extensionDeviceAuthEnabled) {
      const generation = beginPairingGeneration();
      void loadPairingContext(generation)
        .then((ownerUserId) => detectExtensionConnection(ownerUserId, generation));
      return () => {
        if (isCurrentPairingGeneration(generation)) beginPairingGeneration();
      };
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    const status = extensionDeviceStatus;
    const session = currentDeviceSession;
    if (!open || loadingContext || pairingSelectionLocked
      || status?.state !== 'paired' || !session || session.status !== 'ACTIVE'
      || status.ownerUserId !== currentOwnerUserId || status.sessionId !== session.id
      || !equalStringSets(status.scopes || [], session.scopes)
      || session.shopIds.some((id) => !shops.some((shop) => shop.id === id))
      || hydratedSessionRef.current === session.id) return;
    hydratedSessionRef.current = session.id;
    setSelectedShopIds(session.shopIds.slice());
    setSelectedScopes(session.scopes.slice());
  }, [
    currentDeviceSession,
    currentOwnerUserId,
    extensionDeviceStatus,
    loadingContext,
    open,
    pairingSelectionLocked,
    shops,
  ]);

  function toggleShop(shopId: string) {
    setSelectedShopIds((current) => {
      if (current.includes(shopId)) return current.filter((id) => id !== shopId);
      if (current.length >= 50) {
        toast({
          title: '单个设备最多授权 50 个店铺',
          description: '请先取消部分已选店铺。',
          variant: 'destructive',
        });
        return current;
      }
      return [...current, shopId];
    });
  }

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  }

  function validatePairingSelection(): boolean {
    if (!selectedShopIds.length) {
      toast({
        title: '请选择 Ozon 店铺',
        description: '设备权限必须限定到至少一个店铺。',
        variant: 'destructive',
      });
      return false;
    }
    if (!selectedScopes.length) {
      toast({
        title: '请选择设备权限',
        description: '至少选择一项设备权限。',
        variant: 'destructive',
      });
      return false;
    }
    return true;
  }

  async function issuePairingCode(input: {
    shopIds: string[];
    scopes: string[];
    deviceLabel: string;
  }): Promise<PairingCode> {
    const response = await api.post<PairingCode>('/api/extension-device/pairing-codes', {
      shopIds: input.shopIds,
      scopes: input.scopes,
      ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
    });
    if (response.code !== 1 || !response.data) {
      throw new Error(response.msg || responseErrorCode(response));
    }
    return response.data;
  }

  async function createPairingCode() {
    if (!validatePairingSelection()) return;
    const generation = pairingGenerationRef.current;
    const selection = {
      shopIds: selectedShopIds.slice(),
      scopes: selectedScopes.slice(),
      deviceLabel: deviceLabel.trim(),
    };
    setPairingBusy(true);
    try {
      const nextPairing = await issuePairingCode(selection);
      if (!isCurrentPairingGeneration(generation)) {
        await cancelPairingAttempt(nextPairing.id);
        return;
      }
      setPairing(nextPairing);
      toast({ title: '手动配对码已创建', description: '请在过期前到扩展“完整设置”中领取。' });
      await loadPairingContext(generation);
    } catch (error) {
      if (!isCurrentPairingGeneration(generation)) return;
      toast({
        title: '创建配对码失败',
        description: error instanceof Error ? error.message : '请求失败',
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPairingGeneration(generation)) setPairingBusy(false);
    }
  }

  async function revokePairingCode(pairingCodeId: string): Promise<boolean> {
    const response = await api.delete(
      '/api/extension-device/pairing-codes/' + encodeURIComponent(pairingCodeId),
    );
    return response.code === 1 || responseErrorCode(response) === 'pairing_not_found';
  }

  async function cancelPairingAttempt(pairingCodeId: string) {
    try {
      await revokePairingCode(pairingCodeId);
    } catch {
      // A consumed or temporarily unreachable code is replaced by the next bounded attempt.
    }
  }

  async function connectExtension() {
    if (!validatePairingSelection()) return;
    if (!currentOwnerUserId) {
      toast({
        title: '账号信息尚未就绪',
        description: '请刷新连接信息后重试。',
        variant: 'destructive',
      });
      return;
    }
    const generation = beginPairingGeneration();
    const ownerUserId = currentOwnerUserId;
    const selection = {
      shopIds: selectedShopIds.slice(),
      scopes: selectedScopes.slice(),
      deviceLabel: deviceLabel.trim(),
    };
    setConnecting(true);
    setExtensionConnection('checking');
    setExtensionConnectionDetail('正在连接当前浏览器扩展...');
    let nextPairing: PairingCode | null = null;
    try {
      if (pairing) {
        const revoked = await revokePairingCode(pairing.id);
        if (!revoked) throw new Error('无法撤销现有手动配对码，请先取消后再一键连接');
        if (!isCurrentPairingGeneration(generation)) return;
        setPairing(null);
      }
      const detected = await detectExtensionConnection(ownerUserId, generation, false);
      if (!isCurrentPairingGeneration(generation)) return;
      if (!detected) throw new Error('未检测到 SS ERP 扩展，请安装或刷新页面后重试');
      if (detected.ownerUserId && detected.ownerUserId !== ownerUserId) {
        throw new Error('当前扩展已连接其他 ERP 账号，请先在扩展完整设置中解除配对');
      }
      if (detected.state === 'unreachable') {
        throw new Error('暂时无法验证原设备授权，请恢复 ERP 网络后重试');
      }
      const currentSessions = await refreshDeviceSessions(generation);
      if (!currentSessions || !isCurrentPairingGeneration(generation)) return;
      const detectedSession = currentSessions
        .find((session) => session.id === detected.sessionId) || null;
      let needsAuthorization = deviceGrantMismatch({
        status: detected,
        session: detectedSession,
        ownerUserId,
        shopIds: selection.shopIds,
        scopes: selection.scopes,
      });
      if (detected.state === 'paired' && !needsAuthorization) {
        showConnectedExtension(detected, generation);
        toast({ title: '扩展已经连接' });
        return;
      }
      let replacedSessionId = needsAuthorization ? detected.sessionId || '' : '';

      let connected: ExtensionDeviceStatus | null = null;
      let lastClaimError = '扩展未能领取设备凭证';
      for (let attempt = 0; attempt < 2 && !connected; attempt += 1) {
        nextPairing = await issuePairingCode(selection);
        if (!isCurrentPairingGeneration(generation)) {
          await cancelPairingAttempt(nextPairing.id);
          nextPairing = null;
          return;
        }
        const response = await sendToExtension({
          type: 'ss-erp:extension-device-claim',
          baseUrl: erpUrl,
          deploymentId: nextPairing.deploymentId,
          code: nextPairing.code,
          ...(needsAuthorization ? { reauthorize: true } : {}),
          ...(selection.deviceLabel ? { deviceLabel: selection.deviceLabel } : {}),
        }, 10_000);
        if (!isCurrentPairingGeneration(generation)) {
          await cancelPairingAttempt(nextPairing.id);
          nextPairing = null;
          return;
        }
        lastClaimError = response.error || lastClaimError;
        const recovered = await detectExtensionConnection(ownerUserId, generation, false);
        if (!isCurrentPairingGeneration(generation)) {
          await cancelPairingAttempt(nextPairing.id);
          nextPairing = null;
          return;
        }
        const candidate = recovered?.state === 'paired' ? recovered : response.data;
        const refreshedSessions = await refreshDeviceSessions(generation);
        if (!refreshedSessions || !isCurrentPairingGeneration(generation)) {
          await cancelPairingAttempt(nextPairing.id);
          nextPairing = null;
          return;
        }
        const claimedSession = refreshedSessions
          .find((session) => session.id === candidate?.sessionId) || null;
        if (claimedStatusMatches(candidate, claimedSession, {
          ownerUserId,
          replacedSessionId,
          shopIds: selection.shopIds,
          scopes: selection.scopes,
        })) {
          connected = candidate;
          break;
        }
        if (candidate?.state === 'paired' && candidate.ownerUserId === ownerUserId) {
          needsAuthorization = true;
          replacedSessionId = candidate.sessionId || replacedSessionId;
          lastClaimError = '扩展当前授权与所选店铺或权限不一致，请重试更新授权';
        }
        await cancelPairingAttempt(nextPairing.id);
        nextPairing = null;
      }
      if (!connected) throw new Error(lastClaimError);
      if (nextPairing) {
        await cancelPairingAttempt(nextPairing.id);
        nextPairing = null;
      }
      if (!isCurrentPairingGeneration(generation)) return;
      setPairing(null);
      showConnectedExtension(connected, generation);
      toast({ title: '扩展连接成功', description: '设备凭证已安全保存到当前浏览器扩展。' });
      await loadPairingContext(generation);
    } catch (error) {
      if (nextPairing) await cancelPairingAttempt(nextPairing.id);
      if (!isCurrentPairingGeneration(generation)) return;
      setPairing(null);
      setExtensionConnection('error');
      setExtensionConnectionDetail(error instanceof Error ? error.message : '扩展连接失败');
      toast({
        title: '一键连接失败',
        description: error instanceof Error ? error.message : '请求失败',
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPairingGeneration(generation)) setConnecting(false);
    }
  }

  async function cancelPairingCode() {
    if (!pairing) return;
    setPairingBusy(true);
    try {
      const revoked = await revokePairingCode(pairing.id);
      if (!revoked) throw new Error('配对码不存在或已失效');
      setPairing(null);
      toast({ title: '配对码已取消' });
    } catch (error) {
      toast({
        title: '取消配对码失败',
        description: error instanceof Error ? error.message : '请求失败',
        variant: 'destructive',
      });
    } finally {
      setPairingBusy(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setRevokingId(sessionId);
    try {
      const response = await api.delete(
        '/api/extension-device/sessions/' + encodeURIComponent(sessionId),
      );
      if (response.code !== 1) throw new Error(response.msg || responseErrorCode(response));
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      toast({ title: '撤销设备完成', description: '该设备下次联网时将停止继续访问。' });
    } catch (error) {
      toast({
        title: '撤销设备失败',
        description: error instanceof Error ? error.message : '请求失败',
        variant: 'destructive',
      });
    } finally {
      setRevokingId('');
    }
  }

  async function generateLegacyToken() {
    setLegacyBusy(true);
    try {
      const response = await api.post<{ token: string; expiresAt: string }>(
        '/api/auth/extension-token',
        {},
      );
      if (response.code !== 1 || !response.data) {
        const code = responseErrorCode(response);
        if (code === 'legacy_extension_token_disabled') setLegacyDisabled(true);
        throw new Error(response.msg || code);
      }
      setToken(response.data.token);
      setTokenExpiresAt(response.data.expiresAt);
    } catch (error) {
      toast({
        title: '兼容 Token 生成失败',
        description: error instanceof Error ? error.message : '请求失败',
        variant: 'destructive',
      });
    } finally {
      setLegacyBusy(false);
    }
  }

  async function copyValue(target: Exclude<CopyTarget, null>, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" title="扩展连接">
            <Key className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorUp className="h-4 w-4" />
            扩展设备连接
          </DialogTitle>
        </DialogHeader>

        <div role="tablist" aria-label="扩展连接方式" className="flex border-b">
          <button
            type="button"
            role="tab"
            hidden={!extensionDeviceAuthEnabled}
            aria-selected={view === 'pairing'}
            className={
              'border-b-2 px-3 py-2 text-sm font-medium ' +
              (view === 'pairing'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground')
            }
            onClick={() => setView('pairing')}
          >
            设备配对
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'legacy'}
            className={
              'border-b-2 px-3 py-2 text-sm font-medium ' +
              (view === 'legacy'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground')
            }
            onClick={() => setView('legacy')}
          >
            兼容 Token
          </button>
        </div>

        {extensionDeviceAuthEnabled && view === 'pairing' ? (
          <div className="space-y-5">
            <section aria-labelledby="extension-detection-title" className="border-y py-3">
              <div className="flex items-center gap-3">
                <span
                  className={
                    'h-2.5 w-2.5 shrink-0 rounded-full ' +
                    (extensionConnection === 'paired'
                      ? 'bg-emerald-500'
                      : extensionConnection === 'checking'
                        ? 'bg-amber-500'
                        : 'bg-destructive')
                  }
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <h2 id="extension-detection-title" className="text-sm font-semibold">
                    当前浏览器扩展
                  </h2>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {extensionNeedsAuthorization
                      ? '设备已连接，但缺少当前选择的店铺或功能权限，请更新授权。'
                      : extensionConnectionDetail || '正在检测当前浏览器扩展...'}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={refreshExtensionDetection}
                  disabled={
                    extensionConnection === 'checking' || connecting || pairingBusy || loadingContext
                  }
                  title="重新检测扩展"
                >
                  {extensionConnection === 'checking' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="sr-only">重新检测扩展</span>
                </Button>
              </div>
            </section>

            <section aria-labelledby="pairing-scope-title" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="pairing-scope-title" className="text-sm font-semibold">
                    选择 Ozon 店铺
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    设备只能读取所选店铺已发布的物流规则。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshPairingContext}
                  disabled={loadingContext || pairingSelectionLocked}
                >
                  {loadingContext ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5">刷新</span>
                </Button>
              </div>

              <div className="divide-y border-y">
                {shops.length ? (
                  shops.map((shop) => (
                    <label
                      key={shop.id}
                      className="flex cursor-pointer items-center gap-3 px-2 py-2.5 text-sm hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedShopIds.includes(shop.id)}
                        onChange={() => toggleShop(shop.id)}
                        disabled={pairingSelectionLocked}
                      />
                      <span className="min-w-0 flex-1 truncate">{shop.name}</span>
                      <code className="text-[11px] text-muted-foreground">
                        {shop.id.slice(0, 8)}
                      </code>
                    </label>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {loadingContext ? '正在读取店铺...' : '没有可配对的 Ozon 店铺'}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">设备权限</h3>
                <div className="grid grid-cols-2 border-y sm:grid-cols-3">
                  {DEVICE_SCOPE_OPTIONS.map((scope) => (
                    <label
                      key={scope.value}
                      className="flex min-h-10 cursor-pointer items-center gap-2 border-b px-2 py-2 text-sm last:border-b-0 sm:border-r"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={selectedScopes.includes(scope.value)}
                        onChange={() => toggleScope(scope.value)}
                        disabled={pairingSelectionLocked}
                      />
                      <span className="min-w-0 flex-1">{scope.label}</span>
                      {'highRisk' in scope && scope.highRisk ? (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                          高风险
                        </Badge>
                      ) : null}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  value={deviceLabel}
                  onChange={(event) => setDeviceLabel(event.target.value)}
                  maxLength={120}
                  placeholder="设备名称，例如：开发机 Chrome"
                  aria-label="设备名称"
                  disabled={pairingSelectionLocked}
                />
                <Button
                  onClick={connectExtension}
                  disabled={
                    connecting || pairingBusy || loadingContext || !currentOwnerUserId ||
                    extensionConnection === 'checking' ||
                    (extensionConnection === 'paired' && !extensionNeedsAuthorization) ||
                    !selectedShopIds.length || !selectedScopes.length
                  }
                  className="shrink-0"
                >
                  {connecting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Cable className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {extensionConnection === 'paired'
                    ? extensionNeedsAuthorization ? '更新授权' : '已连接'
                    : '一键连接'}
                </Button>
                <Button
                  variant="outline"
                  onClick={createPairingCode}
                  disabled={
                    pairingSelectionLocked || loadingContext || !currentOwnerUserId ||
                    !selectedShopIds.length || !selectedScopes.length
                  }
                  className="shrink-0"
                >
                  {pairingBusy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  手动配对
                </Button>
              </div>
            </section>

            {pairing ? (
              <section
                aria-labelledby="pairing-code-title"
                className="space-y-3 border-y border-emerald-300 bg-emerald-50/50 px-3 py-3 dark:bg-emerald-950/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 id="pairing-code-title" className="text-sm font-semibold">
                      手动配对码
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      有效期至 {formatDate(pairing.expiresAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelPairingCode}
                    disabled={pairingBusy}
                  >
                    取消
                  </Button>
                </div>
                {pairingFields.map(([label, value, target]) => (
                  <div
                    key={label}
                    className="grid gap-1.5 sm:grid-cols-[76px_1fr_auto] sm:items-center"
                  >
                    <span className="text-xs font-medium">{label}</span>
                    <code className="break-all bg-background px-2 py-1.5 text-xs">{value}</code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => copyValue(target, value)}
                    >
                      {copied === target ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="sr-only">复制{label}</span>
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  打开扩展“完整设置”，在“物流规则设备配对”中依次填写以上三项。配对码领取成功后不可再次使用。
                </p>
              </section>
            ) : null}

            <section aria-labelledby="paired-devices-title" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="paired-devices-title" className="text-sm font-semibold">
                    已配对设备
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    撤销后不会删除发布历史，只停止该设备继续拉取。
                  </p>
                </div>
                <Badge variant="outline">{sessions.length}</Badge>
              </div>
              <div className="divide-y border-y">
                {sessions.length ? (
                  sessions.map((session) => (
                    <div key={session.id} className="flex items-start gap-3 px-2 py-3">
                      <MonitorUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {session.deviceLabel || '未命名设备'}
                          </span>
                          <Badge variant={session.status === 'ACTIVE' ? 'success' : 'secondary'}>
                            {session.status}
                          </Badge>
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                          {shortDeviceId(session.deviceId)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          店铺：
                          {session.shopIds.map((id) => shopNameById.get(id) || id).join('、') ||
                            '-'}{' '}
                          · 最近在线 {formatDate(session.lastSeenAt)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          权限：
                          {session.scopes
                            .map(
                              (value) =>
                                DEVICE_SCOPE_OPTIONS.find((scope) => scope.value === value)?.label ||
                                value,
                            )
                            .join('、') || '-'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-destructive"
                        onClick={() => revokeSession(session.id)}
                        disabled={revokingId === session.id}
                      >
                        {revokingId === session.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        撤销设备
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    尚无已配对设备
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <section aria-labelledby="legacy-token-title" className="space-y-4">
            <div>
              <h2 id="legacy-token-title" className="text-sm font-semibold">
                旧版扩展兼容 Token
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                仅供尚未迁移的采集功能使用。物流规则同步不会接受此 Token；新设备请使用“设备配对”。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={generateLegacyToken}
                disabled={legacyBusy || legacyDisabled}
              >
                {legacyBusy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                {legacyDisabled ? '兼容 Token 已停用' : '生成兼容 Token'}
              </Button>
              {tokenExpiresAt ? (
                <span className="text-xs text-muted-foreground">
                  有效期至 {formatDate(tokenExpiresAt)}
                </span>
              ) : null}
            </div>
            {token ? (
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all bg-muted px-2 py-2 text-[10px]">
                  {token}
                </code>
                <Button size="icon" variant="ghost" onClick={() => copyValue('token', token)}>
                  {copied === 'token' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span className="sr-only">复制兼容 Token</span>
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              如服务器返回
              legacy_extension_token_disabled，说明当前部署已完成设备凭证迁移，不应重新启用旧
              Token。
            </p>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
