'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { changePasswordSchema, updateProfileSchema, type AuthUser, type ChangePasswordInput } from 'shared';
import { api, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

export default function AccountSecurityPage() {
  const router = useRouter();
  const [profile, setProfile] = useState({
    email: '',
    nickname: '',
  });
  const [savedEmail, setSavedEmail] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [form, setForm] = useState<ChangePasswordInput>({
    oldPassword: '',
    newPassword: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    setProfileLoading(true);
    const res = await api.get<AuthUser>('/api/user/me');
    setProfileLoading(false);
    if (res.code === 1 && res.data) {
      setProfile({
        email: res.data.email || '',
        nickname: res.data.nickname || '',
      });
      setSavedEmail(res.data.email || '');
    }
  }

  async function handleProfileSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = updateProfileSchema.safeParse(profile);
    if (!parsed.success) {
      toast({ title: parsed.error.issues[0]?.message || '请检查资料格式', variant: 'destructive' });
      return;
    }

    setProfileSubmitting(true);
    const res = await api.patch<AuthUser>('/api/user/profile', parsed.data);
    setProfileSubmitting(false);
    if (res.code === 1 && res.data) {
      setProfile({
        email: res.data.email || '',
        nickname: res.data.nickname || '',
      });
      setSavedEmail(res.data.email || '');
      toast({ title: '账号资料已保存' });
      return;
    }
    toast({ title: res.msg || '保存失败', variant: 'destructive' });
  }

  async function handleSendTestEmail() {
    const currentEmail = profile.email.trim();
    if (!currentEmail) {
      toast({ title: '请先填写通知邮箱并保存', variant: 'destructive' });
      return;
    }
    if (currentEmail !== savedEmail) {
      toast({ title: '请先保存通知邮箱后再发送测试邮件', variant: 'destructive' });
      return;
    }

    setTestEmailSending(true);
    const res = await api.post('/api/user/test-email');
    setTestEmailSending(false);
    if (res.code === 1) {
      toast({ title: '测试邮件已发送，请检查收件箱' });
      return;
    }
    toast({ title: res.msg || '测试邮件发送失败', variant: 'destructive' });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) {
      toast({ title: parsed.error.issues[0]?.message || '请检查密码格式', variant: 'destructive' });
      return;
    }
    if (form.newPassword !== confirmPassword) {
      toast({ title: '两次输入的新密码不一致', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    const res = await api.post('/api/user/change-password', parsed.data);
    setSubmitting(false);
    if (res.code === 1) {
      tokenStore.clear();
      toast({ title: '密码已修改，请重新登录' });
      router.replace('/login');
      return;
    }
    toast({ title: res.msg || '修改失败', variant: 'destructive' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">账号安全</h1>
        <p className="text-muted-foreground text-sm mt-1">维护账号资料和登录密码；修改密码后当前账号的所有会话都会失效</p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-5 w-5 text-primary" />
            账号资料
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profileLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取账号资料
            </div>
          ) : (
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nickname">昵称</Label>
                <Input
                  id="nickname"
                  value={profile.nickname || ''}
                  onChange={(event) => setProfile((current) => ({ ...current, nickname: event.target.value }))}
                  placeholder="用于后台显示"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">通知邮箱</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    value={profile.email || ''}
                    onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))}
                    placeholder="seller@example.com"
                    autoComplete="email"
                  />
                </div>
                <p className="text-xs text-muted-foreground">用于后续密码重置、余额不足和订单异常邮件通知。</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" disabled={profileSubmitting}>
                  {profileSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  保存资料
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testEmailSending || profileSubmitting}
                  onClick={handleSendTestEmail}
                >
                  {testEmailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  发送测试邮件
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            修改密码
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oldPassword">原密码</Label>
              <Input
                id="oldPassword"
                type="password"
                autoComplete="current-password"
                value={form.oldPassword}
                onChange={(event) => setForm((current) => ({ ...current, oldPassword: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="至少 8 位，包含字母和数字"
                value={form.newPassword}
                onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={submitting || !form.oldPassword || !form.newPassword || !confirmPassword}
            >
              {submitting ? '提交中...' : '保存新密码'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
