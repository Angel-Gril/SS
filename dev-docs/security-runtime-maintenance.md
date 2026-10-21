# 2026-10-22 双区安全运行时维护

用户要求将COM/CN更新到最新安全版本，已授权生产访问、补丁部署和必要服务重启。目标为Node22最新安全补丁、已发布的受影响依赖及系统CA更新；保持Next/Fastify/PostgreSQL/Redis拓扑、COM DOTH+BINI及现有功能开关、CN direct/RDS dark。排除用户此前明确不要求修改的Premium模块、付费生成/Ozon业务写入、官网CAS和无关大版本迁移。

## Owner与当前证据

- npm依赖owner：`apps/server/package.json`、`pnpm-workspace.yaml`与生成锁文件；升级6个有正式补丁的包，不手工改锁文件。
- 运行进程owner：`deploy/systemd-release/*.service`及`scripts/install-release-systemd.sh`。两区2026-10-21T16:07Z实际读取均Ubuntu26.04、Node22.22.1；COM x64/CN arm64，apt更新后仍无新版Node。API/Worker/Web均固定`/usr/bin/node`，改PATH不改变服务。
- 两区OpenSSL/libssl为`3.5.5-1ubuntu3.7`，Ubuntu已回补9/29针对3.5适用漏洞，保留发行版包；CA更新到现有源`20260816ubuntu0.26.04.1`。不做全机dist-upgrade或安装未使用的PHP/Go。
- 将release三服务及安装器校验统一固定到root-owned官方Node22.23.4目录`/opt/ss-erp-node/v22.23.4/bin/node`；安装器先验证可信祖先/二进制及版本，再快照和安装unit。保留apt旧Node，不覆盖`/usr/bin/node`，不增加软件源或临时override绕过部署owner。
- 构建命令使用同一新版Node。`/usr/local/bin/node`只有原来不存在时才可建指向受验证版本的root-owned链接，原状记录；systemd仍用固定真实文件。
- Node tar先用官方release-keys keyring验证清签SHASUMS，再核tarSHA与架构；只解压到精确新目录，不覆盖已有版本。依赖/运行时更新从最终clean commit经原签名、备份恢复、部署、FULL VPS路径执行。

## 依赖目标及已知未解决项

sharp0.35.5、undici8.12.3、busboy3.2.3、fast-uri3.1.9（保持3线）、brace-expansion5.0.12、source-map-js1.2.2。braces3.0.3的GHSA-vfj7-8cjw-p6xm暂无官方发布修复：npm无3.0.4，GitHub公告first_patched_version=null，相关PR未合并；保留未解决High，不伪造版本、改分类或修改CI忽略项。项目已确认路径为静态Tailwind构建glob，未证明外部HTTP可利用。

## 验证与恢复

- D2：既有依赖/进程启动/部署消费者协作，不改身份、schema或业务状态机。
- T1依赖：npm官方audit11High为基线；更新后比较原路径，保留上游未发布braces单条High，不称全部审计通过。执行对应后端/图像/扩展与构建回归。
- T2启动：先在原systemd/CI测试加入目标运行时和安装前可信校验，观察RED，再实现GREEN；保留unit快照/恢复及不可信路径负例。
- T3环境：tar签名/SHA/架构、新node与native sharp、三服务`/proc/PID/exe`、ready DB/Redis、区域flags和官网原pointer读回。完整offline与备份恢复继续执行，COM成功后切CN。
- 安装新Node不先停服务；切换前保存旧release/units/系统包状态并核对待处理任务。签名、源身份、权限或策略异常即停止；健康失败恢复原units/current并确认ready，不能继续切另一地区。
- 原官网461 pointer保持；不因后端依赖变化补造或复用旧正式suite，不发新Provider请求。应用部署成功与官网公开下载分别记录。

当前状态：两区官方22.23.4已验证签名/SHA并独立安装，系统CA更新，旧应用进程保持健康；依赖与启动owner本地实现完成，最小2项RED→GREEN、Windows12项通过/10项POSIXskip，Linux原回归初轮21通过/1因镜像缺git失败，补齐隔离测试容器工具后22项全部通过、0skip（镜像digest `sha256:5991875dfb80938dd8a6ba3fe3e96fd04929e70792762b3319d8caadbbe229bc`）。本机实际Sharp0.35.5/librsvg2.63.2/undici8.12.3读回，脚本ESLint及diff通过。真实npm audit为0Critical/1High/14Moderate/2Low，剩余High仅braces，不把静态CI合同通过当真实audit全绿。

首版源码`6a5f3755`已推送并生成462双区签名/MV3通过；CN目标备份恢复143表通过，但COM预检正确拒绝旧“每设备须拥有全部试点店铺”合同：当前用户设备`33a6824a-b0b8-4f9d-b2e9-a219bb0674ee`只授BINI，服务端policy仍DOTH+BINI，未越权。没有擅自扩大设备grant或修改policy。最小修复在原`verify-ai-media-pilot-policy.mjs`增加显式`deviceShopIds` expectation：keys精确覆盖当前全部deviceSessionIds，每值合法、非空、唯一且为原policy shops子集；每设备实际grant继续与其期望完全相等，未传map的旧默认仍严格全部店铺。owner/scope/操作/revision/BYOK边界不变。30项原policy测试含真实RED→GREEN及缺key/外店铺/额外scope/错owner/错device负例，部署/canary/批准相关回归进行中。

462原件与失败保留，未部署；原完整offline在新owner修正后停止，不能给新commit复用。policy30项及部署/canary/批准相关回归98 passed/1既有POSIXskip通过，新增映射独立复核无授权放宽；首次lint发现测试局部未使用变量已修正。官网approval消费者对新map仍fail closed、不宣称新map已通过官网发布。本轮只部署应用，下一候选从最终clean commit生成463并重新完整offline；旧461官网保持，无Provider/费用。操作日志保存在私有`security-update-20261022-*`，不入Git。
