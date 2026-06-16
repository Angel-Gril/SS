# Git 工作流

目标：只有一个正式项目主线，分支只是短期隔离区，避免多人或多个 AI 同时覆盖彼此的工作。

## 分支

- `main`: 唯一正式主线，必须保持可启动、可构建。
- `refactor/routes-split`: Claude 当前路由拆分工作区。
- `feat/auth-sms-turnstile`: 手机验证码和 Cloudflare Turnstile。
- `feat/cloud-deploy`: 云端部署配置。
- `fix/*`: 小范围缺陷修复。

分支不长期存在。一个功能完成、验证通过后合回 `main`，不要并行维护多个产品版本。

## 当前协作约束

- Claude 正在拆 `apps/server/src/routes/collect*` 和 `apps/server/src/routes/order*` 时，其他人不改这些文件。
- 部署、文档、Git 配置可以并行做，因为不触碰业务 handler。
- 第一个全量 baseline commit 等 Claude Step 2 和 typecheck 完成后再做。

## 提交规则

提交信息使用 Conventional Commits：

- `chore: establish project baseline`
- `docs: add launch checklist`
- `infra: add production deployment skeleton`
- `fix(auth): reject weak production secrets`
- `refactor(routes): split collect and order handlers`

不要提交：

- `.env` 或真实密钥
- `node_modules`
- `.next`
- `build/dist`
- `apps/server/dist`
- 本地上传图片、水印图片、日志、数据库目录

## 修复与部署顺序

线上问题不要在 VPS 里直接改业务代码作为最终修复。标准顺序是：

```powershell
git status --short
git add <本次修复文件>
git commit -m "fix(scope): describe the production issue"
git push
```

然后部署这个 commit 到 VPS，并在线上验证。这样 GitHub、开发机和 VPS 的代码都能用同一个 commit 对齐；否则重新打包或回滚时会丢失服务器上的临时改动。

## 合并前验证

至少运行：

```powershell
pnpm --filter server typecheck
pnpm --filter web typecheck
```

如果改了构建或部署：

```powershell
pnpm --filter server build
pnpm --filter web build
docker compose -f docker-compose.prod.yml config
```

## 首次 baseline

首次 baseline 应在当前业务重构稳定后执行：

```powershell
git add <source-and-config-files>
git commit -m "chore: establish project baseline"
```

不要使用 `git add .` 盲目提交。先用 `git status --short` 和 `git status --ignored --short` 确认产物已被忽略。
