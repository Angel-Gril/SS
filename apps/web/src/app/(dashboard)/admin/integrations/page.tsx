'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertCircle, Plug, TestTube2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface IntegrationCheck {
  key: string;
  label: string;
  configured: boolean;
  source: 'env' | 'db' | 'mixed';
  detail?: string;
}

interface SystemConfig {
  id: string;
  key: string;
  value: string;
  label: string | null;
  group: string;
  description: string | null;
}

const OSS_PRESETS: Array<{ label: string; endpoint: string; region: string }> = [
  { label: '阿里云 OSS（杭州）', endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', region: 'cn-hangzhou' },
  { label: '阿里云 OSS（上海）', endpoint: 'https://oss-cn-shanghai.aliyuncs.com', region: 'cn-shanghai' },
  { label: '腾讯云 COS（广州）', endpoint: 'https://cos.ap-guangzhou.myqcloud.com', region: 'ap-guangzhou' },
  { label: 'Cloudflare R2', endpoint: 'https://<account-id>.r2.cloudflarestorage.com', region: 'auto' },
  { label: 'AWS S3（us-east-1）', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1' },
];

const STORAGE_BACKEND_OPTIONS = [
  { value: 'local', label: '本地存储', desc: '仅本地版/开发测试使用，OZON 必须能访问 local_base_url' },
  { value: 'ozon-cdn', label: 'OZON CDN', desc: '复用店铺 seller cookie 上传到 OZON 临时 CDN' },
  { value: 'oss', label: 'OSS 对象存储', desc: '云端推荐，支持失败后自动降级到 OZON CDN' },
];

export default function AdminIntegrationsPage() {
  const [checks, setChecks] = useState<IntegrationCheck[]>([]);
  const [backendConfig, setBackendConfig] = useState<SystemConfig | null>(null);
  const [ossConfig, setOssConfig] = useState<SystemConfig | null>(null);
  const [relayConfig, setRelayConfig] = useState<SystemConfig | null>(null);
  const [integrationConfigs, setIntegrationConfigs] = useState<SystemConfig[]>([]);
  const [editingBackend, setEditingBackend] = useState<string>('local');
  const [editingOss, setEditingOss] = useState<string>('');
  const [editingRelay, setEditingRelay] = useState<string>('');
  const [editingIntegration, setEditingIntegration] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [statusRes, storageRes, integrationRes] = await Promise.all([
      api.get<{ checks: IntegrationCheck[] }>('/api/admin/system-status/integrations'),
      api.get<SystemConfig[]>('/api/admin/system-config?group=storage'),
      api.get<SystemConfig[]>('/api/admin/system-config?group=integration'),
    ]);
    if (statusRes.code === 1 && statusRes.data) setChecks(statusRes.data.checks);
    if (storageRes.code === 1 && storageRes.data) {
      const backend = storageRes.data.find((c) => c.key === 'image_storage_backend') || null;
      const oss = storageRes.data.find((c) => c.key === 'oss_config') || null;
      const relay = storageRes.data.find((c) => c.key === 'ozon_cdn_relay_url') || null;
      setBackendConfig(backend);
      setOssConfig(oss);
      setRelayConfig(relay);
      setEditingBackend(backend?.value || 'local');
      setEditingOss(oss?.value || '');
      setEditingRelay(relay?.value || '');
    }
    if (integrationRes.code === 1 && integrationRes.data) {
      setIntegrationConfigs(integrationRes.data);
      const map: Record<string, string> = {};
      integrationRes.data.forEach((c) => { map[c.key] = c.value; });
      setEditingIntegration(map);
    }
    setLoading(false);
  }

  async function saveBackend() {
    setSavingKey('image_storage_backend');
    const res = await api.put('/api/admin/system-config/image_storage_backend', { value: editingBackend });
    setSavingKey(null);
    if (res.code === 1) {
      toast({ title: '图片存储后端已保存' });
      load();
    } else {
      toast({ title: '保存失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function saveOss() {
    setSavingKey('oss_config');
    const res = await api.put('/api/admin/system-config/oss_config', { value: editingOss });
    setSavingKey(null);
    if (res.code === 1) {
      toast({ title: 'OSS 配置已保存' });
      load();
    } else {
      toast({ title: '保存失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function saveIntegration(key: string) {
    setSavingKey(key);
    const res = await api.put(`/api/admin/system-config/${key}`, { value: editingIntegration[key] || '' });
    setSavingKey(null);
    if (res.code === 1) {
      toast({ title: '已保存' });
      load();
    } else {
      toast({ title: '保存失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function saveRelay() {
    setSavingKey('ozon_cdn_relay_url');
    const res = await api.put('/api/admin/system-config/ozon_cdn_relay_url', { value: editingRelay });
    setSavingKey(null);
    if (res.code === 1) {
      toast({ title: '已保存' });
      load();
    } else {
      toast({ title: '保存失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function testIntegration(key: 'turnstile' | 'sms' | 'oss' | 'sentry') {
    setTestingKey(key);
    const res = await api.post<{ errorCodes?: string[] }>(`/api/admin/system-status/test/${key}`, {});
    setTestingKey(null);
    if (res.code === 1) {
      toast({ title: `${key} 测试通过`, description: res.msg });
    } else {
      toast({ title: `${key} 测试失败`, description: res.msg, variant: 'destructive' });
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Plug className="h-6 w-6" /> 接口与集成
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          第三方服务接入状态与配置。环境变量类的配置只读，需要修改请在 .env 文件 + 重启服务。
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">服务接入状态</h2>
            <Button variant="outline" size="sm" onClick={load}>刷新</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((c) => (
            <IntegrationRow
              key={c.key}
              check={c}
              testing={testingKey === c.key}
              onTest={
                c.key === 'turnstile' || c.key === 'sms' || c.key === 'oss' || c.key === 'sentry'
                  ? () => testIntegration(c.key as any)
                  : undefined
              }
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-medium">图片存储策略</h2>
          {backendConfig?.description && (
            <p className="text-xs text-muted-foreground">{backendConfig.description}</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3">
            {STORAGE_BACKEND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setEditingBackend(option.value)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  editingBackend === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="text-sm font-medium">{option.label}</div>
                <p className="mt-1 text-xs text-muted-foreground">{option.desc}</p>
              </button>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <Button
              size="sm"
              disabled={savingKey === 'image_storage_backend' || editingBackend === backendConfig?.value}
              onClick={saveBackend}
              className="gap-1.5"
            >
              {savingKey === 'image_storage_backend' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-medium">OSS 对象存储配置</h2>
          {ossConfig?.description && (
            <p className="text-xs text-muted-foreground">{ossConfig.description}</p>
          )}
        </CardHeader>
        <CardContent>
          <OssConfigEditor value={editingOss} onChange={setEditingOss} />
          <div className="flex justify-end gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={testingKey === 'oss'}
              onClick={() => testIntegration('oss')}
              className="gap-1.5"
            >
              {testingKey === 'oss' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
              测试连接
            </Button>
            <Button
              size="sm"
              disabled={savingKey === 'oss_config' || editingOss === ossConfig?.value}
              onClick={saveOss}
              className="gap-1.5"
            >
              {savingKey === 'oss_config' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            敏感字段（accessKeySecret）出于安全考虑不会回显，保存后再次读取会显示为 <code>***MASKED***</code>。要更新只需重新填写新值。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-medium">OZON CDN 中转地址</h2>
          {relayConfig?.description && (
            <p className="text-xs text-muted-foreground">{relayConfig.description}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={editingRelay}
            onChange={(e) => setEditingRelay(e.target.value)}
            placeholder="https://your-worker.workers.dev"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={savingKey === 'ozon_cdn_relay_url' || editingRelay === relayConfig?.value}
              onClick={saveRelay}
              className="gap-1.5"
            >
              {savingKey === 'ozon_cdn_relay_url' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      {integrationConfigs.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">集成行为</h2>
            <p className="text-xs text-muted-foreground">第三方集成相关的运行策略开关。</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {integrationConfigs.map((cfg) => {
              const isToggle = cfg.value === 'true' || cfg.value === 'false';
              const dirty = editingIntegration[cfg.key] !== cfg.value;
              return (
                <div key={cfg.key} className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label className="font-medium">{cfg.label || cfg.key}</Label>
                      {cfg.description && <p className="mt-1 text-xs text-muted-foreground">{cfg.description}</p>}
                    </div>
                    <Button
                      size="sm"
                      disabled={savingKey === cfg.key || !dirty}
                      onClick={() => saveIntegration(cfg.key)}
                      className="gap-1.5 shrink-0"
                    >
                      {savingKey === cfg.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      保存
                    </Button>
                  </div>
                  {isToggle ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingIntegration({
                          ...editingIntegration,
                          [cfg.key]: editingIntegration[cfg.key] === 'true' ? 'false' : 'true',
                        })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          editingIntegration[cfg.key] === 'true' ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                            editingIntegration[cfg.key] === 'true' ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <span className="text-sm">{editingIntegration[cfg.key] === 'true' ? '已启用' : '已禁用'}</span>
                    </div>
                  ) : (
                    <Input
                      value={editingIntegration[cfg.key] || ''}
                      onChange={(e) => setEditingIntegration({ ...editingIntegration, [cfg.key]: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IntegrationRow({
  check,
  testing,
  onTest,
}: {
  check: IntegrationCheck;
  testing: boolean;
  onTest?: () => void;
}) {
  const Icon = check.configured ? CheckCircle2 : XCircle;
  const color = check.configured ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground';
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-b-0">
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{check.label}</span>
          <Badge variant="outline" className="text-[10px]">
            {check.source === 'env' ? '环境变量' : check.source === 'db' ? '数据库' : '混合'}
          </Badge>
          {!check.configured && <Badge variant="secondary" className="text-[10px]">未配置</Badge>}
        </div>
        {check.detail && <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>}
      </div>
      {onTest && check.configured && (
        <Button variant="outline" size="sm" disabled={testing} onClick={onTest} className="gap-1.5 shrink-0">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
          测试
        </Button>
      )}
    </div>
  );
}

function OssConfigEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let parsed: any = {};
  try { parsed = value ? JSON.parse(value) : {}; } catch {}
  const update = (field: string, val: string) => onChange(JSON.stringify({ ...parsed, [field]: val }));
  return (
    <div className="space-y-3 p-3 rounded-md border bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">服务商预设</Label>
          <select
            className="w-full mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              const preset = OSS_PRESETS[Number(e.target.value)];
              if (preset) onChange(JSON.stringify({ ...parsed, endpoint: preset.endpoint, region: preset.region }));
            }}
          >
            <option value="">选择预设...</option>
            {OSS_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Region</Label>
          <Input className="mt-1 h-8 text-sm" value={parsed.region || ''} onChange={(e) => update('region', e.target.value)} placeholder="cn-hangzhou / auto" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Endpoint</Label>
        <Input className="mt-1 h-8 text-sm font-mono" value={parsed.endpoint || ''} onChange={(e) => update('endpoint', e.target.value)} placeholder="https://oss-cn-hangzhou.aliyuncs.com" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Bucket</Label>
          <Input className="mt-1 h-8 text-sm" value={parsed.bucket || ''} onChange={(e) => update('bucket', e.target.value)} placeholder="my-bucket" />
        </div>
        <div>
          <Label className="text-xs">CDN 域名（可选）</Label>
          <Input className="mt-1 h-8 text-sm" value={parsed.cdnDomain || ''} onChange={(e) => update('cdnDomain', e.target.value)} placeholder="https://cdn.example.com" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Access Key ID</Label>
          <Input className="mt-1 h-8 text-sm font-mono" value={parsed.accessKeyId || ''} onChange={(e) => update('accessKeyId', e.target.value)} placeholder="AKID..." />
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1">
            Access Key Secret
            <AlertCircle className="h-3 w-3 text-muted-foreground" />
          </Label>
          <Input className="mt-1 h-8 text-sm font-mono" type="password" value={parsed.accessKeySecret || ''} onChange={(e) => update('accessKeySecret', e.target.value)} placeholder="留空保持原值，填新值会覆盖" />
        </div>
      </div>
    </div>
  );
}
