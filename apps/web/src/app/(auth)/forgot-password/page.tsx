'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { resetPasswordSchema, type ResetPasswordInput } from 'shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  (process.env.NODE_ENV === 'production' ? '' : '1x00000000000000000000AA');
const IS_LOCAL_RUNTIME = process.env.NEXT_PUBLIC_RUNTIME_MODE !== 'cloud';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  });

  function startCountdown() {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }

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

  async function onSendCode() {
    const phone = getValues('phone');
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      toast({ title: '请先输入有效手机号', variant: 'destructive' });
      return;
    }
    if (!IS_LOCAL_RUNTIME && !turnstileToken) {
      toast({ title: '请先完成人机验证', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const res = await api.post<unknown>('/api/auth/reset-password/sms-code', {
        phone,
        turnstileToken: turnstileToken || undefined,
      });
      if (res.code === 1) {
        toast({ title: res.msg || '验证码已发送' });
        startCountdown();
        resetTurnstile();
      } else {
        toast({ title: res.msg || '发送失败', variant: 'destructive' });
        resetTurnstile();
      }
    } catch {
      toast({ title: '网络错误', variant: 'destructive' });
      resetTurnstile();
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(data: ResetPasswordInput) {
    setLoading(true);
    try {
      const res = await api.post<unknown>('/api/auth/reset-password', data);
      if (res.code === 1) {
        toast({ title: '密码已重置，请重新登录' });
        router.push('/login');
      } else {
        toast({ title: res.msg || '重置失败', variant: 'destructive' });
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
          <CardTitle className="text-2xl">找回密码</CardTitle>
          <CardDescription>通过短信验证码重置账号密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <Input id="phone" placeholder="11 位手机号" {...register('phone')} autoComplete="tel" />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
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
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="至少 8 位，包含字母和数字"
                {...register('newPassword')}
                autoComplete="new-password"
              />
              {errors.newPassword && (
                <p className="text-xs text-destructive">{errors.newPassword.message}</p>
              )}
            </div>
            {!IS_LOCAL_RUNTIME && (
              TURNSTILE_SITE_KEY ? (
                <div className="flex justify-center">
                  <Turnstile
                    ref={turnstileRef}
                    siteKey={TURNSTILE_SITE_KEY}
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
                  Turnstile 站点密钥未配置，无法发送验证码
                </p>
              )
            )}
            {!IS_LOCAL_RUNTIME && turnstileError && (
              <div className="space-y-2 text-center">
                <p className="text-xs text-destructive">{turnstileError}</p>
                <Button type="button" variant="outline" size="sm" onClick={resetTurnstile}>
                  重新加载验证
                </Button>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '重置中...' : '重置密码'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              想起密码了？{' '}
              <a href="/login" className="text-primary hover:underline">
                返回登录
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
