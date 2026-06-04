# Git 工作流

目标：让 Claude/Codex 协作开发有稳定主线、明确审查点和自动化验证。以后不要把长期开发堆在一个 feature 分支里。

## 分支模型

```text
main                 # 稳定可部署分支
dev                  # 集成分支，承接已审查功能
feature/<topic>      # 短期功能分支
fix/<topic>          # 普通缺陷修复
hotfix/<topic>       # 线上紧急修复
release/<target>     # 上线冻结或发行包分支
```

## 基本规则

- `main` 只放可部署版本，不直接开发。
- `dev` 是日常集成分支，功能审查通过后合入。
- `feature/*` 必须短生命周期，一个分支只做一个主题。
- `release/*` 只用于上线冻结、本地包或云端发行，不作为日常开发分支。
- 功能完成后优先通过 PR 合并；如果本地合并，合并前必须先跑验证。
- 远端功能分支合并后及时删除，避免分支长期漂移。

## 标准流程

### 1. 开始新任务

```powershell
git checkout dev
git pull origin dev
git checkout -b feature/ozon-cors-proxy
```

### 2. 开发和本地验证

至少运行和改动相关的检查。常用命令：

```powershell
pnpm typecheck
pnpm --filter server test
pnpm --filter web build
pnpm verify:extension
```

### 3. 推送功能分支

```powershell
git push -u origin feature/ozon-cors-proxy
```

GitHub Actions 会在任意分支 push 时运行 CI。PR 合并目标为 `dev` 或 `main` 时也会运行 CI。

### 4. 审查和合并

Claude/Codex 审查通过后合入 `dev`：

```powershell
git checkout dev
git pull origin dev
git merge --no-ff feature/ozon-cors-proxy
git push origin dev
```

阶段稳定后再从 `dev` 合入 `main`：

```powershell
git checkout main
git pull origin main
git merge --no-ff dev
git push origin main
```

上线版本建议打 tag：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

## 线上修复

紧急修复从 `main` 拉 `hotfix/*`：

```powershell
git checkout main
git pull origin main
git checkout -b hotfix/login-rate-limit
```

修复验证后先合回 `main`，再同步回 `dev`：

```powershell
git checkout main
git merge --no-ff hotfix/login-rate-limit
git push origin main

git checkout dev
git pull origin dev
git merge --no-ff main
git push origin dev
```

## CI 触发规则

当前 CI 规则：

- 任意分支 `push` 都运行 typecheck、security、build。
- PR 到 `main` 或 `dev` 会运行 CI。
- Docker 镜像构建只在 `main` 分支执行，且当前只构建不推送镜像。
- `workflow_dispatch` 支持手动运行 CI。

## 部署规则

当前线上 VPS 仍使用 `scripts/deploy-app-dir.sh` 从本地提交打包上传，并由 systemd 运行 `/opt/ss-erp/app`。

部署来源应限制为：

- `main`
- 明确冻结的 `release/*`
- 经用户明确批准的指定 commit

不要从普通 `feature/*` 分支直接部署线上环境。

## 提交规范

使用 Conventional Commits：

```text
feat(extension): add Ozon product overlay
fix(auth): reject weak production secrets
docs(workflow): define dev branch integration flow
chore(ci): run CI on all branches
```

不要提交：

- `.env` 或真实密钥
- `node_modules`
- `.next`
- `build/dist`
- `apps/server/dist`
- 本地上传图片、水印图片、日志、数据库目录

## 当前迁移建议

当前仓库已经有较长的 `feature/local-windows-package` 历史。短期做法：

1. 先把本分支作为新的 `dev` 初始点推送。
2. 后续新工作全部从 `dev` 拉短 feature 分支。
3. 等当前集成状态验证稳定后，再把 `dev` 合入 `main`。
4. 合入后清理已经完成的旧 feature 分支。
