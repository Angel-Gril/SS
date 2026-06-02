'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Settings as SettingsIcon, AlertCircle, HardDrive, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface SystemConfig {
  id: string;
  key: string;
  value: string;
  label: string | null;
  group: string;
  description: string | null;
  updatedAt: string;
}

interface BackupStatus {
  available: boolean;
  message?: string;
  lastBackupAt?: string;
  lastLocalFile?: string;
  lastLocalSize?: string;
  remoteUploaded?: boolean;
  lastRemoteKey?: string;
}

const GROUP_LABELS: Record<string, string> = {
  feature: '功能开关',
  auth: '短信与人机验证',
  upload: '上传与对象存储',
  retention: '数据保留',
  backup: '备份策略',
  maintenance: '维护模式',
  version: '版本更新',
  randomize: '随机化（货号/尺寸/重量）',
  general: '通用',
};

const GROUP_ORDER = ['maintenance', 'auth', 'feature', 'upload', 'retention', 'backup', 'version', 'randomize', 'general'];

export default function AdminSettingsPage() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => { fetchConfigs(); }, []);

  async function fetchConfigs() {
    setLoading(true);
    const [configRes, backupRes] = await Promise.all([
      api.get<SystemConfig[]>('/api/admin/system-config'),
      api.get<BackupStatus>('/api/admin/ops/backup-status'),
    ]);
    if (configRes.code === 1 && configRes.data) {
      const filtered = configRes.data.filter((c) => !['storage', 'security', 'integration'].includes(c.group));
      setConfigs(filtered);
      const map: Record<string, string> = {};
      filtered.forEach((c) => { map[c.key] = c.value; });
      setEditing(map);
    } else if (configRes.code === 0) {
      await api.post('/api/admin/system-config/seed', {});
      const res2 = await api.get<SystemConfig[]>('/api/admin/system-config');
      if (res2.code === 1 && res2.data) {
        const filtered = res2.data.filter((c) => !['storage', 'security', 'integration'].includes(c.group));
        setConfigs(filtered);
        const map: Record<string, string> = {};
        filtered.forEach((c) => { map[c.key] = c.value; });
        setEditing(map);
      }
    }
    if (backupRes.code === 1 && backupRes.data) setBackupStatus(backupRes.data);
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

  async function saveConfigs(keys: string[], label: string, overrides: Record<string, string> = {}) {
    const available = keys.filter((key) => Object.prototype.hasOwnProperty.call(editing, key));
    setSavingKey(`group:${label}`);
    for (const key of available) {
      const res = await api.put(`/api/admin/system-config/${key}`, { value: overrides[key] ?? editing[key] ?? '' });
      if (res.code !== 1) {
        setSavingKey(null);
        toast({ title: '保存失败', description: `${key}: ${res.msg || '未知错误'}`, variant: 'destructive' });
        return;
      }
    }
    setSavingKey(null);
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
            常用配置默认展开，高级运维参数默认收起。当前 R2 上传测试只需要填写"上传与对象存储"里的 R2 必填项。
          </p>
        </div>
        <Button variant="outline" onClick={initDefaults}>初始化默认配置</Button>
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

        return (
          <div key={group} className="space-y-4">
            {group === 'backup' && backupStatus && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">最近备份状态</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {!backupStatus.available ? (
                    <p className="text-sm text-muted-foreground">{backupStatus.message || '备份状态不可用'}</p>
                  ) : (
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">最近备份时间</span>
                        <span>{backupStatus.lastBackupAt ? new Date(backupStatus.lastBackupAt).toLocaleString('zh-CN') : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">本地文件</span>
                        <code className="text-xs">{backupStatus.lastLocalFile || '—'}</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">文件大小</span>
                        <span>{backupStatus.lastLocalSize || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">远程上传</span>
                        <span className="flex items-center gap-1">
                          {backupStatus.remoteUploaded
                            ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> 已上传</>
                            : <><XCircle className="h-3.5 w-3.5 text-muted-foreground" /> 未上传</>
                          }
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
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
                    <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
                  </summary>
                <CardContent className="space-y-5 border-t pt-5">
                  {group === 'backup' && (
                    <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
                      这里配置的是数据库备份的远程存储（`backup_remote_*`），不影响图片/附件上传。
                      图片/附件对象存储请在"上传与对象存储"里配置 `upload_*`。
                    </p>
                  )}
                  {items.map((cfg) => (
                    <div key={cfg.key} className="space-y-2 pb-4 border-b last:border-b-0 last:pb-0">
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
                        {savingKey === cfg.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        <span className="ml-1">保存</span>
                      </Button>
                    </div>

                    {editing[cfg.key] === 'true' || editing[cfg.key] === 'false' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing({ ...editing, [cfg.key]: editing[cfg.key] === 'true' ? 'false' : 'true' })}
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
                        <span className="text-sm">{editing[cfg.key] === 'true' ? '已启用' : '已禁用'}</span>
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

interface UploadSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfig: (key: string) => Promise<void>;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
}

interface AuthSettingsPanelProps {
  items: SystemConfig[];
  editing: Record<string, string>;
  setEditing: (next: Record<string, string>) => void;
  savingKey: string | null;
  saveConfigs: (keys: string[], label: string, overrides?: Record<string, string>) => Promise<void>;
}

const AUTH_GENERAL_KEYS = [
  'feature_sms_register',
  'feature_turnstile_login',
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
              <span className="text-sm text-muted-foreground">注册短信、登录人机验证、测试短信白名单</span>
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
                {isSavingAuth ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span className="ml-1">保存验证配置</span>
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="grid gap-4 md:grid-cols-2">
              <ConfigToggle cfg={configs.feature_sms_register} editing={editing} setValue={setValue} />
              <ConfigToggle cfg={configs.feature_turnstile_login} editing={editing} setValue={setValue} />
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div>
              <h3 className="text-sm font-medium">短信服务来源</h3>
              <p className="text-xs text-muted-foreground">正式云端建议选择腾讯云短信；env 表示继续读取服务器环境变量。</p>
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
                    provider === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.desc}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <ConfigInput cfg={configs.auth_sms_code_ttl_seconds} editing={editing} setValue={setValue} placeholder="300" />
              <ConfigInput cfg={configs.auth_sms_rate_limit_seconds} editing={editing} setValue={setValue} placeholder="60" />
              <ConfigInput cfg={configs.auth_sms_test_phone_whitelist} editing={editing} setValue={setValue} placeholder="13800138000,13900139000" />
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">腾讯云短信</h3>
                <p className="text-xs text-muted-foreground">模板变量当前按 {`{1}=验证码`} 发送，腾讯云模板需保持一致。</p>
              </div>
              <Button
                size="sm"
                onClick={() => saveConfigs(['auth_sms_provider', ...AUTH_TENCENT_KEYS], '腾讯云短信', { auth_sms_provider: 'tencent' })}
                disabled={isSavingTencent}
              >
                {isSavingTencent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span className="ml-1">保存腾讯云短信</span>
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <ConfigInput cfg={configs.auth_sms_tencent_secret_id} editing={editing} setValue={setValue} type="password" placeholder="SecretId" />
              <ConfigInput cfg={configs.auth_sms_tencent_secret_key} editing={editing} setValue={setValue} type="password" placeholder="SecretKey" />
              <ConfigInput cfg={configs.auth_sms_tencent_region} editing={editing} setValue={setValue} placeholder="ap-guangzhou" />
              <ConfigInput cfg={configs.auth_sms_tencent_sdk_app_id} editing={editing} setValue={setValue} placeholder="SDK AppId" />
              <ConfigInput cfg={configs.auth_sms_tencent_sign_name} editing={editing} setValue={setValue} placeholder="已审核签名" />
              <ConfigInput cfg={configs.auth_sms_tencent_template_id} editing={editing} setValue={setValue} placeholder="模板 ID" />
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">Cloudflare Turnstile</h3>
                <p className="text-xs text-muted-foreground">Site Key 给前端展示，Secret Key 给后端校验；不要把 Secret 填到 Site Key。</p>
              </div>
              <Button
                size="sm"
                onClick={() => saveConfigs(AUTH_TURNSTILE_KEYS, 'Cloudflare Turnstile')}
                disabled={isSavingTurnstile}
              >
                {isSavingTurnstile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span className="ml-1">保存 Turnstile</span>
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ConfigInput cfg={configs.auth_turnstile_site_key} editing={editing} setValue={setValue} placeholder="0x4AAAA..." />
              <ConfigInput cfg={configs.auth_turnstile_secret_key} editing={editing} setValue={setValue} type="password" placeholder="0x4AAAA... secret" />
            </div>
          </section>
          </CardContent>
        </details>
      </Card>
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
  const isSavingR2 = savingKey === 'group:R2 对象存储';
  const isSavingSecurity = savingKey === 'group:上传保护';
  const isSavingAdvanced = savingKey === 'group:上传高级选项';

  const setValue = (key: string, value: string) => setEditing({ ...editing, [key]: value });
  const filledR2Count = R2_REQUIRED_KEYS.filter((key) => (editing[key] || '').trim().length > 0).length;
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
              <span className="text-sm text-muted-foreground">当前重点：R2 图片/附件上传测试</span>
            </div>
            <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
          </summary>
          <CardContent className="space-y-6 border-t pt-5">
          <section className="rounded-md border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-medium">R2 测试状态</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  这里是图片和公告附件上传用的对象存储，不是数据库备份。填完必填项后，到"接口与集成"页面点 OSS 测试。
                </p>
              </div>
              <Badge variant={isR2Ready ? 'default' : 'secondary'}>
                {isR2Ready ? 'R2 已启用' : `R2 必填项 ${filledR2Count}/${R2_REQUIRED_KEYS.length}`}
              </Badge>
            </div>
            {!isR2Ready && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {!hasAllR2Required ? (
                  <>
                    <span className="font-medium">还不能测试 R2 上传：</span>
                    <span>缺少 {missingR2Keys.map((key) => R2_REQUIRED_LABELS[key] || key).join('、')}。</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium">R2 参数已填完，但尚未启用：</span>
                    <span>请点击“保存 R2”，系统会自动切换为 R2 / OSS 模式。</span>
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
                  当前：{mode === 'oss' ? 'R2/OSS' : mode === 'ozon-cdn' ? 'OZON CDN' : mode === 'local' ? '本地存储' : '跟随服务器环境'}
                  {mode === 'env' && filledR2Count > 0 ? '，已检测到部分 R2 配置但还没切换到 R2' : ''}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => saveConfig('upload_storage_backend')}
                disabled={isSavingMode || editing.upload_storage_backend === configs.upload_storage_backend?.value}
              >
                {isSavingMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span className="ml-1">保存模式</span>
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              {[
                { value: 'oss', label: 'R2 / OSS', desc: '云端推荐' },
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

          <section className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">R2 必填项</h3>
                <p className="text-xs text-muted-foreground">只填下面 5 项即可开始测试上传；保存会自动切换为 R2/OSS 模式。</p>
              </div>
              <Button
                size="sm"
                onClick={() => saveConfigs(['upload_storage_backend', ...R2_REQUIRED_KEYS], 'R2 对象存储', { upload_storage_backend: 'oss' })}
                disabled={isSavingR2 || !hasAllR2Required}
                title={!hasAllR2Required ? '请先补齐 R2 必填项' : undefined}
              >
                {isSavingR2 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span className="ml-1">{hasAllR2Required ? '保存 R2' : `缺少 ${missingR2Keys.length} 项`}</span>
              </Button>
            </div>

            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Cloudflare R2 的 Endpoint 只是连接地址；Bucket 名称和 R2 API Token 生成的 Access Key ID / Secret Access Key 也必须填写。
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <ConfigInput cfg={configs.upload_oss_endpoint} editing={editing} setValue={setValue} placeholder="https://<account-id>.r2.cloudflarestorage.com" />
              <ConfigInput cfg={configs.upload_oss_bucket} editing={editing} setValue={setValue} placeholder="Bucket 名称" />
              <ConfigInput cfg={configs.upload_oss_access_key_id} editing={editing} setValue={setValue} placeholder="Access Key ID" />
              <ConfigInput cfg={configs.upload_oss_access_key_secret} editing={editing} setValue={setValue} placeholder="Secret Access Key" type="password" />
              <ConfigInput cfg={configs.upload_oss_region} editing={editing} setValue={setValue} placeholder="auto" />
            </div>

            <details className="rounded-md border border-dashed px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">高级可选：自定义访问域名 / 旧 CDN / 本地 Base URL</summary>
              <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    当前走 /api/cdn 代理时，建议把 <code className="font-mono">upload_local_base_url</code> 设为 {RECOMMENDED_UPLOAD_BASE_URL}。
                  </p>
                  <p>
                    <code className="font-mono">upload_oss_cdn_domain</code> 保持为空，除非你配置了 R2 自定义公开域名或 r2.dev。
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
                    {isSavingAdvanced ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    <span className="ml-1">保存高级选项</span>
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <ConfigInput cfg={configs.upload_oss_cdn_domain} editing={editing} setValue={setValue} placeholder="自定义 CDN 域名，可留空" />
                <ConfigInput cfg={configs.upload_ozon_cdn_relay_url} editing={editing} setValue={setValue} placeholder="OZON CDN 中转，可留空" />
                <ConfigInput cfg={configs.upload_local_base_url} editing={editing} setValue={setValue} placeholder={RECOMMENDED_UPLOAD_BASE_URL} />
              </div>
            </details>
          </section>

          <details className="rounded-md border p-4">
            <summary className="cursor-pointer text-sm font-medium">上传保护（默认值够用，测试 R2 可先不改）</summary>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">频率限制、每日配额和 /cdn 防盗链。用户量上来或被刷上传时再重点调整。</p>
                <Button
                  size="sm"
                  onClick={() => saveConfigs(UPLOAD_SECURITY_KEYS, '上传保护')}
                  disabled={isSavingSecurity}
                >
                  {isSavingSecurity ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span className="ml-1">保存保护</span>
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <ConfigToggle cfg={configs.upload_rate_limit_enabled} editing={editing} setValue={setValue} />
                <ConfigInput cfg={configs.upload_rate_limit_per_minute} editing={editing} setValue={setValue} />
                <ConfigToggle cfg={configs.upload_daily_quota_enabled} editing={editing} setValue={setValue} />
                <ConfigInput cfg={configs.upload_daily_quota_mb} editing={editing} setValue={setValue} />
                <ConfigToggle cfg={configs.upload_referer_check_enabled} editing={editing} setValue={setValue} />
              </div>
            </div>
          </details>
          </CardContent>
        </details>
      </Card>
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
        {cfg.description && <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>}
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
