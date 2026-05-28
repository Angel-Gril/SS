'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from 'shared';
import { api, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // 首次启动检测：用户表为空时跳引导页
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ needsSetup: boolean }>('/api/setup/status');
        if (res.code === 1 && res.data?.needsSetup) {
          router.replace('/setup');
        }
      } catch {
        // 后端没起来时不阻塞登录页
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

  async function onSubmit(data: LoginInput) {
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: { role: string } }>('/api/auth/login', data);
      if (res.code === 1 && res.data?.token) {
        tokenStore.set(res.data.token);
        // 根据角色跳转到不同默认页面
        const role = res.data.user?.role;
        if (role === 'STAFF') {
          router.push('/warehouse');
        } else if (role === 'USER') {
          router.push('/orders');
        } else {
          router.push('/');
        }
      } else {
        toast({ title: res.msg || '登录失败', variant: 'destructive' });
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
            <Button type="submit" className="w-full" disabled={loading}>
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
