'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Save,
  Settings as SettingsIcon,
  AlertCircle,
  HardDrive,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { AiPromptTemplateEditor } from '@/components/admin/ai-prompt-template-editor';
import { api } from '@/lib/api';
import {
  ALIYUN_OSS_REGIONS,
  getAliyunOssEndpoint,
  getAliyunOssRamPolicy,
  getObjectStorageProviderPreset,
  inferAliyunOssRegion,
  inferObjectStorageProvider,
  type ObjectStorageProvider,
} from 'shared/object-storage';

interface SystemConfig {
  id: string;
  key: string;
  value: string;
  label: string | null;
  group: string;
  description: string | null;
  updatedAt: string;
}

function isMaskedSecretDisplay(value: string): boolean {
  return value === '***MASKED***' || /^.{4}\*{3}.{4}$/.test(value);
}

function isSavedMaskedSecret(value: string, savedValue?: string): boolean {
  return Boolean(savedValue && value === savedValue && isMaskedSecretDisplay(savedValue));
}

interface AiUsageSummary {
  requestCount: number;
  cacheHitCount: number;
  failureCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface AiUsageDiagnostics {
  date: string;
  total: AiUsageSummary;
  byNamespace: Record<string, AiUsageSummary>;
}

interface BackupStatus {
  available: boolean;
  message?: string;
  lastBackupAt?: string;
  lastLocalFile?: string;
  lastLocalPath?: string;
  lastLocalSize?: string;
  lastLocalSizeBytes?: number;
  remoteUploaded?: boolean;
  lastRemoteKey?: string;
  remoteSource?: string;
  remoteCleanupDeleted?: number;
  localDeleted?: number;
  warnings?: string[];
}

const GROUP_LABELS: Record<string, string> = {
  feature: '功能开关',
  auth: '短信与人机验证',
  upload: '上传与对象存储',
  listing: '上架任务',
  retention: '数据保留',
  backup: '备份策略',
  maintenance: '维护模式',
  version: '版本更新',
  randomize: '随机化（货号/尺寸/重量）',
  ai: 'AI 翻译与生成',
  general: '通用',
};

const GROUP_ORDER = [
  'maintenance',
  'auth',
  'feature',
  'ai',
  'upload',
  'listing',
  'retention',
  'backup',
  'version',
  'randomize',
  'general',
];

const REQUIRED_CONFIG_KEYS = [
  'upload_oss_provider',
  'ai_provider',
  'ai_image_provider',
  'listing_task_refresh_interval_ms',
  'listing_task_refresh_batch_size',
  'listing_task_refresh_concurrency',
  'listing_task_refresh_lookback_hours',
  'listing_ozon_api_timeout_ms',
];

export default function AdminSettingsPage() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);

  useEffect(() => {
    fetchConfigs(true);
  }, []);

  function applyConfigRows(rows: SystemConfig[]) {
    const filtered = rows.filter((c) => !['storage', 'security', 'integration'].includes(c.group));
    setConfigs(filtered);
    const map: Record<string, string> = {};
    filtered.forEach((c) => {
      map[c.key] = c.value;
    });
    setEditing(map);
    return filtered;
  }

  async function fetchConfigs(showInitialLoader = false) {
    if (showInitialLoader) setLoading(true);
    const [configRes, backupRes, aiUsageRes] = await Promise.all([
      api.get<SystemConfig[]>('/api/admin/system-config'),
      api.get<BackupStatus>('/api/admin/ops/backup-status'),
      api.get<AiUsageDiagnostics>('/api/admin/system-config/ai-usage/summary'),
    ]);
    if (configRes.code === 1 && configRes.data) {
      const filtered = applyConfigRows(configRes.data);
      const hasRequiredKeys = REQUIRED_CONFIG_KEYS.every((key) =>
        filtered.some((cfg) => cfg.key === key),
      );
      if (!hasRequiredKeys) {
        await api.post('/api/admin/system-config/seed', {});
        const res2 = await api.get<SystemConfig[]>('/api/admin/system-config');
        if (res2.code === 1 && res2.data) applyConfigRows(res2.data);
      }
    } else if (configRes.code === 0) {
      await api.post('/api/admin/system-config/seed', {});
      const res2 = await api.get<SystemConfig[]>('/api/admin/system-config');
      if (res2.code === 1 && res2.data) applyConfigRows(res2.data);
    }
    if (backupRes.code === 1 && backupRes.data) setBackupStatus(backupRes.data);
    if (aiUsageRes.code === 1 && aiUsageRes.data) setAiUsage(aiUsageRes.data);
    setLoading(false);
  }

  async function saveConfig(key: string) {
    setSavingKey(key);
    const res = await api.put(`/api/admin/system-config/${key}`, { value: editing[key] || '' });
    setSavingKey(null);
    if (res.code === 1) {
      toast({ title: '已保存', description: `配置 ${key} 更新成功` });
      fetchConfigs();
    } else {
      toast({ title: '保存失败', description: res.msg || '未知错误', variant: 'destructive' });
    }
  }

  async function saveConfigs(
    keys: string[],
    label: string,
    overrides: Record<string, string> = {},
  ) {
    const items = keys
      .filter((key) => Object.prototype.hasOwnProperty.call(editing, key))
      .map((key) => ({ key, value: overrides[key] ?? editing[key] ?? '' }));
    setSavingKey(`group:${label}`);
    const res = await api.put('/api/admin/system-config/batch', { items });
    setSavingKey(null);
    if (res.code !== 1) {
      toast({
        title: '保存失败',
        description: res.msg || '对象存储配置未写入，原配置保持不变',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: '已保存', description: `${label} 更新成功` });
    fetchConfigs();
  }

  async function initDefaults() {
    const res = await api.post('/api/admin/system-config/seed', {});
    if (res.code === 1) {
      toast({ title: '默认配置已初始化' });
      fetchConfigs();
    }
  }

  async function runBackupNow() {
    setRunningBackup(true);
    const res = await api.post<BackupStatus>('/api/admin/ops/backup/run', {});
    setRunningBackup(false);
    if (res.code === 1) {
      toast({ title: '备份完成', description: res.msg || '数据库备份已完成' });
      fetchConfigs();
    } else {
      toast({
        title: '备份失败',
        description: res.msg || '请查看运维状态',
        variant: 'destructive',
      });
      fetchConfigs();
    }
  }

  const grouped: Record<string, SystemConfig[]> = {};
  configs.forEach((c) => {
    if (!grouped[c.group]) grouped[c.group] = [];
    grouped[c.group]!.push(c);
  });

  const sortedGroups = Object.keys(grouped).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <SettingsIcon className="h-6 w-6" /> 系统设置
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            常用配置默认展开，高级运维参数默认收起。对象存储配置同时适用于本地版、国内服务器和国外
            VPS。
          </p>
        </div>
        <Button variant="outline" onClick={initDefaults}>
          初始化默认配置
        </Button>
      </div>

      {Object.keys(grouped).length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>暂无配置项，点击右上角"初始化默认配置"</p>
          </CardContent>
        </Card>
      )}

      {sortedGroups.map((group) => {
        const items = grouped[group]!;
        if (group === 'ai') {
          return (
            <AiSettingsPanel
              key={group}
              items={items}
              editing={editing}
              setEditing={setEditing}
              savingKey={savingKey}
              saveConfigs={saveConfigs}
              aiUsage={aiUsage}
            />
          );
        }

        if (group === 'upload') {
          return (
            <UploadSettingsPanel
              key={group}
              items={items}
              editing={editing}
              setEditing={setEditing}
              savingKey={savingKey}
              saveConfig={saveConfig}
              saveConfigs={saveConfigs}
            />
          );
        }
        if (group === 'listing') {
          return (
            <ListingSettingsPanel
              key={group}
              items={items}
              editing={editing}
              setEditing={setEditing}
              savingKey={savingKey}
              saveConfigs={saveConfigs}
            />
          );
        }

        if (group === 'auth') {
          return (
            <AuthSettingsPanel
              key={group}
              items={items}
              editing={editing}
              setEditing={setEditing}
              savingKey={savingKey}
              saveConfigs={saveConfigs}
            />
          );
        }

        if (group === 'backup') {
          return (
            <BackupSettingsPanel
              key={group}
              items={items}
              editing={editing}
              setEditing={setEditing}
              savingKey={savingKey}
              saveConfigs={saveConfigs}
              backupStatus={backupStatus}
              runningBackup={runningBackup}
              runBackupNow={runBackupNow}
            />
          );
        }

        return (
          <div key={group} className="space-y-4">
            <Card>
              <details open={group === 'maintenance'} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{GROUP_LABELS[group] || group}</Badge>
                    <span className="text-sm text-muted-foreground">{items.length} 项</span>
                    {group !== 'maintenance' && (
                      <span className="text-xs text-muted-foreground">低频配置，点开后修改</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
                  <span className="hidden text-xs text-muted-foreground group-open:inline">
                    收起
                  </span>
                </summary>
                <CardContent className="space-y-5 border-t pt-5">
                  {group === 'backup' && (
                    <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
                      这里配置的是数据库备份的远程存储（`backup_remote_*`），不影响图片/附件上传。
                      图片/附件对象存储请在"上传与对象存储"里配置 `upload_*`。
                    </p>
                  )}
                  {items.map((cfg) => (
                    <div
                      key={cfg.key}
                      className="space-y-2 pb-4 border-b last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <Label className="font-medium">{cfg.label || cfg.key}</Label>
                          <code className="ml-2 text-xs text-muted-foreground">{cfg.key}</code>
                          {cfg.description && (
                            <p className="text-xs text-muted-foreground mt-1">{cfg.description}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => saveConfig(cfg.key)}
                          disabled={savingKey === cfg.key || editing[cfg.key] === cfg.value}
                        >
                          {savingKey === cfg.key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1">保存</span>
                        </Button>
                      </div>

                      {editing[cfg.key] === 'true' || editing[cfg.key] === 'false' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                ...editing,
                                [cfg.key]: editing[cfg.key] === 'true' ? 'false' : 'true',
                              })
                            }
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              editing[cfg.key] === 'true' ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                                editing[cfg.key] === 'true' ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                          <span className="text-sm">
                            {editing[cfg.key] === 'true' ? '已启用' : '已禁用'}
                          </span>
                        </div>
                      ) : (
                        <Input
                          value={editing[cfg.key] || ''}
                          onChange={(e) => setEditing({ ...editing, [cfg.key]: e.target.value })}
                          placeholder={cfg.description || ''}
                        />
                      )}
                    </div>
                  ))}
                </CardContent>
              </details>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

interface AiSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
  aiUsage: AiUsageDiagnostics | null;
}

interface UploadSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfig: (key: string) => Promise<void>;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
}

interface ListingSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
}
interface AuthSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
}

interface BackupSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
  backupStatus: BackupStatus | null;
  runningBackup: boolean;
  runBackupNow: () => Promise<void>;
}

const LISTING_REFRESH_KEYS = [
  'listing_task_refresh_interval_ms',
  'listing_task_refresh_batch_size',
  'listing_task_refresh_concurrency',
  'listing_task_refresh_lookback_hours',
  'listing_ozon_api_timeout_ms',
];

const LISTING_PRESETS = [
  {
    label: '本地保守',
    desc: '适合本地网络和测试环境',
    values: {
      listing_task_refresh_interval_ms: '30000',
      listing_task_refresh_batch_size: '10',
      listing_task_refresh_concurrency: '3',
      listing_task_refresh_lookback_hours: '48',
      listing_ozon_api_timeout_ms: '20000',
    },
  },
  {
    label: 'VPS 推荐',
    desc: '适合 OSS 直链和稳定公网',
    values: {
      listing_task_refresh_interval_ms: '30000',
      listing_task_refresh_batch_size: '30',
      listing_task_refresh_concurrency: '6',
      listing_task_refresh_lookback_hours: '72',
      listing_ozon_api_timeout_ms: '20000',
    },
  },
  {
    label: 'VPS 高吞吐',
    desc: '任务量大时使用，先观察 Ozon 限流',
    values: {
      listing_task_refresh_interval_ms: '30000',
      listing_task_refresh_batch_size: '50',
      listing_task_refresh_concurrency: '10',
      listing_task_refresh_lookback_hours: '72',
      listing_ozon_api_timeout_ms: '25000',
    },
  },
];

function ListingSettingsPanel({
  items,
  editing,
  setEditing,
  savingKey,
  saveConfigs,
}: ListingSettingsPanelProps) {
  const configs = Object.fromEntries(items.map((item) => [item.key, item]));
  const setValue = (key: string, value: string) => setEditing({ ...editing, [key]: value });
  const isSavingRefresh = savingKey === 'group:上架任务刷新';
  const applyPreset = (values: Record<string, string>) => setEditing({ ...editing, ...values });

  return (
    <div className="space-y-4">
      <Card>
        <details open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">上架任务</Badge>
              <span className="text-sm text-muted-foreground">自动刷新、并发、Ozon 查询超时</span>
            </div>
            <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
          </summary>
          <CardContent className="space-y-6 border-t pt-5">
            <section className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-medium">上架队列执行参数</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    后台 worker 每轮读取这里的配置；.env 只作为数据库配置不可用时的兜底。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(LISTING_REFRESH_KEYS, '上架任务刷新')}
                  disabled={isSavingRefresh}
                >
                  {isSavingRefresh ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存上架参数</span>
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                {LISTING_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset.values)}
                    className="rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="block text-sm font-medium">{preset.label}</span>
                    <span className="text-xs text-muted-foreground">{preset.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-medium">自动刷新策略</h3>
                <p className="text-xs text-muted-foreground">
                  并发不是越高越好。VPS 先从 6 开始，稳定后再调到 8-10。
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.listing_task_refresh_interval_ms}
                  editing={editing}
                  setValue={setValue}
                  placeholder="30000"
                />
                <ConfigInput
                  cfg={configs.listing_task_refresh_batch_size}
                  editing={editing}
                  setValue={setValue}
                  placeholder="30"
                />
                <ConfigInput
                  cfg={configs.listing_task_refresh_concurrency}
                  editing={editing}
                  setValue={setValue}
                  placeholder="6"
                />
                <ConfigInput
                  cfg={configs.listing_task_refresh_lookback_hours}
                  editing={editing}
                  setValue={setValue}
                  placeholder="72"
                />
                <ConfigInput
                  cfg={configs.listing_ozon_api_timeout_ms}
                  editing={editing}
                  setValue={setValue}
                  placeholder="20000"
                />
              </div>
            </section>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}
const AUTH_GENERAL_KEYS = [
  'feature_sms_register',
  'feature_turnstile_login',
  'auth_human_challenge_provider',
  'auth_pow_signing_secret',
  'auth_pow_difficulty',
  'auth_pow_ttl_seconds',
  'auth_sms_provider',
  'auth_sms_code_ttl_seconds',
  'auth_sms_rate_limit_seconds',
  'auth_sms_test_phone_whitelist',
  'auth_turnstile_site_key',
  'auth_turnstile_secret_key',
];

const AUTH_TENCENT_KEYS = [
  'auth_sms_tencent_secret_id',
  'auth_sms_tencent_secret_key',
  'auth_sms_tencent_region',
  'auth_sms_tencent_sdk_app_id',
  'auth_sms_tencent_sign_name',
  'auth_sms_tencent_template_id',
];

const AUTH_TURNSTILE_KEYS = [
  'auth_human_challenge_provider',
  'auth_pow_difficulty',
  'auth_pow_ttl_seconds',
  'feature_turnstile_login',
  'auth_turnstile_site_key',
  'auth_turnstile_secret_key',
];

function AuthSettingsPanel({
  items,
  editing,
  setEditing,
  savingKey,
  saveConfigs,
}: AuthSettingsPanelProps) {
  const configs = Object.fromEntries(items.map((item) => [item.key, item]));
  const provider = editing.auth_sms_provider || 'env';
  const challengeProvider = editing.auth_human_challenge_provider || (editing.feature_turnstile_login === 'true' ? 'cloudflare-turnstile' : 'disabled');
  const setValue = (key: string, value: string) => setEditing({ ...editing, [key]: value });
  const isSavingAuth = savingKey === 'group:短信与人机验证';
  const isSavingTencent = savingKey === 'group:腾讯云短信';
  const isSavingTurnstile = savingKey === 'group:Cloudflare Turnstile';

  return (
    <div className="space-y-4">
      <Card>
        <details open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">短信与人机验证</Badge>
              <span className="text-sm text-muted-foreground">
                注册短信、登录人机验证、测试短信白名单
              </span>
            </div>
            <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
          </summary>
          <CardContent className="space-y-6 border-t pt-5">
            <section className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-medium">云端注册与登录保护</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    后台配置优先于 VPS .env。密钥保存后会加密入库，页面只返回掩码。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(AUTH_GENERAL_KEYS, '短信与人机验证')}
                  disabled={isSavingAuth}
                >
                  {isSavingAuth ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存验证配置</span>
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <div className="grid gap-4 md:grid-cols-2">
                <ConfigToggle
                  cfg={configs.feature_sms_register}
                  editing={editing}
                  setValue={setValue}
                />
                <ConfigToggle
                  cfg={configs.feature_turnstile_login}
                  editing={editing}
                  setValue={setValue}
                />
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-medium">短信服务来源</h3>
                <p className="text-xs text-muted-foreground">
                  正式云端建议选择腾讯云短信；env 表示继续读取服务器环境变量。
                </p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  { value: 'tencent', label: '腾讯云短信', desc: '正式注册验证码' },
                  { value: 'env', label: '服务器环境', desc: '读取 VPS .env' },
                  { value: 'console', label: 'Console 测试', desc: '只写日志不发短信' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue('auth_sms_provider', option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      provider === option.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.auth_sms_code_ttl_seconds}
                  editing={editing}
                  setValue={setValue}
                  placeholder="300"
                />
                <ConfigInput
                  cfg={configs.auth_sms_rate_limit_seconds}
                  editing={editing}
                  setValue={setValue}
                  placeholder="60"
                />
                <ConfigInput
                  cfg={configs.auth_sms_test_phone_whitelist}
                  editing={editing}
                  setValue={setValue}
                  placeholder="13800138000,13900139000"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">腾讯云短信</h3>
                  <p className="text-xs text-muted-foreground">
                    模板变量当前按 {`{1}=验证码`} 发送，腾讯云模板需保持一致。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    saveConfigs(['auth_sms_provider', ...AUTH_TENCENT_KEYS], '腾讯云短信', {
                      auth_sms_provider: 'tencent',
                    })
                  }
                  disabled={isSavingTencent}
                >
                  {isSavingTencent ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存腾讯云短信</span>
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.auth_sms_tencent_secret_id}
                  editing={editing}
                  setValue={setValue}
                  type="password"
                  placeholder="SecretId"
                />
                <ConfigInput
                  cfg={configs.auth_sms_tencent_secret_key}
                  editing={editing}
                  setValue={setValue}
                  type="password"
                  placeholder="SecretKey"
                />
                <ConfigInput
                  cfg={configs.auth_sms_tencent_region}
                  editing={editing}
                  setValue={setValue}
                  placeholder="ap-guangzhou"
                />
                <ConfigInput
                  cfg={configs.auth_sms_tencent_sdk_app_id}
                  editing={editing}
                  setValue={setValue}
                  placeholder="SDK AppId"
                />
                <ConfigInput
                  cfg={configs.auth_sms_tencent_sign_name}
                  editing={editing}
                  setValue={setValue}
                  placeholder="已审核签名"
                />
                <ConfigInput
                  cfg={configs.auth_sms_tencent_template_id}
                  editing={editing}
                  setValue={setValue}
                  placeholder="模板 ID"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-medium">人机验证服务商</h3>
                <p className="text-xs text-muted-foreground">
                  国内可使用免费的浏览器工作量证明；国外可继续使用 Cloudflare Turnstile。
                </p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  { value: 'builtin-pow', label: '浏览器工作量证明', desc: '无第三方费用，自动完成' },
                  { value: 'cloudflare-turnstile', label: 'Cloudflare Turnstile', desc: '适合海外网络' },
                  { value: 'disabled', label: '关闭验证', desc: '仅建议本地开发' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEditing({ ...editing, auth_human_challenge_provider: option.value, feature_turnstile_login: option.value === 'cloudflare-turnstile' ? 'true' : 'false' })}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      challengeProvider === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>
              {challengeProvider === 'builtin-pow' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <ConfigInput cfg={configs.auth_pow_signing_secret} editing={editing} setValue={setValue} type="password" placeholder="至少 32 位随机密钥" />
                  <ConfigInput cfg={configs.auth_pow_difficulty} editing={editing} setValue={setValue} placeholder="4" />
                  <ConfigInput cfg={configs.auth_pow_ttl_seconds} editing={editing} setValue={setValue} placeholder="120" />
                  <p className="md:col-span-2 text-xs text-muted-foreground">建议难度 4–5 个十六进制前导零、有效期 120 秒；难度越高，低性能设备需要更久。</p>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Cloudflare Turnstile</h3>
                  <p className="text-xs text-muted-foreground">
                    Site Key 给前端展示，Secret Key 给后端校验；不要把 Secret 填到 Site Key。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(AUTH_TURNSTILE_KEYS, 'Cloudflare Turnstile')}
                  disabled={isSavingTurnstile}
                >
                  {isSavingTurnstile ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存 Turnstile</span>
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.auth_turnstile_site_key}
                  editing={editing}
                  setValue={setValue}
                  placeholder="0x4AAAA..."
                />
                <ConfigInput
                  cfg={configs.auth_turnstile_secret_key}
                  editing={editing}
                  setValue={setValue}
                  type="password"
                  placeholder="0x4AAAA... secret"
                />
              </div>
            </section>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}

const BACKUP_GENERAL_KEYS = ['backup_enabled', 'backup_schedule', 'backup_local_keep_days'];

const BACKUP_REMOTE_KEYS = [
  'backup_remote_enabled',
  'backup_remote_keep_days',
  'backup_remote_provider',
  'backup_remote_bucket',
  'backup_remote_endpoint',
  'backup_remote_region',
  'backup_remote_prefix',
  'backup_remote_access_key_id',
  'backup_remote_secret_access_key',
];

function BackupSettingsPanel({
  items,
  editing,
  setEditing,
  savingKey,
  saveConfigs,
  backupStatus,
  runningBackup,
  runBackupNow,
}: BackupSettingsPanelProps) {
  const configs = Object.fromEntries(items.map((item) => [item.key, item]));
  const setValue = (key: string, value: string) => setEditing({ ...editing, [key]: value });
  const isSavingGeneral = savingKey === 'group:备份基础策略';
  const isSavingRemote = savingKey === 'group:数据库备份对象存储';
  const remoteEnabled = editing.backup_remote_enabled === 'true';
  const savedRemoteProvider = editing.backup_remote_provider;
  const remoteProvider: ObjectStorageProvider =
    savedRemoteProvider === 'aliyun-oss' ||
    savedRemoteProvider === 'cloudflare-r2' ||
    savedRemoteProvider === 's3-compatible'
      ? savedRemoteProvider
      : inferObjectStorageProvider(editing.backup_remote_endpoint || '');
  const aliyunRegion =
    inferAliyunOssRegion(editing.backup_remote_endpoint || '') ||
    editing.backup_remote_region ||
    'cn-guangzhou';
  const backupRamPolicy = getAliyunOssRamPolicy(editing.backup_remote_bucket || 'your-private-bucket');
  const applyRemoteProviderPreset = (nextProvider: ObjectStorageProvider) => {
    const next: Record<string, string> = { ...editing, backup_remote_provider: nextProvider };
    if (nextProvider !== remoteProvider) {
      next.backup_remote_access_key_id = '';
      next.backup_remote_secret_access_key = '';
    }
    if (nextProvider === 'aliyun-oss') {
      const region = inferAliyunOssRegion(editing.backup_remote_endpoint || '') || 'cn-guangzhou';
      next.backup_remote_region = region;
      next.backup_remote_endpoint = getAliyunOssEndpoint(region, { internal: true });
    } else if (nextProvider === 'cloudflare-r2') {
      next.backup_remote_region = 'auto';
      if (inferObjectStorageProvider(editing.backup_remote_endpoint || '') === 'aliyun-oss') {
        next.backup_remote_endpoint = '';
      }
    } else if (inferObjectStorageProvider(editing.backup_remote_endpoint || '') === 'aliyun-oss') {
      next.backup_remote_region = 'auto';
      next.backup_remote_endpoint = '';
    }
    setEditing(next);
  };
  const setRemoteValue = (key: string, value: string) => {
    const next = { ...editing, [key]: value };
    if (remoteProvider === 'aliyun-oss' && key === 'backup_remote_region') {
      next.backup_remote_endpoint = getAliyunOssEndpoint(value, { internal: true });
    }
    setEditing(next);
  };
  const remoteRequiredKeys = [
    'backup_remote_bucket',
    'backup_remote_endpoint',
    'backup_remote_access_key_id',
    'backup_remote_secret_access_key',
  ];
  const missingRemote = remoteRequiredKeys.filter((key) => !(editing[key] || '').trim());

  return (
    <div className="space-y-4">
      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">备份策略</Badge>
              <span className="text-sm text-muted-foreground">数据库备份、本地保留、私有对象存储</span>
            </div>
            <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
          </summary>
          <CardContent className="space-y-6 border-t pt-5">
            <section className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">最近备份状态</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    手动备份会调用 worker 备份服务，使用后台加密配置；正式恢复仍建议先做临时库演练。
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={runBackupNow} disabled={runningBackup}>
                  {runningBackup ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">{runningBackup ? '备份中' : '立即备份'}</span>
                </Button>
              </div>

              {!backupStatus?.available ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  {backupStatus?.message || '还没有备份状态。保存配置后可先点“立即备份”。'}
                </p>
              ) : (
                <div className="mt-4 grid gap-2 text-sm">
                  <BackupStatusRow
                    label="最近备份时间"
                    value={
                      backupStatus.lastBackupAt
                        ? new Date(backupStatus.lastBackupAt).toLocaleString('zh-CN')
                        : '-'
                    }
                  />
                  <BackupStatusRow
                    label="本地文件"
                    value={backupStatus.lastLocalFile || '-'}
                    monospace
                  />
                  <BackupStatusRow label="文件大小" value={backupStatus.lastLocalSize || '-'} />
                  <BackupStatusRow
                    label="远程上传"
                    value={
                      backupStatus.remoteUploaded
                        ? `已上传 ${backupStatus.lastRemoteKey || ''}`
                        : '未上传'
                    }
                    ok={backupStatus.remoteUploaded}
                  />
                  {backupStatus.warnings && backupStatus.warnings.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {backupStatus.warnings.join('；')}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">基础备份策略</h3>
                  <p className="text-xs text-muted-foreground">
                    备份时间使用服务器本地时间；默认每天 03:00 执行。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(BACKUP_GENERAL_KEYS, '备份基础策略')}
                  disabled={isSavingGeneral}
                >
                  {isSavingGeneral ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存基础策略</span>
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ConfigToggle cfg={configs.backup_enabled} editing={editing} setValue={setValue} />
                <ConfigInput
                  cfg={configs.backup_schedule}
                  editing={editing}
                  setValue={setValue}
                  placeholder="0 3 * * *"
                />
                <ConfigInput
                  cfg={configs.backup_local_keep_days}
                  editing={editing}
                  setValue={setValue}
                  placeholder="7"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">数据库备份对象存储</h3>
                  <p className="text-xs text-muted-foreground">
                    使用独立私有 Bucket 和专用访问凭证，不影响图片/附件对象存储。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    saveConfigs(BACKUP_REMOTE_KEYS, '数据库备份对象存储', {
                      backup_remote_provider: remoteProvider,
                    })
                  }
                  disabled={isSavingRemote || (remoteEnabled && missingRemote.length > 0)}
                  title={
                    remoteEnabled && missingRemote.length > 0
                      ? `缺少 ${missingRemote.length} 个必填项`
                      : undefined
                  }
                >
                  {isSavingRemote ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存远程备份</span>
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                {(
                  [
                    { value: 'aliyun-oss', label: '阿里云 OSS', desc: '国内 ECS 走同地域内网' },
                    { value: 'cloudflare-r2', label: 'Cloudflare R2', desc: '国外 VPS 备份' },
                    { value: 's3-compatible', label: 'S3 兼容', desc: '其他私有对象存储' },
                  ] as Array<{ value: ObjectStorageProvider; label: string; desc: string }>
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => applyRemoteProviderPreset(option.value)}
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${remoteProvider === option.value ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/50'}`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-950">
                <p className="font-medium">备份桶安全边界</p>
                <p className="mt-1">
                  必须使用私有 Bucket；不要绑定 CDN，不要开启公共读，也不需要配置 CORS。数据库备份不得写入
                  ozon-cdn 图片桶。
                </p>
                {remoteProvider === 'aliyun-oss' && (
                  <p className="mt-1 font-mono">
                    ECS 推荐内网 Endpoint：https://oss-{aliyunRegion}-internal.aliyuncs.com
                  </p>
                )}
              </div>

              <div className="rounded-md border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">应急恢复凭证</p>
                <p className="mt-1">
                  另建只读恢复凭证并保存在服务器 root-only 文件中，不要只存于 ERP 数据库；数据库故障时仍应能独立下载备份。
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ConfigToggle
                  cfg={configs.backup_remote_enabled}
                  editing={editing}
                  setValue={setValue}
                />
                <ConfigInput
                  cfg={configs.backup_remote_keep_days}
                  editing={editing}
                  setValue={setValue}
                  placeholder="180"
                />
                <ConfigInput
                  cfg={configs.backup_remote_bucket}
                  editing={editing}
                  setValue={setRemoteValue}
                  placeholder="ss-erp-backups"
                />
                <ConfigInput
                  cfg={configs.backup_remote_endpoint}
                  editing={editing}
                  setValue={setRemoteValue}
                  placeholder={
                    remoteProvider === 'aliyun-oss'
                      ? 'https://oss-cn-guangzhou-internal.aliyuncs.com'
                      : 'S3 API Endpoint'
                  }
                />
                {remoteProvider === 'aliyun-oss' ? (
                  <div className="space-y-2">
                    <Label htmlFor="backup-aliyun-region">阿里云地域</Label>
                    <select
                      id="backup-aliyun-region"
                      value={aliyunRegion}
                      onChange={(event) => setRemoteValue('backup_remote_region', event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {ALIYUN_OSS_REGIONS.map((region) => (
                        <option key={region.value} value={region.value}>
                          {region.label} · {region.value}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">自动使用同地域 ECS 可访问的 OSS 内网 Endpoint。</p>
                  </div>
                ) : (
                  <ConfigInput
                    cfg={configs.backup_remote_region}
                    editing={editing}
                    setValue={setRemoteValue}
                    placeholder="auto"
                  />
                )}
                <ConfigInput
                  cfg={configs.backup_remote_prefix}
                  editing={editing}
                  setValue={setRemoteValue}
                  placeholder="db/daily/"
                />
                <ConfigInput
                  cfg={configs.backup_remote_access_key_id}
                  editing={editing}
                  setValue={setValue}
                  type="password"
                  placeholder="Access Key ID"
                />
                <ConfigInput
                  cfg={configs.backup_remote_secret_access_key}
                  editing={editing}
                  setValue={setValue}
                  type="password"
                  placeholder="Secret Access Key"
                />
              </div>

              {remoteProvider === 'aliyun-oss' && (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    数据库备份 RAM 最小权限
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    为备份专用 RAM 用户创建 Bucket 级策略；不要复用图片上传用户或主账号 AccessKey。
                  </p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-[11px]">
                    {JSON.stringify(backupRamPolicy, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}

const AI_PROVIDER_KEYS = [
  'ai_provider',
  'ai_provider_label',
  'ai_base_url',
  'ai_api_key',
  'ai_model',
  'ai_product_title_model',
  'ai_product_description_model',
  'ai_timeout_ms',
];

const AI_IMAGE_PROVIDER_KEYS = [
  'ai_image_provider',
  'ai_image_base_url',
  'ai_image_api_key',
  'ai_image_model',
];

const AI_IMAGE_TRANSLATION_PROVIDER_KEYS = [
  'ai_image_translation_provider',
  'ai_image_translation_base_url',
  'ai_image_translation_api_key',
  'ai_image_translation_model',
];

const AI_LIMIT_KEYS = [
  'ai_daily_budget_cents',
  'ai_user_daily_category_translation_limit',
  'ai_user_daily_product_generation_limit',
  'ai_user_daily_image_generation_limit',
  'ai_user_daily_image_translation_limit',
  'ai_image_translation_cost_cents',
];

const AI_IMAGE_PROVIDER_PRESETS = [
  { value: 'disabled', label: '关闭', desc: '不允许创建新的生图任务', baseUrl: '', model: '' },
  {
    value: 'dashscope-wanx',
    label: '阿里云百炼 · 通义万相',
    desc: '适合国内部署，使用 DashScope 图像生成接口',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'wanx2.1-t2i-turbo',
  },
  {
    value: 'openai-images',
    label: 'OpenAI Images',
    desc: '适合国外部署，使用 OpenAI Images API',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
  },
] as const;

const AI_IMAGE_TRANSLATION_PROVIDER_PRESETS = [
  {
    value: 'disabled',
    label: '关闭',
    desc: '未通过沙箱门禁前保持关闭',
    baseUrl: '',
    model: 'qwen-mt-image',
  },
  {
    value: 'dashscope-qwen-mt-image',
    label: 'DashScope · qwen-mt-image',
    desc: '图片翻译异步任务；需要 Unit 0B 沙箱证据',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'qwen-mt-image',
  },
] as const;

const AI_FEATURE_KEYS = [
  'ai_category_translation_enabled',
  'ai_product_generation_enabled',
  'ai_image_generation_enabled',
  'feature_image_translate',
];

const AI_PROMPT_KEYS = [
  'ai_category_translation_prompt',
  'ai_product_title_prompt',
  'ai_product_description_prompt',
];

function AiSettingsPanel({
  items,
  editing,
  setEditing,
  savingKey,
  saveConfigs,
  aiUsage,
}: AiSettingsPanelProps) {
  const configs = Object.fromEntries(items.map((item) => [item.key, item]));
  const provider = editing.ai_provider || 'disabled';
  const imageProvider = editing.ai_image_provider || 'disabled';
  const translationProvider = editing.ai_image_translation_provider || 'disabled';
  const [testingImageProvider, setTestingImageProvider] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<{
    ok: boolean;
    message: string;
    fingerprint: string;
  } | null>(null);
  const setValue = (key: string, value: string) => {
    if (AI_IMAGE_PROVIDER_KEYS.includes(key)) setImageTestResult(null);
    setEditing({ ...editing, [key]: value });
  };
  const isSavingProvider = savingKey === 'group:AI 服务';
  const isSavingLimits = savingKey === 'group:AI 额度';
  const isSavingPrompts = savingKey === 'group:AI 提示词';
  const isSavingFeatures = savingKey === 'group:AI 功能开关';
  const providerReady =
    provider === 'custom' &&
    (editing.ai_base_url || '').trim() &&
    (editing.ai_api_key || '').trim() &&
    (editing.ai_model || '').trim();
  const imageProviderReady =
    imageProvider !== 'disabled' &&
    Boolean((editing.ai_image_base_url || '').trim()) &&
    Boolean((editing.ai_image_api_key || '').trim()) &&
    Boolean((editing.ai_image_model || '').trim());
  const imageApiKeyForTest = isSavedMaskedSecret(
    editing.ai_image_api_key || '',
    configs.ai_image_api_key?.value,
  )
    ? ''
    : editing.ai_image_api_key || '';
  const imageTestFingerprint = JSON.stringify({
    provider: imageProvider,
    baseUrl: editing.ai_image_base_url || '',
    apiKey: editing.ai_image_api_key || '',
    model: editing.ai_image_model || '',
  });
  const imageTestFingerprintRef = useRef(imageTestFingerprint);
  imageTestFingerprintRef.current = imageTestFingerprint;

  function selectImageProvider(nextProvider: (typeof AI_IMAGE_PROVIDER_PRESETS)[number]) {
    setImageTestResult(null);
    setEditing({
      ...editing,
      ai_image_provider: nextProvider.value,
      ai_image_base_url: nextProvider.baseUrl,
      ai_image_model: nextProvider.model,
    });
  }

  function selectTranslationProvider(
    nextProvider: (typeof AI_IMAGE_TRANSLATION_PROVIDER_PRESETS)[number],
  ) {
    setEditing({
      ...editing,
      ai_image_translation_provider: nextProvider.value,
      ai_image_translation_base_url: nextProvider.baseUrl,
      ai_image_translation_model: nextProvider.model,
    });
  }

  async function testAiImageProvider() {
    const testedFingerprint = imageTestFingerprint;
    setTestingImageProvider(true);
    setImageTestResult(null);
    try {
      const res = await api.post<{ detail?: string; provider?: string }>(
        '/api/admin/system-status/test/ai-image',
        {
          provider: imageProvider,
          baseUrl: editing.ai_image_base_url || '',
          apiKey: imageApiKeyForTest,
          model: editing.ai_image_model || '',
        },
      );
      const message =
        res.data?.detail ||
        res.msg ||
        (res.code === 1 ? '供应商连接正常' : '连接测试失败，请检查配置');
      if (imageTestFingerprintRef.current !== testedFingerprint) return;
      setImageTestResult({ ok: res.code === 1, message, fingerprint: testedFingerprint });
      toast({
        title: res.code === 1 ? '生图连接正常' : '生图连接失败',
        description: message,
        ...(res.code === 1 ? {} : { variant: 'destructive' as const }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '网络请求失败';
      if (imageTestFingerprintRef.current !== testedFingerprint) return;
      setImageTestResult({ ok: false, message, fingerprint: testedFingerprint });
      toast({ title: '生图连接失败', description: message, variant: 'destructive' });
    } finally {
      setTestingImageProvider(false);
    }
  }


  return (
    <div className="space-y-4">
      <Card>
        <details open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">AI 翻译与生成</Badge>
              <span className="text-sm text-muted-foreground">
                自定义 OpenAI-compatible 接口、缓存、用户每日额度
              </span>
            </div>
            <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
          </summary>
          <CardContent className="space-y-6 border-t pt-5">
            <section className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-medium">AI 服务</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    DeepSeek、MiniMax、OpenRouter、沉浸式翻译网关等统一按自定义兼容接口配置。
                  </p>
                </div>
                <Badge variant={providerReady ? 'default' : 'secondary'}>
                  {providerReady ? '接口已配置' : '默认关闭'}
                </Badge>
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">接口配置</h3>
                  <p className="text-xs text-muted-foreground">
                    Base URL 填到 /v1；系统会请求 /chat/completions。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(AI_PROVIDER_KEYS, 'AI 服务')}
                  disabled={isSavingProvider}
                >
                  {isSavingProvider ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存接口</span>
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {[
                  { value: 'disabled', label: '关闭', desc: '不调用外部 AI' },
                  { value: 'custom', label: '自定义接口', desc: 'OpenAI-compatible' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue('ai_provider', option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      provider === option.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.ai_provider_label}
                  editing={editing}
                  setValue={setValue}
                  placeholder="DeepSeek / MiniMax / 自定义网关"
                />
                <ConfigInput
                  cfg={configs.ai_base_url}
                  editing={editing}
                  setValue={setValue}
                  placeholder="https://api.deepseek.com/v1"
                />
                <ConfigInput
                  cfg={configs.ai_api_key}
                  editing={editing}
                  setValue={setValue}
                  type="password"
                  placeholder="API Key"
                />
                <ConfigInput
                  cfg={configs.ai_model}
                  editing={editing}
                  setValue={setValue}
                  placeholder="deepseek-chat"
                />
                <ConfigInput
                  cfg={configs.ai_product_title_model}
                  editing={editing}
                  setValue={setValue}
                  placeholder="可选：fast title model"
                />
                <ConfigInput
                  cfg={configs.ai_product_description_model}
                  editing={editing}
                  setValue={setValue}
                  placeholder="可选：strong copy model"
                />
                <ConfigInput
                  cfg={configs.ai_timeout_ms}
                  editing={editing}
                  setValue={setValue}
                  placeholder="30000"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-medium">AI 生图基础平台</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    任务与存储基础已就绪；真实生图任务已启用。当前仅支持 text-to-image，
                    用户入口仍受生图功能开关、额度和 Provider 配置控制。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline">任务队列：基础就绪</Badge>
                    <Badge variant="outline">对象存储：基础就绪</Badge>
                    <Badge variant={imageProviderReady ? 'default' : 'secondary'}>
                      {imageProviderReady ? '供应商配置完整' : '等待供应商配置'}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={testAiImageProvider}
                    disabled={!imageProviderReady || testingImageProvider}
                  >
                    {testingImageProvider ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">测试生图连接</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveConfigs(AI_IMAGE_PROVIDER_KEYS, 'AI 生图服务')}
                    disabled={savingKey === 'group:AI 生图服务'}
                  >
                    {savingKey === 'group:AI 生图服务' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">保存生图配置</span>
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-3">
                {AI_IMAGE_PROVIDER_PRESETS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => selectImageProvider(option)}
                    className={[
                      'rounded-md border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      imageProvider === option.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50',
                    ].join(' ')}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.ai_image_base_url}
                  editing={editing}
                  setValue={setValue}
                  placeholder="选择 Provider 后自动填充"
                />
                <ConfigInput
                  cfg={configs.ai_image_model}
                  editing={editing}
                  setValue={setValue}
                  placeholder="选择 Provider 后自动填充"
                />
                <SecretConfigInput
                  cfg={configs.ai_image_api_key}
                  editing={editing}
                  setValue={setValue}
                  placeholder="填写供应商 API Key"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                测试当前表单配置；只验证配置与供应商连通性，不消耗用户每日图片额度。
              </p>

              {imageTestResult?.fingerprint === imageTestFingerprint && (
                <div
                  className={[
                    'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                    imageTestResult.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-destructive/30 bg-destructive/5 text-destructive',
                  ].join(' ')}
                >
                  {imageTestResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{imageTestResult.message}</span>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-medium">图片翻译 Provider</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    采用 qwen-mt-image 异步任务；配置可以先保存，但服务端在沙箱证据通过前不会发起付费请求。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(AI_IMAGE_TRANSLATION_PROVIDER_KEYS, 'AI 图片翻译服务')}
                  disabled={savingKey === 'group:AI 图片翻译服务'}
                >
                  {savingKey === 'group:AI 图片翻译服务' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存翻译配置</span>
                </Button>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {AI_IMAGE_TRANSLATION_PROVIDER_PRESETS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => selectTranslationProvider(option)}
                    className={[
                      'rounded-md border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      translationProvider === option.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50',
                    ].join(' ')}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.ai_image_translation_base_url}
                  editing={editing}
                  setValue={setValue}
                  placeholder="https://dashscope.aliyuncs.com/api/v1"
                />
                <ConfigInput
                  cfg={configs.ai_image_translation_model}
                  editing={editing}
                  setValue={setValue}
                  placeholder="qwen-mt-image"
                />
                <SecretConfigInput
                  cfg={configs.ai_image_translation_api_key}
                  editing={editing}
                  setValue={setValue}
                  placeholder="填写图片翻译 API Key"
                />
              </div>
            </section>

            <AiPromptTemplateEditor />

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">功能与额度</h3>
                  <p className="text-xs text-muted-foreground">
                    缓存命中不扣用户额度；额度只限制新的外部 API 调用。当前图片链路仅开放文生图。
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveConfigs(AI_FEATURE_KEYS, 'AI 功能开关')}
                    disabled={isSavingFeatures}
                  >
                    {isSavingFeatures ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">保存开关</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveConfigs(AI_LIMIT_KEYS, 'AI 额度')}
                    disabled={isSavingLimits}
                  >
                    {isSavingLimits ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">保存额度</span>
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ConfigToggle
                  cfg={configs.ai_category_translation_enabled}
                  editing={editing}
                  setValue={setValue}
                />
                <ConfigToggle
                  cfg={configs.ai_product_generation_enabled}
                  editing={editing}
                  setValue={setValue}
                />
                <ConfigToggle
                  cfg={configs.ai_image_generation_enabled}
                  editing={editing}
                  setValue={setValue}
                />
                <ConfigToggle
                  cfg={configs.feature_image_translate}
                  editing={editing}
                  setValue={setValue}
                />
                <ConfigInput
                  cfg={configs.ai_user_daily_category_translation_limit}
                  editing={editing}
                  setValue={setValue}
                  placeholder="1000"
                />
                <ConfigInput
                  cfg={configs.ai_user_daily_product_generation_limit}
                  editing={editing}
                  setValue={setValue}
                  placeholder="20"
                />
                <ConfigInput
                  cfg={configs.ai_user_daily_image_generation_limit}
                  editing={editing}
                  setValue={setValue}
                  placeholder="5"
                />
                <ConfigInput
                  cfg={configs.ai_user_daily_image_translation_limit}
                  editing={editing}
                  setValue={setValue}
                  placeholder="20"
                />
                <ConfigInput
                  cfg={configs.ai_image_translation_cost_cents}
                  editing={editing}
                  setValue={setValue}
                  placeholder="0"
                />
                <ConfigInput
                  cfg={configs.ai_daily_budget_cents}
                  editing={editing}
                  setValue={setValue}
                  placeholder="0"
                />
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">AI 用量诊断</h3>
                  <p className="text-xs text-muted-foreground">
                    按今天汇总外部请求、缓存命中、失败和 token 用量。
                  </p>
                </div>
                <Badge variant="outline">{aiUsage?.date || '-'}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <MetricChip label="外部请求" value={String(aiUsage?.total?.requestCount ?? 0)} />
                <MetricChip label="缓存命中" value={String(aiUsage?.total?.cacheHitCount ?? 0)} />
                <MetricChip label="失败" value={String(aiUsage?.total?.failureCount ?? 0)} />
                <MetricChip label="Tokens" value={String(aiUsage?.total?.totalTokens ?? 0)} />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {['category_term', 'product_title', 'product_description', 'image_text'].map(
                  (namespace) => {
                    const row = aiUsage?.byNamespace?.[namespace];
                    return (
                      <div
                        key={namespace}
                        className="rounded-md border bg-muted/20 px-3 py-2 text-xs"
                      >
                        <div className="font-medium">{namespace}</div>
                        <div className="mt-1 text-muted-foreground">
                          请求 {row?.requestCount ?? 0} / 缓存 {row?.cacheHitCount ?? 0} / 失败{' '}
                          {row?.failureCount ?? 0} / tokens {row?.totalTokens ?? 0}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </section>

            <details className="rounded-md border p-4">
              <summary className="cursor-pointer text-sm font-medium">提示词</summary>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    类目翻译和商品生成提示词分开保存，避免互相污染缓存。
                  </p>
                  <Button
                    size="sm"
                    onClick={() => saveConfigs(AI_PROMPT_KEYS, 'AI 提示词')}
                    disabled={isSavingPrompts}
                  >
                    {isSavingPrompts ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">保存提示词</span>
                  </Button>
                </div>
                <div className="grid gap-3">
                  <ConfigInput
                    cfg={configs.ai_category_translation_prompt}
                    editing={editing}
                    setValue={setValue}
                  />
                  <ConfigInput
                    cfg={configs.ai_product_title_prompt}
                    editing={editing}
                    setValue={setValue}
                  />
                  <ConfigInput
                    cfg={configs.ai_product_description_prompt}
                    editing={editing}
                    setValue={setValue}
                  />
                </div>
              </div>
            </details>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}
function BackupStatusRow({
  label,
  value,
  monospace = false,
  ok,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`flex min-w-0 items-center gap-1 text-right ${monospace ? 'font-mono text-xs' : ''}`}
      >
        {typeof ok === 'boolean' &&
          (ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ))}
        <span className="truncate" title={value}>
          {value}
        </span>
      </span>
    </div>
  );
}

const R2_REQUIRED_KEYS = [
  'upload_oss_endpoint',
  'upload_oss_bucket',
  'upload_oss_access_key_id',
  'upload_oss_access_key_secret',
  'upload_oss_region',
];

const R2_REQUIRED_LABELS: Record<string, string> = {
  upload_oss_endpoint: 'Endpoint',
  upload_oss_bucket: 'Bucket',
  upload_oss_access_key_id: 'Access Key ID',
  upload_oss_access_key_secret: 'Secret Access Key',
  upload_oss_region: 'Region',
};

const UPLOAD_SECURITY_KEYS = [
  'upload_rate_limit_enabled',
  'upload_rate_limit_per_minute',
  'upload_daily_quota_enabled',
  'upload_daily_quota_mb',
  'upload_referer_check_enabled',
];

const UPLOAD_ADVANCED_KEYS = [
  'upload_oss_cdn_domain',
  'upload_ozon_cdn_relay_url',
  'upload_local_base_url',
];

const RECOMMENDED_UPLOAD_BASE_URL = process.env.NEXT_PUBLIC_USER_HOSTNAME
  ? `https://${process.env.NEXT_PUBLIC_USER_HOSTNAME}`
  : 'https://app.ss-erp.com';

function UploadSettingsPanel({
  items,
  editing,
  setEditing,
  savingKey,
  saveConfig,
  saveConfigs,
}: UploadSettingsPanelProps) {
  const configs = Object.fromEntries(items.map((item) => [item.key, item]));
  const mode = editing.upload_storage_backend || 'env';
  const isSavingMode = savingKey === 'upload_storage_backend';
  const isSavingR2 = savingKey === 'group:S3 兼容对象存储';
  const isSavingSecurity = savingKey === 'group:上传保护';
  const isSavingAdvanced = savingKey === 'group:上传高级选项';

  const setValue = (key: string, value: string) => setEditing({ ...editing, [key]: value });
  const inferredProvider = inferObjectStorageProvider(editing.upload_oss_endpoint || '');
  const savedProvider = editing.upload_oss_provider as ObjectStorageProvider | undefined;
  const provider =
    savedProvider && !(savedProvider === 's3-compatible' && inferredProvider !== 's3-compatible')
      ? savedProvider
      : inferredProvider;
  const providerLabel =
    provider === 'aliyun-oss'
      ? '阿里云 OSS'
      : provider === 'cloudflare-r2'
        ? 'Cloudflare R2'
        : 'S3 兼容';
  const aliyunRamPolicy =
    provider === 'aliyun-oss' && editing.upload_oss_bucket
      ? JSON.stringify(getAliyunOssRamPolicy(editing.upload_oss_bucket), null, 2)
      : '';

  const applyProviderPreset = (nextProvider: ObjectStorageProvider) => {
    const preset = getObjectStorageProviderPreset(nextProvider, {
      region: editing.upload_oss_region,
      bucket: editing.upload_oss_bucket,
    });
    const next: Record<string, string> = {
      ...editing,
      upload_oss_provider: nextProvider,
      upload_storage_backend: 'oss',
    };
    if (nextProvider === 'aliyun-oss') {
      next.upload_oss_region = preset.region;
      next.upload_oss_endpoint = preset.endpoint;
      next.upload_oss_cdn_domain = preset.publicDomain;
    } else if (nextProvider === 'cloudflare-r2') {
      next.upload_oss_region = 'auto';
      if (inferObjectStorageProvider(editing.upload_oss_endpoint || '') !== 'cloudflare-r2') {
        next.upload_oss_endpoint = '';
        next.upload_oss_cdn_domain = '';
      }
    } else if (inferObjectStorageProvider(editing.upload_oss_endpoint || '') !== 's3-compatible') {
      next.upload_oss_region = 'auto';
      next.upload_oss_endpoint = '';
      next.upload_oss_cdn_domain = '';
    }
    setEditing(next);
  };

  const setStorageValue = (key: string, value: string) => {
    const next = { ...editing, [key]: value };
    if (provider === 'aliyun-oss' && (key === 'upload_oss_region' || key === 'upload_oss_bucket')) {
      const preset = getObjectStorageProviderPreset('aliyun-oss', {
        region: next.upload_oss_region,
        bucket: next.upload_oss_bucket,
      });
      next.upload_oss_endpoint = preset.endpoint;
      next.upload_oss_cdn_domain = preset.publicDomain;
    }
    setEditing(next);
  };
  const filledR2Count = R2_REQUIRED_KEYS.filter(
    (key) => (editing[key] || '').trim().length > 0,
  ).length;
  const missingR2Keys = R2_REQUIRED_KEYS.filter((key) => (editing[key] || '').trim().length === 0);
  const hasAllR2Required = missingR2Keys.length === 0;
  const isR2Ready = filledR2Count === R2_REQUIRED_KEYS.length && mode === 'oss';

  return (
    <div className="space-y-4">
      <Card>
        <details open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">上传与对象存储</Badge>
              <span className="text-sm text-muted-foreground">S3 兼容对象存储配置中心</span>
            </div>
            <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
          </summary>
          <CardContent className="space-y-6 border-t pt-5">
            <section className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-medium">对象存储状态</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这里是图片和公告附件上传用的对象存储，不是数据库备份。填完必填项后，到"接口与集成"页面点
                    OSS 测试。
                  </p>
                </div>
                <Badge variant={isR2Ready ? 'default' : 'secondary'}>
                  {isR2Ready
                    ? `${providerLabel} 已启用`
                    : `对象存储必填项 ${filledR2Count}/${R2_REQUIRED_KEYS.length}`}
                </Badge>
              </div>
              {!isR2Ready && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {!hasAllR2Required ? (
                    <>
                      <span className="font-medium">还不能测试对象存储：</span>
                      <span>
                        缺少 {missingR2Keys.map((key) => R2_REQUIRED_LABELS[key] || key).join('、')}
                        。
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">连接参数已填完，但尚未启用：</span>
                      <span>请保存对象存储配置，系统会自动切换为 S3 兼容模式。</span>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">存储模式</h3>
                  <p className="text-xs text-muted-foreground">
                    当前：
                    {mode === 'oss'
                      ? providerLabel
                      : mode === 'ozon-cdn'
                        ? 'OZON CDN'
                        : mode === 'local'
                          ? '本地存储'
                          : '跟随服务器环境'}
                    {mode === 'env' && filledR2Count > 0
                      ? '，已检测到部分对象存储配置但还没启用'
                      : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => saveConfig('upload_storage_backend')}
                  disabled={
                    isSavingMode ||
                    editing.upload_storage_backend === configs.upload_storage_backend?.value
                  }
                >
                  {isSavingMode ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">保存模式</span>
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                {[
                  { value: 'oss', label: 'S3 对象存储', desc: '阿里云 OSS / R2 / S3' },
                  { value: 'env', label: '服务器环境', desc: '高级：读取 .env' },
                  { value: 'ozon-cdn', label: 'OZON CDN', desc: '备用旧链路' },
                  { value: 'local', label: '本地存储', desc: '离线版' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue('upload_storage_backend', option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      mode === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-medium">服务商预设</h3>
                <p className="text-xs text-muted-foreground">
                  选择服务商后自动填充 Endpoint、Region 和推荐公网域名；AccessKey 不会被自动修改。
                </p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(
                  [
                    { value: 'aliyun-oss', label: '阿里云 OSS', desc: '国内 ECS 与 Ozon 图床' },
                    { value: 'cloudflare-r2', label: 'Cloudflare R2', desc: '国外 VPS 与全球访问' },
                    { value: 's3-compatible', label: 'S3 兼容', desc: 'AWS S3、MinIO 或其他服务' },
                  ] as Array<{ value: ObjectStorageProvider; label: string; desc: string }>
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => applyProviderPreset(option.value)}
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${provider === option.value ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/50'}`}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.desc}</span>
                  </button>
                ))}
              </div>
              {provider === 'aliyun-oss' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="aliyun-oss-region">阿里云地域</Label>
                    <select
                      id="aliyun-oss-region"
                      value={editing.upload_oss_region || 'cn-guangzhou'}
                      onChange={(event) => setStorageValue('upload_oss_region', event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {ALIYUN_OSS_REGIONS.map((region) => (
                        <option key={region.value} value={region.value}>
                          {region.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">阿里云检查项</p>
                    <p className="mt-1">
                      保存前确认 Bucket 公共读、RAM 最小权限和 CORS。HeadBucket
                      兼容告警不影响上传、读取和删除测试。
                    </p>
                    {aliyunRamPolicy && (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-medium text-foreground">
                          RAM 最小权限策略
                        </summary>
                        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px]">
                          {aliyunRamPolicy}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">自动填充 Endpoint</Badge>
                <Badge variant="outline">测试公网匿名读取</Badge>
                <Badge variant="outline">RAM 最小权限</Badge>
              </div>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">对象存储必填项</h3>
                  <p className="text-xs text-muted-foreground">
                    填写连接与凭据后即可测试上传；阿里云 OSS 会根据地域和 Bucket 自动生成推荐地址。
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    saveConfigs(
                      [
                        'upload_storage_backend',
                        'upload_oss_provider',
                        ...R2_REQUIRED_KEYS,
                        'upload_oss_cdn_domain',
                      ],
                      'S3 兼容对象存储',
                      { upload_storage_backend: 'oss', upload_oss_provider: provider },
                    )
                  }
                  disabled={isSavingR2 || !hasAllR2Required}
                  title={!hasAllR2Required ? '请先补齐对象存储必填项' : undefined}
                >
                  {isSavingR2 ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">
                    {hasAllR2Required ? '保存对象存储' : `缺少 ${missingR2Keys.length} 项`}
                  </span>
                </Button>
              </div>

              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                服务端统一使用 S3 兼容接口；选择服务商后可自动填充 Endpoint、Region 和推荐公网域名。
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <ConfigInput
                  cfg={configs.upload_oss_endpoint}
                  editing={editing}
                  setValue={setValue}
                  placeholder="https://<account-id>.r2.cloudflarestorage.com"
                />
                <ConfigInput
                  cfg={configs.upload_oss_bucket}
                  editing={editing}
                  setValue={setStorageValue}
                  placeholder="Bucket 名称"
                />
                <ConfigInput
                  cfg={configs.upload_oss_access_key_id}
                  editing={editing}
                  setValue={setValue}
                  placeholder="Access Key ID"
                />
                <ConfigInput
                  cfg={configs.upload_oss_access_key_secret}
                  editing={editing}
                  setValue={setValue}
                  placeholder="Secret Access Key"
                  type="password"
                />
                {provider !== 'aliyun-oss' && (
                  <ConfigInput
                    cfg={configs.upload_oss_region}
                    editing={editing}
                    setValue={setStorageValue}
                    placeholder="auto"
                  />
                )}
              </div>

              <details className="rounded-md border border-dashed px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">
                  高级可选：自定义访问域名 / 旧 CDN / 本地 Base URL
                </summary>
                <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      公网域名留空并走 /api/cdn 代理时，建议把{' '}
                      <code className="font-mono">upload_local_base_url</code> 设为{' '}
                      {RECOMMENDED_UPLOAD_BASE_URL}。
                    </p>
                    <p>
                      <code className="font-mono">upload_oss_cdn_domain</code> 可填写阿里云 Bucket
                      公网域名、CDN 域名、R2 自定义域名或 r2.dev。
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setValue('upload_local_base_url', RECOMMENDED_UPLOAD_BASE_URL)}
                    >
                      填入推荐 Base URL
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => saveConfigs(UPLOAD_ADVANCED_KEYS, '上传高级选项')}
                      disabled={isSavingAdvanced}
                    >
                      {isSavingAdvanced ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1">保存高级选项</span>
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ConfigInput
                    cfg={configs.upload_oss_cdn_domain}
                    editing={editing}
                    setValue={setValue}
                    placeholder="自定义 CDN 域名，可留空"
                  />
                  <ConfigInput
                    cfg={configs.upload_ozon_cdn_relay_url}
                    editing={editing}
                    setValue={setValue}
                    placeholder="OZON CDN 中转，可留空"
                  />
                  <ConfigInput
                    cfg={configs.upload_local_base_url}
                    editing={editing}
                    setValue={setValue}
                    placeholder={RECOMMENDED_UPLOAD_BASE_URL}
                  />
                </div>
              </details>
            </section>

            <details className="rounded-md border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                上传保护（默认值够用，测试 R2 可先不改）
              </summary>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    频率限制、每日配额和 /cdn 防盗链。用户量上来或被刷上传时再重点调整。
                  </p>
                  <Button
                    size="sm"
                    onClick={() => saveConfigs(UPLOAD_SECURITY_KEYS, '上传保护')}
                    disabled={isSavingSecurity}
                  >
                    {isSavingSecurity ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">保存保护</span>
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <ConfigToggle
                    cfg={configs.upload_rate_limit_enabled}
                    editing={editing}
                    setValue={setValue}
                  />
                  <ConfigInput
                    cfg={configs.upload_rate_limit_per_minute}
                    editing={editing}
                    setValue={setValue}
                  />
                  <ConfigToggle
                    cfg={configs.upload_daily_quota_enabled}
                    editing={editing}
                    setValue={setValue}
                  />
                  <ConfigInput
                    cfg={configs.upload_daily_quota_mb}
                    editing={editing}
                    setValue={setValue}
                  />
                  <ConfigToggle
                    cfg={configs.upload_referer_check_enabled}
                    editing={editing}
                    setValue={setValue}
                  />
                </div>
              </div>
            </details>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}

function SecretConfigInput({
  cfg,
  editing,
  setValue,
  placeholder,
}: {
  cfg?: SystemConfig;
  editing: Record<string, string>;
  setValue: (key: string, value: string) => void;
  placeholder?: string;
}) {
  if (!cfg) return null;
  const value = editing[cfg.key] || '';
  const hasSavedSecret = isSavedMaskedSecret(value, cfg.value);
  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-sm font-medium">{cfg.label || cfg.key}</Label>
        <code className="ml-2 text-[11px] text-muted-foreground">{cfg.key}</code>
      </div>
      {cfg.description && <p className="text-xs text-muted-foreground">{cfg.description}</p>}
      <Input
        type="password"
        autoComplete="new-password"
        value={hasSavedSecret ? '' : value}
        onChange={(event) => setValue(cfg.key, event.target.value)}
        placeholder={hasSavedSecret ? '留空保留已保存密钥' : placeholder}
      />
      <p className="text-xs text-muted-foreground">
        {hasSavedSecret
          ? '密钥已保存；留空表示保留原密钥'
          : '密钥保存后不会回显；再次输入将覆盖原密钥'}
      </p>
    </div>
  );
}

function ConfigInput({
  cfg,
  editing,
  setValue,
  placeholder,
  type = 'text',
}: {
  cfg?: SystemConfig;
  editing: Record<string, string>;
  setValue: (key: string, value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  if (!cfg) return null;
  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-sm font-medium">{cfg.label || cfg.key}</Label>
        <code className="ml-2 text-[11px] text-muted-foreground">{cfg.key}</code>
      </div>
      {cfg.description && <p className="text-xs text-muted-foreground">{cfg.description}</p>}
      <Input
        type={type}
        value={editing[cfg.key] || ''}
        onChange={(event) => setValue(cfg.key, event.target.value)}
        placeholder={placeholder || cfg.description || ''}
      />
    </div>
  );
}

function ConfigToggle({
  cfg,
  editing,
  setValue,
}: {
  cfg?: SystemConfig;
  editing: Record<string, string>;
  setValue: (key: string, value: string) => void;
}) {
  if (!cfg) return null;
  const enabled = editing[cfg.key] === 'true';
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
      <div>
        <Label className="text-sm font-medium">{cfg.label || cfg.key}</Label>
        {cfg.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setValue(cfg.key, enabled ? 'false' : 'true')}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
