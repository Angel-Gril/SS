'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { loginSchema, type LoginInput } from 'shared';
import { api, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  (process.env.NODE_ENV === 'production' ? '' : '1x00000000000000000000AA');
const IS_LOCAL_RUNTIME = process.env.NEXT_PUBLIC_RUNTIME_MODE !== 'cloud';

interface AuthChallengeConfig {
  runtimeMode: 'local' | 'cloud';
  smsRegisterEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  smsRateLimitSeconds: number;
}

const DEFAULT_CHALLENGE_CONFIG: AuthChallengeConfig = {
  runtimeMode: IS_LOCAL_RUNTIME ? 'local' : 'cloud',
  smsRegisterEnabled: !IS_LOCAL_RUNTIME,
  turnstileEnabled: !IS_LOCAL_RUNTIME,
  turnstileSiteKey: TURNSTILE_SITE_KEY,
  smsRateLimitSeconds: 60,
};

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [challengeConfig, setChallengeConfig] = useState<AuthChallengeConfig>(DEFAULT_CHALLENGE_CONFIG);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const needsTurnstile = challengeConfig.runtimeMode === 'cloud' && challengeConfig.turnstileEnabled;

  useEffect(() => {
    (async () => {
      try {
        const challengeRes = await api.get<AuthChallengeConfig>('/api/auth/challenge-config');
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
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  function resetTurnstile() {
    turnstileRef.current?.reset();
    setTurnstileToken('');
  }

  function handleTurnstileError(errorCode?: string) {
    setTurnstileToken('');
    setTurnstileError(
      errorCode
        ? `人机验证加载失败（错误代码：${errorCode}），请重试或关闭代理/浏览器插件后再试`
        : '人机验证加载失败，请重试或关闭代理/浏览器插件后再试',
    );
  }

  async function onSubmit(data: LoginInput) {
    setLoading(true);
    try {
      const res = await api.post<{ token?: string; user: { role: string } }>('/api/auth/login', {
        ...data,
        turnstileToken: turnstileToken || undefined,
      });
      if (res.code === 1) {
        tokenStore.clear();
        setTurnstileError('');
        const role = res.data?.user?.role;
        if (role === 'STAFF') {
          router.push('/warehouse');
        } else if (role === 'USER') {
          router.push('/orders');
        } else {
          router.push('/');
        }
      } else {
        toast({ title: res.msg || '登录失败', variant: 'destructive' });
        resetTurnstile();
      }
    } catch {
      toast({ title: '网络错误', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <span className="text-2xl font-bold text-primary-foreground">SS</span>
          </div>
          <CardTitle className="text-2xl">松鼠跨境 ERP</CardTitle>
          <CardDescription>登录您的账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                {...register('password')}
                autoComplete="current-password"
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            {needsTurnstile && (
              challengeConfig.turnstileSiteKey ? (
                <div className="flex justify-center">
                  <Turnstile
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
                    options={{ size: 'flexible', theme: 'auto', retry: 'auto', refreshExpired: 'auto', refreshTimeout: 'auto' }}
                  />
                </div>
              ) : (
                <p className="text-xs text-destructive text-center">
                  Turnstile 站点密钥未配置，无法完成人机验证
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
            <Button
              type="submit"
              className="w-full"
              disabled={loading || (needsTurnstile && !turnstileToken)}
            >
              {loading ? '登录中...' : '登录'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              还没有账号？{' '}
              <a href="/register" className="text-primary hover:underline">
                立即注册
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
