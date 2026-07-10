'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { Eye, EyeOff } from 'lucide-react';
import { registerSchema, type RegisterInput } from 'shared';
import { api, tokenStore } from '@/lib/api';
import { formatAuthNetworkError } from '@/lib/auth-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const IS_LOCAL_RUNTIME = process.env.NEXT_PUBLIC_RUNTIME_MODE !== 'cloud';
const TURNSTILE_RESPONSE_TIMEOUT_MS = 8000;
const TURNSTILE_UNAVAILABLE_MESSAGE = '人机验证没有成功加载或未通过；请点击重新加载验证，或刷新页面后再试';

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

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [turnstileRenderKey, setTurnstileRenderKey] = useState(0);
  const [challengeConfig, setChallengeConfig] = useState<AuthChallengeConfig>(DEFAULT_CHALLENGE_CONFIG);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const needsSms = challengeConfig.runtimeMode === 'cloud' && challengeConfig.smsRegisterEnabled;
  const needsTurnstile = needsSms && challengeConfig.turnstileEnabled;

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<AuthChallengeConfig>('/api/auth/challenge-config');
        if (res.code === 1 && res.data) {
          setChallengeConfig(res.data);
        }
      } catch {
        // keep build-time fallback
      }
    })();
  }, []);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { legalAccepted: false },
  });

  function startCountdown() {
    setCountdown(challengeConfig.smsRateLimitSeconds || 60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function resetTurnstile() {
    turnstileRef.current?.reset();
    setTurnstileToken('');
    setTurnstileError('');
    setTurnstileRenderKey((value) => value + 1);
  }

  function handleTurnstileError(errorCode?: string) {
    setTurnstileToken('');
    setTurnstileError(
      errorCode
        ? `人机验证加载失败（错误代码：${errorCode}），请重试或关闭代理/浏览器插件后再试`
        : '人机验证加载失败，请重试或关闭代理/浏览器插件后再试',
    );
  }

  async function getTurnstileTokenForSubmit(): Promise<string | null> {
    const existingToken = turnstileToken || turnstileRef.current?.getResponse();
    if (existingToken) {
      return existingToken;
    }

    try {
      const token = await turnstileRef.current?.getResponsePromise(TURNSTILE_RESPONSE_TIMEOUT_MS);
      if (token) {
        setTurnstileToken(token);
        setTurnstileError('');
        return token;
      }
    } catch {
      // handled below with a user-facing message
    }

    const message = TURNSTILE_UNAVAILABLE_MESSAGE;
    setTurnstileError(message);
    toast({ title: message, variant: 'destructive' });
    return null;
  }

  async function onSendCode() {
    const phone = getValues('phone');
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      toast({ title: '请先输入有效手机号', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const captchaToken = needsTurnstile ? await getTurnstileTokenForSubmit() : '';
      if (needsTurnstile && !captchaToken) {
        return;
      }

      const res = await api.post<unknown>('/api/auth/sms-code', { phone, turnstileToken: captchaToken });
      if (res.code === 1) {
        toast({ title: '验证码已发送' });
        startCountdown();
        resetTurnstile();
      } else {
        toast({ title: res.msg || '发送失败', variant: 'destructive' });
        resetTurnstile();
      }
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
      resetTurnstile();
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(data: RegisterInput) {
    if (needsSms && !data.smsCode) {
      toast({ title: '请输入 6 位验证码', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ token?: string }>('/api/auth/register', data);
      if (res.code === 1) {
        tokenStore.clear();
        setTurnstileError('');
        toast({ title: '注册成功，欢迎使用松鼠跨境 ERP' });
        router.push('/');
      } else {
        toast({ title: res.msg || '注册失败', variant: 'destructive' });
        resetTurnstile();
      }
    } catch (error) {
      toast({ title: formatAuthNetworkError(error), variant: 'destructive' });
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fff7f0] p-4 dark:bg-gray-950">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <span className="text-2xl font-bold text-primary-foreground">SS</span>
          </div>
          <CardTitle className="text-2xl">注册账号</CardTitle>
          <CardDescription>松鼠跨境 ERP · 厦门常青藤上云</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <Input id="phone" placeholder="11 位手机号" {...register('phone')} autoComplete="tel" />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            {needsSms && (
              <div className="space-y-2">
                <Label htmlFor="smsCode">短信验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="smsCode"
                    placeholder="6 位验证码"
                    inputMode="numeric"
                    maxLength={6}
                    {...register('smsCode')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onSendCode}
                    disabled={sending || countdown > 0}
                    className="shrink-0 w-32"
                  >
                    {countdown > 0 ? `${countdown}s 后重试` : sending ? '发送中...' : '发送验证码'}
                  </Button>
                </div>
                {errors.smsCode && <p className="text-xs text-destructive">{errors.smsCode.message}</p>}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="nickname">昵称（可选）</Label>
              <Input id="nickname" placeholder="您的昵称" {...register('nickname')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="至少 8 位，包含字母和数字"
                  className="pr-10"
                  {...register('password')}
                  autoComplete="new-password"
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
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="legalAccepted" className="flex cursor-pointer items-start gap-2.5 text-sm leading-5 text-muted-foreground">
                <input
                  id="legalAccepted"
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  {...register('legalAccepted')}
                />
                <span>
                  我已阅读并同意
                  <a href="/terms" target="_blank" rel="noreferrer" className="mx-1 font-medium text-primary hover:underline">《用户协议》</a>
                  和
                  <a href="/privacy" target="_blank" rel="noreferrer" className="ml-1 font-medium text-primary hover:underline">《隐私政策》</a>
                </span>
              </label>
              {errors.legalAccepted && <p className="text-xs text-destructive">{errors.legalAccepted.message}</p>}
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
                    onError={handleTurnstileError}
                    onExpire={() => {
                      setTurnstileToken('');
                      setTurnstileError('人机验证已过期，请重新验证');
                    }}
                    onTimeout={() => {
                      setTurnstileToken('');
                      setTurnstileError('人机验证超时，请重新验证');
                    }}
                    options={{
                      size: 'normal',
                      theme: 'auto',
                      retry: 'auto',
                      refreshExpired: 'auto',
                      refreshTimeout: 'auto',
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-destructive text-center">
                  Turnstile 站点密钥未配置，无法发送验证码
                </p>
              )
            )}
            {needsTurnstile && turnstileError && (
              <div className="space-y-2 text-center">
                <p className="text-xs text-destructive">{turnstileError}</p>
                <Button type="button" variant="outline" size="sm" onClick={resetTurnstile}>
                  重新加载验证
                </Button>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '注册中...' : '注册'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              已有账号？{' '}
              <a href="/login" className="text-primary hover:underline">
                立即登录
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
