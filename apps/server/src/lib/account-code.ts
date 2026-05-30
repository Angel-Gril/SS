import { prisma } from './prisma.js';

// 账号 code 区段
//   1-10    超级管理员
//   11-100  普通管理员
//   101+    普通用户（按注册顺序递增）
export const SUPER_ADMIN_RANGE_START = 1;
export const SUPER_ADMIN_RANGE_END = 10;
export const ADMIN_RANGE_START = 11;
export const ADMIN_RANGE_END = 100;
export const USER_RANGE_START = 101;

async function nextCodeInRange(start: number, end: number | null): Promise<string> {
  const roots = await prisma.user.findMany({
    where: { parentId: null, accountCode: { not: null } },
    select: { accountCode: true },
  });
  let maxCode = start - 1;
  for (const r of roots) {
    const code = r.accountCode!;
    if (/^\d+$/.test(code)) {
      const n = parseInt(code, 10);
      if (n >= start && (end === null || n <= end) && n > maxCode) maxCode = n;
    }
  }
  const next = maxCode + 1;
  if (end !== null && next > end) {
    throw new Error(`账号区段 ${start}-${end} 已满，无法分配新账号`);
  }
  return String(next);
}

async function nextRootCode(): Promise<string> {
  return nextCodeInRange(USER_RANGE_START, null);
}

export async function nextSuperAdminCode(): Promise<string> {
  return nextCodeInRange(SUPER_ADMIN_RANGE_START, SUPER_ADMIN_RANGE_END);
}

export async function nextAdminCode(): Promise<string> {
  return nextCodeInRange(ADMIN_RANGE_START, ADMIN_RANGE_END);
}

/**
 * 二级子账号 code = `${parentCode}-${nextSiblingNum}`
 * 兄弟序号取现有兄弟中最大的 -N + 1，避免删除后回填冲突
 */
async function nextChildCode(parentId: string, parentCode: string): Promise<string> {
  const siblings = await prisma.user.findMany({
    where: { parentId, accountCode: { not: null } },
    select: { accountCode: true },
  });
  const prefix = `${parentCode}-`;
  let maxN = 0;
  for (const s of siblings) {
    const code = s.accountCode!;
    if (code.startsWith(prefix)) {
      const tail = code.slice(prefix.length);
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > maxN) maxN = n;
      }
    }
  }
  return `${parentCode}-${maxN + 1}`;
}

export async function generateAccountCode(parentId: string | null): Promise<string> {
  if (parentId) {
    const parentCode = await ensureAccountCode(parentId);
    return nextChildCode(parentId, parentCode);
  }
  return nextRootCode();
}

async function backfillAccountCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, parentId: true, createdAt: true },
  });
  if (!user) throw new Error(`user not found: ${userId}`);

  if (user.parentId) {
    const parentCode = await ensureAccountCode(user.parentId);
    const code = await nextChildCode(user.parentId, parentCode);
    await prisma.user.update({ where: { id: userId }, data: { accountCode: code } });
    return code;
  }

  const code = await nextRootCode();
  await prisma.user.update({ where: { id: userId }, data: { accountCode: code } });
  return code;
}

export async function ensureAccountCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCode: true },
  });
  if (user?.accountCode) return user.accountCode;
  return backfillAccountCode(userId);
}
