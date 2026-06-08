import { z } from 'zod';

export const phoneRegex = /^1[3-9]\d{9}$/;

export const registerSchema = z.object({
  phone: z.string().regex(phoneRegex, '请输入有效的手机号'),
  password: z
    .string()
    .min(8, '密码至少 8 位')
    .max(64, '密码最多 64 位')
    .regex(/[a-zA-Z]/, '密码需包含字母')
    .regex(/[0-9]/, '密码需包含数字'),
  smsCode: z.string().regex(/^\d{6}$/, '请输入 6 位验证码').optional(),
  nickname: z.string().min(2).max(32).optional(),
  inviteCode: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export const loginSchema = z.object({
  phone: z.string().regex(phoneRegex, '请输入有效的手机号'),
  password: z.string().min(1, '请输入密码'),
  turnstileToken: z.string().optional(),
});

export const sendSmsCodeSchema = z.object({
  phone: z.string().regex(phoneRegex, '请输入有效的手机号'),
  turnstileToken: z.string().optional(),
});

export const resetPasswordSmsCodeSchema = z.object({
  phone: z.string().regex(phoneRegex, '请输入有效的手机号'),
  turnstileToken: z.string().optional(),
});

export const resetPasswordSchema = z.object({
  phone: z.string().regex(phoneRegex, '请输入有效的手机号'),
  smsCode: z.string({ required_error: '请输入 6 位验证码' }).regex(/^\d{6}$/, '请输入 6 位验证码'),
  newPassword: z
    .string()
    .min(8, '密码至少 8 位')
    .max(64, '密码最多 64 位')
    .regex(/[a-zA-Z]/, '密码需包含字母')
    .regex(/[0-9]/, '密码需包含数字'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .max(64)
    .regex(/[a-zA-Z]/)
    .regex(/[0-9]/),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordSmsCodeInput = z.infer<typeof resetPasswordSmsCodeSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface AuthUser {
  id: string;
  phone: string;
  nickname: string | null;
  avatar: string | null;
  role: 'ADMIN' | 'USER' | 'STAFF';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  isSuperAdmin?: boolean;
  balance: string;
  accountCode?: string | null;
  isSubAccount?: boolean;
  parentAccountCode?: string | null;
  parentNickname?: string | null;
}

export interface LoginResponse {
  user: AuthUser;
  token: string;
  expiresAt: string;
}
