# PostgreSQL 慢查询配置

## 配置说明

为了监控和优化数据库性能，建议启用 PostgreSQL 慢查询日志。

### 1. 修改 postgresql.conf

编辑 PostgreSQL 配置文件（通常位于 `/etc/postgresql/<version>/main/postgresql.conf` 或数据目录下）：

```conf
# 记录执行时间超过 200ms 的查询
log_min_duration_statement = 200

# 记录查询计划（可选，用于分析慢查询）
log_statement = 'none'
log_duration = off

# 日志格式（包含时间戳、用户、数据库、进程 ID）
log_line_prefix = '%t [%p] %u@%d '

# 日志目录（默认）
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
```

### 2. 重启 PostgreSQL

```bash
# Linux
sudo systemctl restart postgresql

# macOS (Homebrew)
brew services restart postgresql

# Windows
# 通过服务管理器重启 PostgreSQL 服务
```

### 3. 查看慢查询日志

```bash
# Linux
tail -f /var/log/postgresql/postgresql-*.log | grep "duration:"

# macOS (Homebrew)
tail -f /usr/local/var/log/postgresql@*.log | grep "duration:"

# Windows
# 查看 PostgreSQL 数据目录下的 log 文件夹
```

### 4. 分析慢查询

日志示例：
```
2026-05-31 16:30:45.123 [12345] user@sserp LOG:  duration: 523.456 ms  statement: SELECT * FROM orders WHERE shop_id = '...' AND status = 'awaiting_deliver' ORDER BY created_at DESC LIMIT 50
```

关注点：
- `duration` > 200ms 的查询
- 频繁出现的查询模式
- 缺少索引的 WHERE/ORDER BY 字段

## 已添加的复合索引

本次优化已添加以下复合索引：

### Order 表
- `(shopId, status, createdAt)` — 店铺订单列表按状态筛选 + 时间排序
- `(shopId, createdAt)` — 店铺订单列表按时间排序

### Product 表
- `(shopId, status, updatedAt)` — 店铺商品列表按状态筛选 + 更新时间排序
- `(shopId, updatedAt)` — 店铺商品列表按更新时间排序

### SyncJob 表
- `(shopId, type, status, createdAt)` — 同步任务查询（按店铺、类型、状态筛选 + 时间排序）

### SupplyGoods 表
- `(userId, status, createdAt)` — 用户采集列表按状态筛选 + 时间排序

## 性能监控建议

1. **定期检查慢查询日志**（每周）
   - 识别新的慢查询模式
   - 评估是否需要新索引

2. **监控索引使用率**
   ```sql
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
   FROM pg_stat_user_indexes
   WHERE schemaname = 'public'
   ORDER BY idx_scan ASC;
   ```
   - `idx_scan = 0` 的索引可能未被使用

3. **监控表膨胀**
   ```sql
   SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
   FROM pg_tables
   WHERE schemaname = 'public'
   ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
   ```

4. **定期 VACUUM ANALYZE**（已由 autovacuum 自动执行，但高负载时可手动触发）
   ```sql
   VACUUM ANALYZE orders;
   VACUUM ANALYZE products;
   ```

## 故障排查

### 慢查询日志未生成
- 检查 `log_min_duration_statement` 是否生效：
  ```sql
  SHOW log_min_duration_statement;
  ```
- 确认 PostgreSQL 已重启

### 索引未生效
- 使用 `EXPLAIN ANALYZE` 查看查询计划：
  ```sql
  EXPLAIN ANALYZE
  SELECT * FROM orders WHERE shop_id = '...' AND status = 'awaiting_deliver' ORDER BY created_at DESC LIMIT 50;
  ```
- 检查是否需要 `VACUUM ANALYZE` 更新统计信息

### 索引创建失败
- 检查磁盘空间
- 检查是否有长事务阻塞
