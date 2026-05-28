'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('系统管理员');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ needsSetup: boolean }>('/api/setup/status');
        if (res.code === 1 && res.data?.needsSetup === false) {
          router.replace('/login');
          return;
        }
      } catch {
        // 后端没启动起来时也允许填写
      }
      setChecking(false);
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6,20}$/.test(phone)) {
      toast({ title: '手机号格式不正确（仅数字 6-20 位）', variant: 'destructive' });
      return;
    }
    if (password.length < 8) {
      toast({ title: '密码至少 8 位', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: '两次密码不一致', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/api/setup/init', { phone, password, nickname });
      if (res.code === 1) {
        toast({ title: '初始化完成，请使用刚才的账号登录' });
        router.replace('/login');
      } else {
        toast({ title: res.msg || '初始化失败', variant: 'destructive' });
      }
    } catch {
      toast({ title: '网络错误，请检查后端是否启动', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        正在检查系统状态…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <span className="text-2xl font-bold text-primary-foreground">SS</span>
          </div>
          <CardTitle className="text-2xl">首次使用设置</CardTitle>
          <CardDescription>欢迎使用松鼠跨境 ERP，请创建您的管理员账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">登录手机号</Label>
              <Input
                id="phone"
                placeholder="纯数字，6-20 位"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nickname">昵称</Label>
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">登录密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '创建中…' : '创建并进入系统'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              这是首次启动时的一次性引导，创建完成后将无法再次访问此页面。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
