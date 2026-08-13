'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, KeyRound, MessageSquareText } from 'lucide-react';
import { loginSchema, type LoginInput } from 'shared';
import { api, tokenStore } from '@/lib/api';
import { formatAuthNetworkError } from '@/lib/auth-ui';
import { normalizeLoginReturnTo } from '@/lib/auth-return-to';
import { deploymentHosts, resolveCrossDeploymentHref } from '@/lib/deployment-hosts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import {
  HumanChallenge,
  resolveHumanChallengeProvider,
  type HumanChallengeConfig,
  type HumanChallengeHandle,
} from '@/components/auth/human-challenge';

const IS_LOCAL_RUNTIME = process.env.NEXT_PUBLIC_RUNTIME_MODE !== 'cloud';
const DEFAULT_CHALLENGE_CONFIG: HumanChallengeConfig = {
  runtimeMode: IS_LOCAL_RUNTIME ? 'local' : 'cloud',
  smsRegisterEnabled: !IS_LOCAL_RUNTIME,
  smsLoginEnabled: false,
  turnstileEnabled: false,
  turnstileSiteKey: '',
  smsRateLimitSeconds: 60,
};

function resolveAdminLoginHref(hostname: string): string {
  return resolveCrossDeploymentHref(
    hostname,
    deploymentHosts.userHostname,
    deploymentHosts.adminHostname,
    '/admin/login',
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = normalizeLoginReturnTo(searchParams.get('returnTo'));
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginMode, setLoginMode] = useState<'password' | 'sms'>('password');
  const [smsCode, setSmsCode] = useState('');
  const [sendingSms, setSendingSms] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [challengeConfig, setChallengeConfig] = useState<HumanChallengeConfig>(DEFAULT_CHALLENGE_CONFIG);
  const [challengeReady, setChallengeReady] = useState(true);
  const [adminLoginHref, setAdminLoginHref] = useState('/admin/login');
  const challengeRef = useRef<HumanChallengeHandle | null>(null);
  const smsLoginEnabled = challengeConfig.runtimeMode === 'cloud' && challengeConfig.smsLoginEnabled === true;
  const challengeAction = loginMode === 'sms' ? 'sms_login' : 'login';
  const challengeProvider = resolveHumanChallengeProvider(challengeConfig);

  useEffect(() => {
    if (smsCountdown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setSmsCountdown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAdminLoginHref(resolveAdminLoginHref(window.location.hostname));
    }

    (async () => {
      try {
        const challengeRes = await api.get<HumanChallengeConfig>('/api/auth/challenge-config');
        if (challengeRes.code === 1 && challengeRes.data) {
          setChallengeConfig(challengeRes.data);
        }
      } catch {
        // keep build-time fallback
      }

      try {
        const res = await api.get<{ needsSetup: boolean }>('/api/setup/status');
        if (res.code === 1 && res.data?.needsSetup) {
          router.replace('/setup');
        }
      } catch {
        // ignore
      }
    })();
  }, [router]);

  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rememberMe: false },
  });

  function finishLogin(role: string | undefined) {
    tokenStore.clear();
    if (role === 'STAFF') router.push('/warehouse');
    else router.push(returnTo || '/orders');
  }

  function resetChallenge() {
    challengeRef.current?.reset();
  }

  function switchLoginMode(nextMode: 'password' | 'sms') {
    if (nextMode === 'sms' && !smsLoginEnabled) return;
    setLoginMode(nextMode);
    setSmsCode('');
    resetChallenge();
  }

  async function onSendSmsCode() {
    const validPhone = await trigger('phone');
    if (!validPhone) return;
    const phone = getValues('phone');
    setSendingSms(true);
    try {
      const humanChallengeToken = await challengeRef.current?.getToken();
      if (challengeProvider !== 'disabled' && !humanChallengeToken) {
        toast({ title: '请先完成人机验证', variant: 'destructive' });
        return;
      }
      const res = await api.post('/api/auth/sms-login-code', {
        phone,
        humanChallengeToken: humanChallengeToken || undefined,
      });
      if (res.code === 1) {
        toast({ title: res.msg || '如果账号存在，验证码将发送至该手机号' });
        setSmsCountdown(challengeConfig.smsRateLimitSeconds || 60);
      } else {
        toast({ title: res.msg || '验证码发送失败', variant: 'destructive' });
      }
      resetChallenge();
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
      resetChallenge();
    } finally {
      setSendingSms(false);
    }
  }

  async function onSubmitPassword(data: LoginInput) {
    setLoading(true);
    try {
      const humanChallengeToken = await challengeRef.current?.getToken();
      if (challengeProvider !== 'disabled' && !humanChallengeToken) {
        toast({ title: '请先完成人机验证', variant: 'destructive' });
        return;
      }

      const res = await api.post<{ token?: string; user: { role: string } }>('/api/auth/login', {
        ...data,
        humanChallengeToken: humanChallengeToken || undefined,
      });
      if (res.code === 1) {
        finishLogin(res.data?.user?.role);
      } else {
        toast({ title: res.msg || '登录失败', variant: 'destructive' });
        challengeRef.current?.reset();
      }
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
      challengeRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validPhone = await trigger('phone');
    if (!validPhone) return;
    if (!/^\d{6}$/.test(smsCode)) {
      toast({ title: '请输入 6 位验证码', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const humanChallengeToken = await challengeRef.current?.getToken();
      if (challengeProvider !== 'disabled' && !humanChallengeToken) {
        toast({ title: '请先完成人机验证', variant: 'destructive' });
        return;
      }
      const res = await api.post<{ user: { role: string } }>('/api/auth/sms-login', {
        phone: getValues('phone'),
        smsCode,
        rememberMe: getValues('rememberMe') || false,
        humanChallengeToken: humanChallengeToken || undefined,
      });
      if (res.code === 1) {
        finishLogin(res.data?.user?.role);
      } else {
        toast({ title: res.msg || '手机号或验证码错误', variant: 'destructive' });
        resetChallenge();
      }
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
      resetChallenge();
    } finally {
      setLoading(false);
    }
  }

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    if (loginMode === 'sms') {
      void onSubmitSms(event);
      return;
    }
    void handleSubmit(onSubmitPassword)(event);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fff7f0] p-4 dark:bg-gray-950">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <span className="text-2xl font-bold text-primary-foreground">SS</span>
          </div>
          <CardTitle className="text-2xl">松鼠跨境 ERP</CardTitle>
          <CardDescription>厦门常青藤上云 · 登录您的账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onFormSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <Input
                id="phone"
                placeholder="请输入手机号"
                {...register('phone')}
                autoComplete="tel"
              />
              {errors.phone && (
                <p className="text-xs text-destructive">{errors.phone.message}</p>
              )}
            </div>
            {smsLoginEnabled && (
              <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-1" role="tablist" aria-label="登录方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={loginMode === 'password'}
                  onClick={() => switchLoginMode('password')}
                  className={`flex min-h-9 items-center justify-center gap-2 rounded px-3 text-sm transition-colors ${loginMode === 'password' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <KeyRound className="h-4 w-4" />密码登录
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={loginMode === 'sms'}
                  onClick={() => switchLoginMode('sms')}
                  className={`flex min-h-9 items-center justify-center gap-2 rounded px-3 text-sm transition-colors ${loginMode === 'sms' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <MessageSquareText className="h-4 w-4" />验证码登录
                </button>
              </div>
            )}
            {loginMode === 'password' ? (
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="请输入密码"
                    className="pr-10"
                    {...register('password')}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="smsCode">短信验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="smsCode"
                    value={smsCode}
                    onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onSendSmsCode}
                    disabled={sendingSms || smsCountdown > 0 || loading}
                    className="w-32 shrink-0"
                  >
                    {smsCountdown > 0 ? `${smsCountdown}s 后重试` : sendingSms ? '发送中...' : '发送验证码'}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 text-sm">
              <label htmlFor="rememberMe" className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                <input
                  id="rememberMe"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  {...register('rememberMe')}
                />
                <span>保持登录 7 天</span>
              </label>
              <a href="/forgot-password" className="font-medium text-primary hover:underline">忘记密码？</a>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">仅延长此设备的登录状态，不保存您的密码。</p>
            <HumanChallenge
              ref={challengeRef}
              action={challengeAction}
              provider={challengeProvider}
              turnstileSiteKey={challengeConfig.turnstileSiteKey}
              onStatusChange={setChallengeReady}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={loading || (challengeProvider !== 'disabled' && !challengeReady)}
            >
              {loading ? '登录中...' : loginMode === 'sms' ? '验证码登录' : '登录'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              还没有账号？{' '}
              <a href="/register" className="text-primary hover:underline">
                立即注册
              </a>
            </p>
            <p className="text-center text-xs text-muted-foreground">
              管理员账号？{' '}
              <a href={adminLoginHref} className="text-primary hover:underline">
                切换管理员登录
              </a>
            </p>
            <p className="text-center text-xs text-muted-foreground">
              登录即代表您遵守
              <a href="/terms" className="mx-1 hover:text-primary hover:underline">《用户协议》</a>
              和
              <a href="/privacy" className="ml-1 hover:text-primary hover:underline">《隐私政策》</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
