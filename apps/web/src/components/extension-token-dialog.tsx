'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Key, Loader2, MonitorUp, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
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
  { value: 'listing:publish', label: 'Ozon 发布', highRisk: true },
] as const;

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

export function ExtensionTokenDialog({ trigger }: ExtensionTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(extensionDeviceAuthEnabled ? 'pairing' : 'legacy');
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [revokingId, setRevokingId] = useState('');
  const [token, setToken] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState('');
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyDisabled, setLegacyDisabled] = useState(false);
  const [copied, setCopied] = useState<CopyTarget>(null);

  const erpUrl = typeof window !== 'undefined' ? getApiBase() : '';
  const shopNameById = useMemo(() => new Map(shops.map((shop) => [shop.id, shop.name])), [shops]);
  const pairingFields: Array<[label: string, value: string, target: Exclude<CopyTarget, null>]> =
    pairing
      ? [
          ['ERP 地址', erpUrl, 'url'],
          ['部署标识', pairing.deploymentId, 'deployment'],
          ['配对码', pairing.code, 'code'],
        ]
      : [];

  async function loadPairingContext() {
    setLoadingContext(true);
    try {
      const [shopResponse, sessionResponse] = await Promise.all([
        api.get<ShopOption[]>('/api/shops'),
        api.get<DeviceSession[]>('/api/extension-device/sessions'),
      ]);
      const ozonShops =
        shopResponse.code === 1 && Array.isArray(shopResponse.data)
          ? shopResponse.data.filter(
              (shop) => shop.platform === 'OZON' && shop.status !== 'DISABLED',
            )
          : [];
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
    } catch (error) {
      toast({
        title: '设备连接信息读取失败',
        description: error instanceof Error ? error.message : '网络请求失败',
        variant: 'destructive',
      });
    } finally {
      setLoadingContext(false);
    }
  }

  useEffect(() => {
    if (open && extensionDeviceAuthEnabled) void loadPairingContext();
  }, [open]);

  function toggleShop(shopId: string) {
    setSelectedShopIds((current) =>
      current.includes(shopId) ? current.filter((id) => id !== shopId) : [...current, shopId],
    );
  }

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  }

  async function createPairingCode() {
    if (!selectedShopIds.length) {
      toast({
        title: '请选择 Ozon 店铺',
        description: '设备权限必须限定到至少一个店铺。',
        variant: 'destructive',
      });
      return;
    }
    if (!selectedScopes.length) {
      toast({
        title: '请选择设备权限',
        description: '至少选择一项设备权限。',
        variant: 'destructive',
      });
      return;
    }
    setPairingBusy(true);
    try {
      const response = await api.post<PairingCode>('/api/extension-device/pairing-codes', {
        shopIds: selectedShopIds,
        scopes: selectedScopes,
        ...(deviceLabel.trim() ? { deviceLabel: deviceLabel.trim() } : {}),
      });
      if (response.code !== 1 || !response.data) {
        throw new Error(response.msg || responseErrorCode(response));
      }
      setPairing(response.data);
      toast({ title: '一次性配对码已创建', description: '请在过期前到扩展“完整设置”中领取。' });
      await loadPairingContext();
    } catch (error) {
      toast({
        title: '创建配对码失败',
        description: error instanceof Error ? error.message : '请求失败',
        variant: 'destructive',
      });
    } finally {
      setPairingBusy(false);
    }
  }

  async function cancelPairingCode() {
    if (!pairing) return;
    setPairingBusy(true);
    try {
      const response = await api.delete(
        '/api/extension-device/pairing-codes/' + encodeURIComponent(pairing.id),
      );
      if (response.code !== 1) throw new Error(response.msg || responseErrorCode(response));
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
    <Dialog open={open} onOpenChange={setOpen}>
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
                  onClick={loadPairingContext}
                  disabled={loadingContext}
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

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={deviceLabel}
                  onChange={(event) => setDeviceLabel(event.target.value)}
                  maxLength={120}
                  placeholder="设备名称，例如：开发机 Chrome"
                  aria-label="设备名称"
                />
                <Button
                  onClick={createPairingCode}
                  disabled={pairingBusy || !selectedShopIds.length || !selectedScopes.length}
                  className="shrink-0"
                >
                  {pairingBusy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  生成配对码
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
                      一次性配对码
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
