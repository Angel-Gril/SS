'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [nickname, setNickname] = useState('系统管理员');
  const [setupToken, setSetupToken] = useState('');
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ needsSetup: boolean; setupTokenRequired?: boolean }>('/api/setup/status');
        if (res.code === 1 && res.data?.needsSetup === false) {
          router.replace('/login');
          return;
        }
        setSetupTokenRequired(!!res.data?.setupTokenRequired);
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
    if (!legalAccepted) {
      toast({ title: '请阅读并同意用户协议和隐私政策', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/api/setup/init', { phone, password, nickname, setupToken, legalAccepted });
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
    <div className="flex min-h-screen items-center justify-center bg-[#fff7f0] p-4 dark:bg-gray-950">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <span className="text-2xl font-bold text-primary-foreground">SS</span>
          </div>
          <CardTitle className="text-2xl">首次使用设置</CardTitle>
          <CardDescription>松鼠跨境 ERP · 厦门常青藤上云</CardDescription>
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
            {setupTokenRequired && (
              <div className="space-y-2">
                <Label htmlFor="setupToken">初始化令牌</Label>
                <Input
                  id="setupToken"
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  autoComplete="one-time-code"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">登录密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="至少 8 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认密码</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                  title={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <label htmlFor="legalAccepted" className="flex cursor-pointer items-start gap-2.5 text-sm leading-5 text-muted-foreground">
              <input
                id="legalAccepted"
                type="checkbox"
                checked={legalAccepted}
                onChange={(event) => setLegalAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <span>
                我已阅读并同意
                <a href="/terms" target="_blank" rel="noreferrer" className="mx-1 font-medium text-primary hover:underline">《用户协议》</a>
                和
                <a href="/privacy" target="_blank" rel="noreferrer" className="ml-1 font-medium text-primary hover:underline">《隐私政策》</a>
              </span>
            </label>
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
