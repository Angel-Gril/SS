# 本地离线 ERP

这份方案适合用户不多、网络条件不稳定、或者需要在单机上长期运行的场景。

## 建议架构

- Web、API、Worker、PostgreSQL、Redis 全部放在同一台 VPS 或本地服务器
- 图片默认本地存储
- 短信可以临时用 `console` provider 做开发验证
- 生产备份再按需接到远程 S3 兼容存储

## 适用边界

- 适合小规模用户
- 适合先上线、先跑业务，再逐步分拆
- 不适合一开始就上 K8s、1Panel、分布式存储集群

## 文件与数据

- 上传图：本地盘或单一对象存储桶
- 备份：本地 + 远程二选一或同时使用
- 日志：保留最近几天，配合 `journalctl` / logrotate

## 更新方式

推荐两种方式，二选一：

### 方式 A: GitHub 仓库拉取部署

服务器本身就是一个 git checkout 时，直接用：

```bash
./scripts/deploy-staging.sh
```

优点是简单，适合单机小团队。

### 方式 B: release 目录 + symlink 回滚

如果你更看重回滚速度和版本隔离，使用：

```bash
DEPLOY_HOST=<server> DEPLOY_USER=<user> ./scripts/deploy.sh
```

优点是每次发布都有独立版本目录，失败可以快速切回上一版。

## 什么时候该分拆 worker

先保持单体即可。只有出现下面情况再拆：

- 队列经常堆积
- 图片处理或 OZON 同步拖慢 API
- 数据库 CPU / IO 持续高
- 单 VPS 风险开始不可接受

到那时先拆 worker，不必直接上 K8s。

