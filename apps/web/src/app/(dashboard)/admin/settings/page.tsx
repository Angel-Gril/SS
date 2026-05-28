'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Settings as SettingsIcon, AlertCircle } from 'lucide-react';
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

const GROUP_LABELS: Record<string, string> = {
  storage: '图片存储',
  feature: '功能开关',
  randomize: '随机化（货号/尺寸/重量）',
  general: '通用',
};

const STORAGE_BACKEND_OPTIONS = [
  { value: 'local', label: '本地存储', desc: '存到服务器 public/uploads，需公网可达地址' },
  { value: 'ozon-cdn', label: 'OZON 临时CDN', desc: '走 upload.seller.ozon.ru，复用登录态，零成本' },
  { value: 'oss', label: 'OSS 对象存储', desc: 'S3 兼容存储（阿里云/腾讯云/CF R2/AWS/MinIO）' },
];

const OSS_PRESETS: Array<{ label: string; endpoint: string; region: string }> = [
  { label: '阿里云 OSS（杭州）', endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', region: 'cn-hangzhou' },
  { label: '阿里云 OSS（上海）', endpoint: 'https://oss-cn-shanghai.aliyuncs.com', region: 'cn-shanghai' },
  { label: '腾讯云 COS（广州）', endpoint: 'https://cos.ap-guangzhou.myqcloud.com', region: 'ap-guangzhou' },
  { label: 'Cloudflare R2', endpoint: 'https://<account-id>.r2.cloudflarestorage.com', region: 'auto' },
  { label: 'AWS S3（us-east-1）', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1' },
  { label: '自定义 / MinIO', endpoint: '', region: '' },
];

function OssConfigEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let parsed: any = {};
  try { parsed = value ? JSON.parse(value) : {}; } catch {}

  const update = (field: string, val: string) => {
    const next = { ...parsed, [field]: val };
    onChange(JSON.stringify(next));
  };

  return (
    <div className="space-y-3 p-3 rounded-md border bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">服务商预设</Label>
          <select
            className="w-full mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const preset = OSS_PRESETS[Number(e.target.value)];
              if (preset) {
                const next = { ...parsed, endpoint: preset.endpoint, region: preset.region };
                onChange(JSON.stringify(next));
              }
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
          <Label className="text-xs">Access Key Secret</Label>
          <Input className="mt-1 h-8 text-sm font-mono" type="password" value={parsed.accessKeySecret || ''} onChange={(e) => update('accessKeySecret', e.target.value)} placeholder="••••••" />
        </div>
      </div>
      <div>
        <Label className="text-xs">路径前缀（可选）</Label>
        <Input className="mt-1 h-8 text-sm" value={parsed.pathPrefix || ''} onChange={(e) => update('pathPrefix', e.target.value)} placeholder="ss-erp/images" />
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => { fetchConfigs(); }, []);

  async function fetchConfigs() {
    setLoading(true);
    const res = await api.get<SystemConfig[]>('/api/admin/system-config');
    if (res.code === 1 && res.data) {
      setConfigs(res.data);
      const map: Record<string, string> = {};
      res.data.forEach((c) => { map[c.key] = c.value; });
      setEditing(map);
    } else if (res.code === 0) {
      // 尝试初始化默认配置
      await api.post('/api/admin/system-config/seed', {});
      const res2 = await api.get<SystemConfig[]>('/api/admin/system-config');
      if (res2.code === 1 && res2.data) {
        setConfigs(res2.data);
        const map: Record<string, string> = {};
        res2.data.forEach((c) => { map[c.key] = c.value; });
        setEditing(map);
      }
    }
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
          <p className="text-sm text-muted-foreground mt-1">超管维护的全局功能配置</p>
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

      {Object.entries(grouped).map(([group, items]) => (
        <Card key={group}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{GROUP_LABELS[group] || group}</Badge>
              <span className="text-sm text-muted-foreground">{items.length} 项</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
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

                {cfg.key === 'image_storage_backend' ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {STORAGE_BACKEND_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setEditing({ ...editing, [cfg.key]: opt.value })}
                        className={`text-left p-3 rounded-md border-2 transition-colors ${
                          editing[cfg.key] === opt.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                ) : cfg.key === 'feature_customer_chat' || cfg.key === 'feature_image_translate' || cfg.key === 'randomize_enabled' || cfg.key === 'randomize_offer_id' ? (
                  <div className="flex items-center gap-2">
                    <button
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
                ) : cfg.key === 'oss_config' ? (
                  <OssConfigEditor value={editing[cfg.key] || ''} onChange={(v) => setEditing({ ...editing, [cfg.key]: v })} />
                ) : cfg.key === 'ozon_cdn_relay_url' ? (
                  <div className="space-y-2">
                    <Input
                      value={editing[cfg.key] || ''}
                      onChange={(e) => setEditing({ ...editing, [cfg.key]: e.target.value })}
                      placeholder="https://your-worker.workers.dev"
                    />
                    <p className="text-xs text-muted-foreground">
                      部署 CF Worker 后填入地址。Worker 会将请求转发到 upload.seller.ozon.ru，解决国内网络问题。留空则直连（需代理/虚拟网卡）
                    </p>
                  </div>
                ) : cfg.key === 'ozon_cdn_cookie' ? (
                  <textarea
                    value={editing[cfg.key] || ''}
                    onChange={(e) => setEditing({ ...editing, [cfg.key]: e.target.value })}
                    rows={3}
                    placeholder="从 seller.ozon.ru 浏览器复制完整 cookie 字符串"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
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
        </Card>
      ))}
    </div>
  );
}
