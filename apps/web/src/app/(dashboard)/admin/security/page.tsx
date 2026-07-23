'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface SystemConfig {
  id: string;
  key: string;
  value: string;
  label: string | null;
  group: string;
  description: string | null;
  revision: number;
}

function getResponseErrorCode(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const errorCode = (response as { errorCode?: unknown }).errorCode;
  return typeof errorCode === 'string' ? errorCode : null;
}

export default function AdminSecurityPage() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await api.get<SystemConfig[]>('/api/admin/system-config?group=security');
    if (res.code === 1 && res.data) {
      setConfigs(res.data);
      const map: Record<string, string> = {};
      res.data.forEach((c) => { map[c.key] = c.value; });
      setEditing(map);
    }
    setLoading(false);
  }

  async function save(key: string) {
    setSavingKey(key);
    const expectedRevision = configs.find((config) => config.key === key)?.revision ?? 0;
    const res = await api.put(`/api/admin/system-config/${key}`, {
      value: editing[key] || '',
      expectedRevision,
    });
    setSavingKey(null);
    if (res.code === 1) {
      toast({ title: '已保存' });
      await load();
    } else if (getResponseErrorCode(res) === 'system_config_revision_conflict') {
      toast({
        title: '配置已被更新',
        description: '已读取服务器最新值，请重新确认后保存',
        variant: 'destructive',
      });
      await load();
    } else {
      toast({ title: '保存失败', description: res.msg, variant: 'destructive' });
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Shield className="h-6 w-6" /> 安全设置
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          登录策略、会话有效期、IP 白名单、审计日志开关。部分配置需要重启服务后生效。
        </p>
      </div>

      <Card>
        <CardContent className="space-y-5 pt-6">
          {configs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无安全配置项，访问 /admin/settings 点击"初始化默认配置"
            </p>
          ) : (
            configs.map((cfg) => {
              const isToggle = cfg.value === 'true' || cfg.value === 'false';
              const dirty = editing[cfg.key] !== cfg.value;
              return (
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
                      onClick={() => save(cfg.key)}
                      disabled={savingKey === cfg.key || !dirty}
                    >
                      {savingKey === cfg.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      <span className="ml-1">保存</span>
                    </Button>
                  </div>

                  {isToggle ? (
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
                  ) : (
                    <Input
                      value={editing[cfg.key] || ''}
                      onChange={(e) => setEditing({ ...editing, [cfg.key]: e.target.value })}
                      placeholder={cfg.description || ''}
                    />
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
