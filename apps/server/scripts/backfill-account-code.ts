import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ROOT_BASE = 100;

  const roots = await prisma.user.findMany({
    where: { parentId: null, accountCode: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const existingRootCount = await prisma.user.count({
    where: { parentId: null, accountCode: { not: null } },
  });

  let nextRoot = ROOT_BASE + existingRootCount;
  for (const r of roots) {
    await prisma.user.update({ where: { id: r.id }, data: { accountCode: String(nextRoot) } });
    nextRoot++;
  }
  console.log(`回填 ${roots.length} 个根账户`);

  const children = await prisma.user.findMany({
    where: { parentId: { not: null }, accountCode: null },
    orderBy: [{ parentId: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, parentId: true },
  });

  const grouped = new Map<string, string[]>();
  for (const c of children) {
    if (!c.parentId) continue;
    if (!grouped.has(c.parentId)) grouped.set(c.parentId, []);
    grouped.get(c.parentId)!.push(c.id);
  }

  let childTotal = 0;
  for (const [parentId, ids] of grouped) {
    const parent = await prisma.user.findUnique({
      where: { id: parentId },
      select: { accountCode: true },
    });
    if (!parent?.accountCode) {
      console.warn(`父账户 ${parentId} 无 accountCode，跳过其 ${ids.length} 个子账户`);
      continue;
    }
    const existingChildren = await prisma.user.count({
      where: { parentId, accountCode: { not: null } },
    });
    let next = existingChildren + 1;
    for (const id of ids) {
      await prisma.user.update({
        where: { id },
        data: { accountCode: `${parent.accountCode}-${next}` },
      });
      next++;
      childTotal++;
    }
  }
  console.log(`回填 ${childTotal} 个子账户`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
