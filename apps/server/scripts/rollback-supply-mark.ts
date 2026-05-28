/**
 * 紧急回滚脚本：撤销 mark-supply-needs-review.ts 错误的转换
 *
 * 错误：脚本假设所有 ozon.ru 来源数据都是 RUB，但实际之前的采集
 * 页面是"俄语+人民币"（中国卖家版），数据本来就是 CNY，被错误地
 * 用 0.078 汇率又转了一遍。
 *
 * 回滚逻辑：
 * - 只处理 priceNeedsReview=true 的（这是错误脚本打的标记）
 * - 把 originalPrice 复制回 purchasePrice（恢复原值）
 * - 清掉 original* / exchangeRateUsed / priceNeedsReview
 *
 * 用法：cd apps/server && npx tsx scripts/rollback-supply-mark.ts
 */
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const candidates = await prisma.supplyGoods.findMany({
    where: { priceNeedsReview: true, originalPrice: { not: null } },
    select: { id: true, originalPrice: true, purchasePrice: true },
  });

  console.log(`Found ${candidates.length} mistakenly-converted records to rollback`);
  let rolled = 0;

  for (const sg of candidates) {
    if (sg.originalPrice == null) continue;
    await prisma.supplyGoods.update({
      where: { id: sg.id },
      data: {
        purchasePrice: sg.originalPrice,
        originalPrice: null,
        originalCurrency: null,
        exchangeRateUsed: null,
        priceNeedsReview: false,
      },
    });
    rolled++;
  }

  console.log(`Rolled back ${rolled} supply goods`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
