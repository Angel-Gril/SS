'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { formatAuthNetworkError } from '@/lib/auth-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const IS_LOCAL_RUNTIME = process.env.NEXT_PUBLIC_RUNTIME_MODE !== 'cloud';
const TURNSTILE_RESPONSE_TIMEOUT_MS = 8000;

interface AuthChallengeConfig {
  runtimeMode: 'local' | 'cloud';
  smsRegisterEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  smsRateLimitSeconds: number;
}

const DEFAULT_CHALLENGE_CONFIG: AuthChallengeConfig = {
  runtimeMode: IS_LOCAL_RUNTIME ? 'local' : 'cloud',
  smsRegisterEnabled: false,
  turnstileEnabled: false,
  turnstileSiteKey: '',
  smsRateLimitSeconds: 60,
};

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [turnstileRenderKey, setTurnstileRenderKey] = useState(0);
  const [challengeConfig, setChallengeConfig] = useState<AuthChallengeConfig>(DEFAULT_CHALLENGE_CONFIG);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const needsTurnstile = challengeConfig.runtimeMode === 'cloud' && challengeConfig.turnstileEnabled;

  useEffect(() => {
    api.get<AuthChallengeConfig>('/api/auth/challenge-config')
      .then((response) => {
        if (response.code === 1 && response.data) setChallengeConfig(response.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function resetTurnstile() {
    turnstileRef.current?.reset();
    setTurnstileToken('');
    setTurnstileError('');
    setTurnstileRenderKey((value) => value + 1);
  }

  async function getTurnstileToken(): Promise<string | null> {
    const existingToken = turnstileToken || turnstileRef.current?.getResponse();
    if (existingToken) return existingToken;
    try {
      const token = await turnstileRef.current?.getResponsePromise(TURNSTILE_RESPONSE_TIMEOUT_MS);
      if (token) return token;
    } catch {
      // The user-facing error below covers timeout and failed widget responses.
    }
    const message = '人机验证没有成功加载或未通过，请重新验证后再试';
    setTurnstileError(message);
    toast({ title: message, variant: 'destructive' });
    return null;
  }

  async function onSendCode() {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast({ title: '请输入有效的手机号', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const captchaToken = needsTurnstile ? await getTurnstileToken() : '';
      if (needsTurnstile && !captchaToken) return;
      const response = await api.post('/api/auth/password-reset/sms-code', {
        phone,
        turnstileToken: captchaToken || undefined,
      });
      if (response.code === 1) {
        toast({ title: response.msg || '验证码已发送' });
        setCountdown(challengeConfig.smsRateLimitSeconds || 60);
      } else {
        toast({ title: response.msg || '验证码发送失败', variant: 'destructive' });
      }
      if (needsTurnstile) resetTurnstile();
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
      if (needsTurnstile) resetTurnstile();
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast({ title: '请输入有效的手机号', variant: 'destructive' });
      return;
    }
    if (!/^\d{6}$/.test(smsCode)) {
      toast({ title: '请输入 6 位验证码', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast({ title: '新密码至少 8 位，并包含字母和数字', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: '两次输入的密码不一致', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post('/api/auth/password-reset', { phone, smsCode, newPassword });
      if (response.code === 1) {
        toast({ title: '密码已重置，请使用新密码登录' });
        router.replace('/login');
      } else {
        toast({ title: response.msg || '密码重置失败', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fff7f0] p-4 dark:bg-gray-950">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <span className="text-2xl font-bold text-primary-foreground">SS</span>
          </div>
          <CardTitle className="text-2xl">找回密码</CardTitle>
          <CardDescription>厦门常青藤上云 · 验证手机号后设置新密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="请输入注册手机号" />
            </div>

            {needsTurnstile && (
              challengeConfig.turnstileSiteKey ? (
                <div className="flex justify-center">
                  <Turnstile
                    key={turnstileRenderKey}
                    ref={turnstileRef}
                    siteKey={challengeConfig.turnstileSiteKey}
                    onSuccess={(token) => {
                      setTurnstileToken(token);
                      setTurnstileError('');
                    }}
                    onError={() => {
                      setTurnstileToken('');
                      setTurnstileError('人机验证加载失败，请重新加载');
                    }}
                    onExpire={() => {
                      setTurnstileToken('');
                      setTurnstileError('人机验证已过期，请重新验证');
                    }}
                    options={{ theme: 'auto', retry: 'auto', refreshExpired: 'auto' }}
                  />
                </div>
              ) : (
                <p className="text-center text-xs text-destructive">Turnstile 站点密钥未配置，暂时无法发送验证码</p>
              )
            )}
            {turnstileError && <p className="text-center text-xs text-destructive">{turnstileError}</p>}

            <div className="space-y-2">
              <Label htmlFor="smsCode">短信验证码</Label>
              <div className="flex gap-2">
                <Input id="smsCode" value={smsCode} onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" />
                <Button type="button" variant="outline" className="w-32 shrink-0" onClick={onSendCode} disabled={sending || countdown > 0 || (needsTurnstile && !challengeConfig.turnstileSiteKey)}>
                  {countdown > 0 ? countdown + 's 后重试' : sending ? '发送中...' : '发送验证码'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <div className="relative">
                <Input id="newPassword" type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="至少 8 位，包含字母和数字" className="pr-10" />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={showPassword ? '隐藏新密码' : '显示新密码'} title={showPassword ? '隐藏新密码' : '显示新密码'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <div className="relative">
                <Input id="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" className="pr-10" />
                <button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'} title={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}>
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '重置中...' : '重置密码'}
            </Button>
            <a href="/login" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
              <ArrowLeft className="h-4 w-4" />
              返回登录
            </a>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
