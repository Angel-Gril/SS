import { prisma } from './prisma.js';

// 1-100 为内部测试账号区段（手动分配）
// 普通用户账号从 101 起，按注册顺序（UTC 时间）递增
const USER_RANGE_START = 101;

/**
 * 计算下一个用户账号 code
 * 只统计 ≥ 101 的根账号取最大值 + 1，确保测试账号区段（1-100）不影响用户账号分配
 */
async function nextRootCode(): Promise<string> {
  const roots = await prisma.user.findMany({
    where: { parentId: null, accountCode: { not: null } },
    select: { accountCode: true },
  });
  let maxCode = USER_RANGE_START - 1; // 100，下一个返回 101
  for (const r of roots) {
    const code = r.accountCode!;
    if (/^\d+$/.test(code)) {
      const n = parseInt(code, 10);
      // 只统计用户区段，跳过 1-100 的测试账号
      if (n >= USER_RANGE_START && n > maxCode) maxCode = n;
    }
  }
  return String(maxCode + 1);
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
