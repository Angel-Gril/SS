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
  upload: '上传安全',
  retention: '数据保留',
  backup: '备份策略',
  maintenance: '维护模式',
  version: '版本更新',
  randomize: '随机化（货号/尺寸/重量）',
  general: '通用',
};

const GROUP_ORDER = ['maintenance', 'feature', 'upload', 'retention', 'backup', 'version', 'randomize', 'general'];

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
            功能开关、随机化参数等通用配置。接口集成/安全/运维状态已拆分到独立页面。
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
            </Card>
          </div>
        );
      })}
    </div>
  );
}
