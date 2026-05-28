-- 修复订单货币字段：将 OZON 订单的 CNY 改为 RUB
-- 执行前请备份数据库！

-- 1. 查看当前货币分布（执行前检查）
SELECT currency, COUNT(*) as count
FROM orders
GROUP BY currency;

-- 2. 更新 OZON 店铺的订单货币为 RUB
UPDATE orders
SET currency = 'RUB'
WHERE currency = 'CNY'
  AND shop_id IN (
    SELECT id FROM shops WHERE platform = 'OZON'
  );

-- 3. 验证更新结果
SELECT
  s.platform,
  o.currency,
  COUNT(*) as order_count,
  SUM(o.total_amount) as total_amount
FROM orders o
JOIN shops s ON o.shop_id = s.id
GROUP BY s.platform, o.currency
ORDER BY s.platform, o.currency;

-- 4. 检查是否有异常订单（金额过小，可能是之前错误换算的）
SELECT
  o.id,
  o.posting_number,
  o.total_amount,
  o.currency,
  s.name as shop_name,
  s.platform
FROM orders o
JOIN shops s ON o.shop_id = s.id
WHERE o.total_amount < 10 AND o.currency = 'RUB'
ORDER BY o.total_amount ASC
LIMIT 20;
