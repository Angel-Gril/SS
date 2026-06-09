'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { z } from 'zod';
import { registerSchema, type RegisterInput } from 'shared';
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

const registerFormSchema = registerSchema.superRefine((data, ctx) => {
  if (!IS_LOCAL_RUNTIME && !data.smsCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['smsCode'],
      message: '请输入 6 位验证码',
    });
  }
});

export default function RegisterPage() {
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
    setValue,
    watch,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      termsAccepted: false,
      privacyAccepted: false,
    },
  });
  const termsAccepted = watch('termsAccepted');
  const privacyAccepted = watch('privacyAccepted');

  function startCountdown() {
    setCountdown(60);
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
      const res = await api.post<unknown>('/api/auth/sms-code', { phone, turnstileToken });
      if (res.code === 1) {
        toast({ title: '验证码已发送' });
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

  async function onSubmit(data: RegisterInput) {
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
          <CardTitle className="text-2xl">注册账号</CardTitle>
          <CardDescription>开启您的跨境电商之旅</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">手机号</Label>
              <Input id="phone" placeholder="11 位手机号" {...register('phone')} autoComplete="tel" />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            {!IS_LOCAL_RUNTIME && (
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
              <Input
                id="password"
                type="password"
                placeholder="至少 8 位，包含字母和数字"
                {...register('password')}
                autoComplete="new-password"
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-start gap-2 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
                  checked={!!termsAccepted}
                  onChange={(event) => setValue('termsAccepted', event.target.checked, { shouldValidate: true })}
                />
                <span>
                  我已阅读并同意{' '}
                  <a href="/terms" target="_blank" className="text-primary hover:underline">
                    用户服务协议
                  </a>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
                  checked={!!privacyAccepted}
                  onChange={(event) => setValue('privacyAccepted', event.target.checked, { shouldValidate: true })}
                />
                <span>
                  我已阅读并同意{' '}
                  <a href="/privacy" target="_blank" className="text-primary hover:underline">
                    隐私政策
                  </a>
                </span>
              </label>
              {(errors.termsAccepted || errors.privacyAccepted) && (
                <p className="text-xs text-destructive">
                  {errors.termsAccepted?.message || errors.privacyAccepted?.message}
                </p>
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
