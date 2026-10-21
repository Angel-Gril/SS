# 2026-10-22 双区安全运行时维护

用户要求将COM/CN更新到最新安全版本，已授权生产访问、补丁部署和必要服务重启。目标为Node22最新安全补丁、已发布的受影响依赖及系统CA更新；保持Next/Fastify/PostgreSQL/Redis拓扑、COM DOTH+BINI及现有功能开关、CN direct/RDS dark。排除用户此前明确不要求修改的Premium模块、付费生成/Ozon业务写入、官网CAS和无关大版本迁移。

## 最终运行结果

源码安全修复`6a5f3755`与逐设备店铺合同修复`d95663945745851226c84232c20faf5e5afdc3f6`已推送；COM/CN标准部署及FULL VPS均成功，应用候选463。COM三进程606031/606030/606033、CN298832/298831/298844的`/proc/PID/exe`均精确为`/opt/ss-erp-node/v22.23.4/bin/node`；不是仅默认CLI版本变化。两区`process.version=v22.23.4`、内置OpenSSL3.5.9、Sharp0.35.5/librsvg2.63.2/Undici8.12.3、正常SVG→PNG及Brotli往返通过。系统CA为20260816ubuntu0.26.04.1，受影响emSign ECC G3在配置中禁用且无active证书链接；系统OpenSSL/libssl保持已有修复的Ubuntu3.5.5-1ubuntu3.7，Nginx1.28.3-2ubuntu1.11配置校验通过。未在两区发现需升级的PHP/Go服务，不为消新闻告警额外安装。

Node x64/arm64包分别通过官方release-key `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356` clear-sign验证与tar SHA，二进制原件/旧系统包状态、CA目录与unit副本保留在各主机`/var/lib/ss-erp-runtime-updates/20261022-node22`；旧apt `/usr/bin/node`未改，新的CLI链接与三服务独立Node路径明确，不以覆盖apt文件或绕过unit检查切换。原release及unit快照仍可恢复；CA包按发行版更新，不跨OpenSSL大版本。

463区域签名SHA为COM `71679b9e68e26c40f027db408f1e3e7bffce93a4f8bae385eb55c43a10f25e84` / CN `c5b128238d090b234a5677c64756ddb8f7873a905e773c3486bfcf0d3cabf4b6`，两区真实签名包MV3安装/默认工作台/popup/来源拒绝通过并关闭专用浏览器，用户浏览器未动。新checkout-r2完整native offline于2026-10-21T17:28:12.060Z PASS（后端7400 passed/395既有环境skip、构建、数据库隔离集成/升级回放与Cloud/Local验证），不把skip当实测。Linux原生22项/0skip与policy30项、部署/canary/批准98 passed/1既有POSIXskip回归及独立复核通过。一次重复离线runner误启动后两份执行均停止，取消原件保留，以新独立r2结果为唯一完整证据，没有混用两份日志。

COM/CN目标备份和日常恢复分别144/143表，临时恢复库均清理；双区FULL VPS canonical均PASS、failures0/warnings1，唯一既有local-only远端备份未配置警告保持。标准封存/迁移门禁暂停过API/Worker，不记无停机；COM另一次重复部署被既有活动build锁拒绝，未删除锁或覆盖release，原持锁部署正常完成并已收取成功终态，失败原件保留。CN标准构建/封存/迁移完成后正常切换。最后两区API/Web/Worker active、ready DB/Redis ok、运行commit同d956，COM DOTH+BINI名单/实际设备BINI grant/六操作与qwen-vl-max分析保持，CN direct/RDS/AI dark保持，未写入新的policy或设备grant。

官网仍精确服务`efd4f4ad / 1.0.461`，COM/CN原approval SHA及四包下载摘要读回不变；本轮没有正式新suite/QA04 final/官网canary/approval/CAS，不以offline冒充。463为应用部署候选，不伪称官网公开安装包已更新；新map的官网approval兼容仍fail closed，留后续明确公开请求。未触碰Premium模块；没有Provider/Ozon业务写入、重试、测试费用或客户数据恢复。真实npm官方prod审计仍0Critical/1High/14Moderate/2Low，只有braces High无上游发布修复；CI仍会对此非零，不写“全部安全门禁通过”。

私有证据：`release-d9566394-orders`（签名/MV3/部署/备份/FULL/health）、`release-d9566394-website463-r2`（唯一完整offline）、`security-update-20261022-bITHqk`（apt/GPG/SHA/运行时/原生codec）。失败462/原463重复离线及锁拒绝原件保留，不入Git。收尾只提交日志/文档，不改变应用候选身份或重新部署。

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

中间检查点（应用部署前）：两区官方22.23.4已验证签名/SHA并独立安装，系统CA更新，旧应用进程保持健康；依赖与启动owner本地实现完成，最小2项RED→GREEN、Windows12项通过/10项POSIXskip，Linux原回归初轮21通过/1因镜像缺git失败，补齐隔离测试容器工具后22项全部通过、0skip（镜像digest `sha256:5991875dfb80938dd8a6ba3fe3e96fd04929e70792762b3319d8caadbbe229bc`）。本机实际Sharp0.35.5/librsvg2.63.2/undici8.12.3读回，脚本ESLint及diff通过。真实npm audit为0Critical/1High/14Moderate/2Low，剩余High仅braces，不把静态CI合同通过当真实audit全绿。

首版源码`6a5f3755`已推送并生成462双区签名/MV3通过；CN目标备份恢复143表通过，但COM预检正确拒绝旧“每设备须拥有全部试点店铺”合同：当前用户设备`33a6824a-b0b8-4f9d-b2e9-a219bb0674ee`只授BINI，服务端policy仍DOTH+BINI，未越权。没有擅自扩大设备grant或修改policy。最小修复在原`verify-ai-media-pilot-policy.mjs`增加显式`deviceShopIds` expectation：keys精确覆盖当前全部deviceSessionIds，每值合法、非空、唯一且为原policy shops子集；每设备实际grant继续与其期望完全相等，未传map的旧默认仍严格全部店铺。owner/scope/操作/revision/BYOK边界不变。30项原policy测试含真实RED→GREEN及缺key/外店铺/额外scope/错owner/错device负例，部署/canary/批准相关回归进行中。

462原件与失败保留，未部署；原完整offline在新owner修正后停止，不能给新commit复用。policy30项及部署/canary/批准相关回归98 passed/1既有POSIXskip通过，新增映射独立复核无授权放宽；首次lint发现测试局部未使用变量已修正。官网approval消费者对新map仍fail closed、不宣称新map已通过官网发布。本轮只部署应用，下一候选从最终clean commit生成463并重新完整offline；旧461官网保持，无Provider/费用。操作日志保存在私有`security-update-20261022-*`，不入Git。
