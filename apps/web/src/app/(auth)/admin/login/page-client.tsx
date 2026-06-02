'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const adminLoginSchema = z.object({
  phone: z.string().min(11, '手机号格式不正确').max(11),
  password: z.string().min(6, '密码至少 6 位'),
});

type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminLoginInput>({
    resolver: zodResolver(adminLoginSchema),
  });

  async function onSubmit(data: AdminLoginInput) {
    setLoading(true);
    try {
      const res = await api.post<{ token?: string; user: { role: string } }>(
        '/api/admin/auth/login',
        data,
      );
      if (res.code === 1) {
        tokenStore.clear();
        router.push('/admin/users');
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 p-4">
      <Card className="w-full max-w-md shadow-xl border-slate-700">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mb-2">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <CardTitle className="text-2xl">管理员登录</CardTitle>
          <CardDescription>仅限授权管理员访问</CardDescription>
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
            <p className="text-center text-xs text-muted-foreground">
              用户登录请访问{' '}
              <a href="/login" className="text-primary hover:underline">
                普通登录页
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
