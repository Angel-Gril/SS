# SS ERP 人机验证与雷池 WAF 评估

日期：2026-07-22（2026-07-23 复核）

## 结论

雷池的人机验证可作为 Web 边界的第二层防护，但**不能替代** SS ERP 在注册、登录和短信发送接口内校验的、绑定业务动作的一次性挑战。对当前系统，建议采用以下分层方案：

1. 应用层始终保留：业务动作绑定的人机挑战、手机号/IP 配额、短信全局费用熔断。WAF 看不到“今日该手机号已发送多少次”或“本月短信费用是否越界”这类业务状态。
2. 海外：继续使用应用内 Cloudflare Turnstile，服务端同时校验 `success`、`action` 和显式 hostname 白名单；Cloudflare 代理/WAF 仅作边界层。若启用代理，必须封闭源站直连。
3. 中国内地短期：使用现有 `builtin-pow`。它已经绑定动作、签名、过期并通过 Redis 单次消费，不需要再运行一个验证码服务。
4. 中国内地正式对公网开放、出现真实自动化滥用后：增加阿里云验证码 2.0 provider。它比自托管 PoW 多了设备、行为和风险情报判断，且与现有阿里云 ECS/短信体系更一致。
5. ALTCHA 只在需要标准化、无障碍组件或内存硬 PoW 时值得替换现有 PoW；mCaptcha 和雷池都不值得仅为验证码而增加一套常驻服务。
6. 雷池可单独作为 WAF 项目评估，但 SS ERP 若属于商业用途，**当前免费的个人版协议是阻断项**：官方协议明确禁止商业用途。未经长亭书面确认或购买合适授权，不应部署到商业生产。
7. 若观测数据证明国内需要独立 WAF，免费方案的首选是独立边缘机 PoC aaWAF；若不增加反向代理跳数，则评估与生产 Nginx ABI 兼容的 ModSecurity v3 + OWASP CRS 模块。两者都必须先以观察模式验证误报、真实 IP 和源站旁路，再决定是否阻断流量。
8. Coraza 当前更适合 Caddy、Envoy/Istio 等集成，面向 Nginx 的 C library 仍处于实验状态；uuWAF 的发行许可存在非商业限制；EdgeOne Free 的中国大陆长期权益未得到正式合同确认，因此三者暂不进入 SS ERP 的生产候选短名单。

## 方案对比

| 方案 | 所在层 | 业务动作绑定 | 防重放 | 风险识别 | 运维/依赖 | 对本项目的判断 |
| --- | --- | --- | --- | --- | --- | --- |
| 现有 `builtin-pow` | 应用 | 已绑定 `login`、`sms_login`、`register_sms`、`password_reset_sms`、`admin_login` | HMAC + TTL + Redis `SET NX` 单次消费 | 无，只提高每次请求的计算成本 | 复用 Node/Redis，无新增服务 | 国内立即可用的基线 |
| Cloudflare Turnstile | 应用，云托管 | token 带 `action`，服务端可核对 action/hostname | 官方 token 5 分钟、只能验证一次 | Cloudflare 托管判断 | 外部 API；中国内地不提供 | 海外首选，国内不作为主链路 |
| 开源 ALTCHA | 应用，自托管库 | 可由应用在挑战数据/签发端实现；不是自动获得 | 开源模式要求应用自行保存已用挑战；Sentinel API 才内置防重放 | 开源版主要是 PoW | 可只引入前后端库；MIT | 能改善组件和算法，但与现有实现高度重叠 |
| mCaptcha | 应用，自托管服务 | sitekey/token 可分场景，应用向服务验证 token | 官方称配置 30 秒且只用一次 | 主要是动态难度 PoW | Rust 服务 + PostgreSQL + 专用 cache/Redis；AGPL | 能工作，但本项目收益低于新增运维成本 |
| 雷池个人版/CE | 反向代理/WAF | 未提供交给业务接口校验的 action token；是站点 Session/Cookie | 可选“请求防重放”会为 Session 的后续请求轮换一次性 Cookie 签名 | IP 历史、浏览器真实性、调试与键鼠行为 | 至少 1C/2GB/5GB；Compose 含多个容器和独立 PostgreSQL | 只能做边界纵深；商业授权与数据采集需先解决 |
| 堡塔 aaWAF | 反向代理/WAF | 未提供业务 action token；人机验证属于 WAF 规则/会话层 | 不能替代应用 OTP 和 Redis 单次消费 | Web 攻击规则、基础/URL 级 CC、人机验证 | 建议独立边缘机；部署制品、AGPL 义务和管理面需单独审查 | 厂商材料声明免费可商用，可作为国内 GUI WAF 首选 PoC，不直接进入生产 |
| ModSecurity v3 + OWASP CRS | 现有 Nginx 的可选 WAF 模块 | 无 | 无业务防重放 | OWASP CRS 规则检测 | 需匹配 Nginx ABI、维护模块和调优误报；Apache-2.0 | 不增加代理跳数的免费备选，但没有托管 DDoS 或人机验证能力 |
| 阿里云验证码 2.0 | 应用，云托管 | 服务端可强制传入预期 `SceneId` | 官方返回重复提交错误；V3 参数与场景/用户不匹配也会失败 | 设备、交互行为、IP/设备频率及托管策略 | SDK/API；可从上海 ECS 走 VPC endpoint | 国内公开生产首选升级路径 |

## 当前内置 PoW 的位置

SS ERP 的实现不是普通“图片验证码”。[`human-challenge.ts`](../../apps/server/src/lib/human-challenge.ts) 的 payload 包含 `action`、随机 challenge、`exp`、`jti` 和 difficulty，并用 HMAC 签名；校验端检查 action/过期/难度，通过 Redis `SET ... NX` 只允许成功一次。认证路由在实际处理注册短信、找回密码短信、短信登录、密码登录前调用该校验。[认证路由](../../apps/server/src/routes/auth.ts)

这使它比 WAF 的“浏览器曾通过挑战”更接近短信费用保护目标。不过它只是工作量证明，不会识别人类：无头浏览器、代理池和攻击集群仍能求解；difficulty 还是全局静态值，也未绑定具体手机号。因此它必须与手机号/IP 日配额及全局费用熔断共同使用。

## 雷池 CE 能做什么

### 官方描述的能力

雷池通过 Nginx 反向代理接入：域名 DNS 指向雷池，雷池监听公网端口，再转发到上游应用。人机验证是在“防护应用”卡片的 Bot 防护中开启。官方说明其评分信号包括源 IP 的历史恶意行为、是否为真实浏览器、是否存在监控/调试，以及键盘鼠标行为；通过者获得站点访问能力，自动化程序被拒绝。[添加应用](https://help.waf-ce.chaitin.cn/node/01973fc6-e14a-7234-8acd-bdba21c8b3f3) [Bot 防护 - 人机验证](https://help.waf-ce.chaitin.cn/node/01973fc6-e1d8-7af4-b697-ab1312b8f9bd)

它还有两个相关能力：

- CC 频率限制：官方文档描述的是按**源 IP**设置请求频率/速率阈值，超限后阻止该 IP。[CC 防护 - 频率限制](https://help.waf-ce.chaitin.cn/node/01973fc6-e1ee-7bff-9806-6c8448c426d6)
- 请求防重放：依赖先开启人机验证；通过后给客户端 Session 颁发 Cookie 形式的一次性签名，每次请求更新，重复签名会导致请求被拦截并吊销 Session。[Bot 防护 - 请求防重放](https://help.waf-ce.chaitin.cn/node/01973fc6-e1c9-7872-ab05-8b30dba5257a)

### 粒度和 API 兼容性

官方文档展示的是**每个防护应用/站点开关**，没有公布按业务 action 签发、由上游服务端验证的 challenge API，也没有展示人机验证按 URL/HTTP 方法条件触发。公开的自定义规则教程支持按 URL 配黑白名单，但没有把人机验证列为规则动作。[自定义规则配置教程](https://help.waf-ce.chaitin.cn/node/01973fc6-e192-7761-b020-02be6c8dbe21)

因此，以下是基于官方流程的工程判断：

- 浏览器 SPA：可作为透明前置层工作，挑战通过后的 Cookie 随请求携带。
- JSON API、原生 App、服务间调用：其浏览器环境和键鼠判断可能直接拒绝非浏览器客户端，或用 HTML/JavaScript challenge 中断预期的 JSON 协议；需要单独站点、旁路或明确验证后再用。
- 短信接口：它最多证明该浏览器 Session 通过了边界检查，不能证明当前票据专属于 `register_sms`，也不能实现手机号配额或短信费用熔断。

所以它不能替换当前 `HumanChallengeProvider`，只能叠加在它之前。

### 部署拓扑与直接源站

官方最低要求为 Linux、Docker/Compose、1 核 CPU、2 GB 内存、5 GB 磁盘。当前官方 Compose 包含 PostgreSQL、管理端、检测器、Tengine、Luigi、FVM、Chaos 等服务，其中 Tengine 使用 host network。[免费安装](https://help.waf-ce.chaitin.cn/node/01973fc6-df0f-7650-bafa-8ed8d2fc2bc1) [官方 Compose](https://github.com/chaitin/SafeLine/blob/92d5502fb42c50a87c97e4e4bc2362241af4347a/compose.yaml)

在当前阿里云 ECS 上同机部署技术上可行，但必须改成：

```text
Internet -> 雷池 80/443 -> 仅本机/私网可达的现有反向代理或 Web/API
```

必须关闭原 Web/API 公网端口，否则攻击者可绕过雷池；9443 管理口只允许 VPN/管理 IP。当前 SS ERP 的国内入口由宿主机 Nginx 监听 80/443，而雷池官方 Compose 的 Tengine 使用 `network_mode: host`；因此不能在生产机上直接 `docker compose up`，必须先把现有 Nginx 改到仅回环/私网的非冲突端口，或让雷池完全接管 TLS 与回源。这个切换需要维护窗口和可验证的回滚方案。[国内直连 Nginx 模板](../../docker/nginx/ss-erp-cn-direct.conf) [官方 Compose](https://github.com/chaitin/SafeLine/blob/92d5502fb42c50a87c97e4e4bc2362241af4347a/compose.yaml)

“封闭源站”必须由外部 verifier 持续证明，而不能只检查配置文件：同时测试 IPv4/IPv6、历史 DNS 记录、直接 IP、备用域名、Docker published ports、云安全组和主机防火墙，确认除预期 WAF 节点外没有 origin listener 可达；故障切换和回滚也不得静默重新开放公网源站。

与应用同机还会共享 CPU、内存、磁盘和故障域，不提供 CDN 或带宽清洗。官方将雷池定义为位于 Web 应用前的反向代理，并将限频能力描述为防 DoS/CC；由此部署边界决定，已经打满 ECS 公网带宽或上游链路的流量不会因为本机 WAF 而恢复可用性，DDoS 仍需阿里云等上游清洗能力。[官方项目说明](https://github.com/chaitin/SafeLine/blob/92d5502fb42c50a87c97e4e4bc2362241af4347a/README.md)

若确需雷池，独立小型边缘 ECS、源站安全组只接受边缘机流量，比同机部署更清晰；但它会增加一台需补丁、监控、备份和故障切换的公网关键节点。中国内地应使用国内发行路径；官方 README 明确警告中国大陆安装国际版可能无法连接其云服务。海外也能自托管，但应部署在靠近用户和源站的区域，不能让所有海外流量绕行中国 ECS。[官方项目说明](https://github.com/chaitin/SafeLine/blob/92d5502fb42c50a87c97e4e4bc2362241af4347a/README.md)

### 授权和数据采集

这里存在需要法务/供应商澄清的双重口径：GitHub 仓库根许可证是 GPLv3；但官方“个人版使用协议”明确写明禁止商业用途，只许可单一设备，且禁止逆向、修改、再分发和绕过技术限制。官方 Compose 同时拉取多个预构建镜像。对这些发行镜像和个人版产品，不应仅凭 GitHub 根许可证推断可用于商业 ERP。[GitHub LICENSE](https://github.com/chaitin/SafeLine/blob/92d5502fb42c50a87c97e4e4bc2362241af4347a/LICENSE.md) [个人版使用协议](https://help.waf-ce.chaitin.cn/node/01973fc6-dfad-745a-8bb4-4ceb97fcd967)

官方信息采集说明披露：安装/更新时采集服务器 IP、机器码、版本；运行中采集请求/拦截统计和各功能启用状态；恶意 IP 数据可每日上报；攻击拦截页包含设备指纹代码。公开环境变量说明中未列出 telemetry 关闭项。公开源码也在初始化选项时异步发送安装 telemetry。[信息采集说明](https://help.waf-ce.chaitin.cn/node/01973fc6-dfc6-7f0b-864d-188340a60b1b) [环境变量说明](https://help.waf-ce.chaitin.cn/node/01973fc6-df8a-766c-b6e8-45ad7b4fef22) [安装 telemetry 源码](https://github.com/chaitin/SafeLine/blob/92d5502fb42c50a87c97e4e4bc2362241af4347a/management/webserver/model/option.go#L25-L61)

这不等于雷池不可用，但上线前需要完成商业授权确认、隐私告知/数据出境评估以及网络出站策略评审。

## 其他开源方案

### ALTCHA

ALTCHA v3 是 MIT 许可的 Web Component 和多语言服务端库，可完全自托管。开源模式要求服务端为每次交互签发新挑战，并在表单处理器内加密校验；官方安全建议明确要求应用维护已使用挑战注册表和短过期时间来防重放。它支持 PBKDF2、SHA、Argon2id 和 Scrypt；后两者能提高 GPU/ASIC 批量求解成本。[仓库](https://github.com/altcha-org/altcha/tree/156bb306827fcbf5e3d8677ba4653e7ed9659ec3) [服务端接入](https://altcha.org/docs/v2/server-integration) [防重放建议](https://altcha.org/docs/v2/security-recommendations) [PoW 算法](https://altcha.org/docs/v2/proof-of-work-captcha)

它适合把当前自研 UI/PoW 算法替换为标准组件，但仍须由 SS ERP 保存一次性状态并绑定 action。对当前项目，最有价值的是成熟组件、无障碍支持和内存硬算法，不是新增“真人识别”。不建议为此部署付费/独立 Sentinel，除非还需要其自适应验证码、分类、IP 情报和内置限流。

### mCaptcha

mCaptcha 的流程与应用验证码匹配：浏览器求解 PoW，mCaptcha 发 token，业务服务调用 `/api/v1/pow/siteverify` 校验；官方称 PoW 配置有效 30 秒且只能使用一次。它无跟踪、与 IP 无关并支持按流量动态难度。[README](https://github.com/mCaptcha/mCaptcha/blob/b215a411ed3e53e3c5d77465f73b40d35986ec93/README.md#L35-L73)

代价是运行完整 Rust 应用、PostgreSQL 和 `mCaptcha/cache` 服务；项目 README 仍标注 active development、尚无稳定发布，许可证为 AGPL-3.0-or-later。[部署文档](https://github.com/mCaptcha/mCaptcha/blob/b215a411ed3e53e3c5d77465f73b40d35986ec93/docs/DEPLOYMENT.md) [Compose](https://github.com/mCaptcha/mCaptcha/blob/b215a411ed3e53e3c5d77465f73b40d35986ec93/docker-compose.yml) [许可证](https://github.com/mCaptcha/mCaptcha/blob/b215a411ed3e53e3c5d77465f73b40d35986ec93/LICENSE.md)

SS ERP 已有 Node + Redis 的一次性 PoW，迁移到 mCaptcha 不会获得行为风控，却会增加数据库、升级、监控、备份和 AGPL 合规工作，因此不推荐。

## 托管方案

### 海外：Turnstile + Cloudflare 边界

Turnstile 必须由服务端调用 Siteverify；官方 token 5 分钟有效且只能验证一次，并建议额外核对返回的 action 和 hostname。当前 SS ERP provider 已经核对 action，并支持 hostname 白名单，生产必须填入明确域名而不是留空。[Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) [hostname 管理](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)

Cloudflare Free 的 WAF custom rules 可按路径/属性执行 Managed Challenge，目前官方列出 Free 可用 5 条；这适合保护异常来源和高风险路径。不要把免费 Bot Fight Mode 当精细接口策略：官方明确说它保护整个域名、不能按 endpoint 调整，且可能 challenge API/移动端流量。[WAF custom rules](https://developers.cloudflare.com/waf/custom-rules/) [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/free/)

Cloudflare 代理只有在源站不可绕过时才有效。官方建议源站只允许 Cloudflare IP，并可开启 Authenticated Origin Pulls；否则已知源站 IP 可以绕过全部 WAF。[源站 IP 限制](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/) [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)

Cloudflare 官方的中国网络产品表明确注明 Turnstile 不在中国大陆提供，因此不能作为国内认证链路的可用性依赖。[中国网络可用产品](https://developers.cloudflare.com/china-network/reference/available-products/)

### 国内：阿里云验证码 2.0

阿里云官方将账号注册和短信发送列为典型用途，支持无痕、一点即过、滑块、拼图和图像复原，并要求客户端生成参数、业务服务端调用 `VerifyIntelligentCaptcha`。服务端应写入预期 `SceneId`，官方特别建议多场景时这样做以防前端篡改；重复数据会返回 F008，V3 重用返回 F018。[产品说明](https://help.aliyun.com/zh/captcha/captcha2-0/product-overview/what-is-alibaba-cloud-captcha-2) [服务端接入](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/server-integration)

按量价格当前为中国内地 0.005 元/次、境外 0.007 元/次；前三个场景免费，第 4 个起 5 元/场景/天；开启自定义策略另收 30 元/天。可以先映射为三个场景：公共短信发送、用户登录、管理员登录，仍在免费场景数内。费用熔断仍需由 SS ERP 自己执行，因为验证码费用和短信费用是两套账。[计费说明](https://help.aliyun.com/zh/captcha/captcha2-0/product-overview/billing)

上海 ECS 可调用官方 VPC endpoint，且文档支持 Credentials/STS。实现时应复用实例 RAM 角色或最小权限凭据，不保存主账号 AccessKey；所有网络错误应 fail closed，同时提供可观测的管理员状态和受控回退到 `builtin-pow`。

## 推荐落地顺序

1. 立即完成并启用手机号/IP 日配额、全局短信费用熔断、Turnstile hostname 白名单；这三项与选择哪种 CAPTCHA 无关。
   费用熔断应按提交给短信供应商的尝试计数；网络超时可能已经被供应商接受，不能因为本地结果不确定而退还额度。
2. 国内启用 `builtin-pow`，海外保留 Turnstile；记录挑战失败率、短信发送率、按 IP/手机号拒绝数和熔断次数。
3. 国内出现持续攻击或 PoW 对正常用户设备影响明显时，再接入 `aliyun-captcha` provider；保留 PoW 作为显式回退，不自动静默降级为 disabled。
4. 海外 Cloudflare 代理后配置少量路径化 WAF/限流规则，并封闭源站直连；不要对整个 API 打开不可配置的 Bot Fight Mode。
5. 只有观测到 WAF 能解决的 L7 攻击或扫描压力后，才启动国内免费 WAF PoC：需要中文 GUI 时在独立边缘机评估 aaWAF；希望保持当前代理跳数时评估 ModSecurity + CRS。先使用观察模式和流量回放，验证浏览器、XHR、CORS、文件上传、WebSocket/SSE、健康检查、ACME、回源 IP、失败旁路、延迟和资源占用。同步审计出站 DNS/HTTP 并采用默认拒绝策略；用模拟敏感字段验证日志、告警和管理后台不会保存 Authorization、Cookie、密码、验证码或请求体，明确脱敏、访问控制、留存、删除、TLS 私钥权限和备份边界。
6. aaWAF PoC 还必须将管理面限制为私网、VPN 或管理 IP，立即轮换初始凭据；若目标发行版提供 MFA、签名制品或可验证 checksum，必须启用并核验。若不提供，则使用上游身份代理/VPN，并从固定源码构建、在自有镜像仓库签名后部署；无论哪种路径，都要记录 SBOM 以及部署制品与已审查源码/许可证的对应关系。
7. 只有在完成商业授权、隐私和数据采集评审后，才对雷池做隔离环境 PoC。无论选择哪种 WAF，PoC 成功也只代表可增加边界纵深，不能替换应用挑战和短信预算控制。

## 国内免费 WAF 补充（2026-07-23）

### 官方材料显示可商用、仍需按制品复核的候选

- **堡塔云 WAF / aaWAF**：截至 2026-07-23，官方产品页标注“真开源免费可商用”，免费版价格为 0；官方仓库采用 AGPL-3.0，堡塔开源协议也说明允许以自用为目的用于盈利或非盈利项目，并称免费功能部署后可不依赖堡塔云端永久运行。该证据只覆盖公开页面和已审查源码，不能自动覆盖具体安装脚本、容器镜像、规则库、付费插件和第三方依赖；商业 PoC 前仍需按实际制品核对许可证/SBOM并保留厂商或法务结论。免费版提供基础 Web 攻击防护、基础/单 URL CC 防护和按规则触发的人机验证，适合先在独立边缘机验证。[官方产品页](https://www.bt.cn/new/aawaf.html) [当前仓库](https://github.com/aaPanel/aaWAF) [复核源码快照](https://github.com/aaPanel/aaWAF/tree/d6d343076c650c45b7f24197387786fa1743dec1) [AGPL-3.0 快照](https://github.com/aaPanel/aaWAF/blob/d6d343076c650c45b7f24197387786fa1743dec1/LICENSE) [堡塔开源协议](https://www.bt.cn/new/agreement_open.html)
- **ModSecurity v3 + OWASP CRS**：三个项目的复核快照均采用 Apache-2.0，可通过与生产 Nginx ABI 兼容的 Connector/动态模块集成，但不能预设现有发行包无需替换或重编译。PoC 必须记录 `nginx -V`、`--with-compat`、模块 ABI、升级路径和回滚包，并从 `DetectionOnly` 开始调优 CRS 误报；它没有管理后台或内置交互式验证码，CC 仍需 Nginx 限速或应用配额处理。[ModSecurity 快照](https://github.com/owasp-modsecurity/ModSecurity/tree/7ea9fefbe0ba409d8733b4d682c8c4c059cd028d) [ModSecurity 许可证](https://github.com/owasp-modsecurity/ModSecurity/blob/7ea9fefbe0ba409d8733b4d682c8c4c059cd028d/LICENSE) [Nginx Connector 快照](https://github.com/owasp-modsecurity/ModSecurity-nginx/tree/9eb44fd9ab0988756e1ab8ce5aa5548ddbe57846) [Connector 许可证](https://github.com/owasp-modsecurity/ModSecurity-nginx/blob/9eb44fd9ab0988756e1ab8ce5aa5548ddbe57846/LICENSE) [OWASP CRS 快照](https://github.com/coreruleset/coreruleset/tree/d59fba49e0a59d69e7ff4eec0a2a3ac2ddaadaf9) [CRS 许可证](https://github.com/coreruleset/coreruleset/blob/d59fba49e0a59d69e7ff4eec0a2a3ac2ddaadaf9/LICENSE) [推荐配置快照](https://github.com/owasp-modsecurity/ModSecurity/blob/7ea9fefbe0ba409d8733b4d682c8c4c059cd028d/modsecurity.conf-recommended)
- **Coraza + OWASP CRS**：Coraza 为 Apache-2.0 的 Go WAF 引擎，官方声明兼容 CRS v4。官方维护的 Caddy 集成稳定，Proxy-WASM 可用于 Envoy/Istio，但面向 Nginx 的 `libcoraza` 仍被官方列为 experimental，因此不如 ModSecurity 适合当前 Nginx 拓扑。[Coraza 快照](https://github.com/corazawaf/coraza/tree/85a896868480a52ae5f8ebe3fcab1a2895dd1d9f) [Coraza 许可证](https://github.com/corazawaf/coraza/blob/85a896868480a52ae5f8ebe3fcab1a2895dd1d9f/LICENSE) [Caddy 集成快照](https://github.com/corazawaf/coraza-caddy/tree/82f09c076b75f0096b8c9ebc58e1ce53e2947198) [Proxy-WASM 快照](https://github.com/corazawaf/coraza-proxy-wasm/tree/b0c1b024854049ffd5e8cc63a869bbb6de153b71) [libcoraza 快照](https://github.com/corazawaf/libcoraza/tree/e4e338f867e4db23e9b6cd3747fc45421945bb10)

### 许可存在冲突的候选

- **南墙 uuWAF**：复核源码快照的根许可证为 BSD-2-Clause，项目也提供 WAF、CC 和滑动旋转验证码；但同一快照随发行文档提供的产品许可证明确限制为单设备、个人非商业用途，并禁止修改和分发。商业 ERP 不能只依据根许可证上线包含预编译镜像的发行产品，必须先获得厂商书面授权。[当前仓库](https://github.com/Safe3/uusec-waf) [复核源码快照](https://github.com/Safe3/uusec-waf/tree/9ec915d2ae911632b77ea5243895353ada3ada9f) [根许可证快照](https://github.com/Safe3/uusec-waf/blob/9ec915d2ae911632b77ea5243895353ada3ada9f/LICENSE) [发行产品许可证快照](https://github.com/Safe3/uusec-waf/blob/9ec915d2ae911632b77ea5243895353ada3ada9f/docs/zh-cn/LICENSE.md) [官方文档](https://waf.uusec.com/#/zh-cn/guide/)

### 托管免费层结论

以下是 2026-07-23 对无需登录的公开页面所做的证据快照：阿里云和腾讯云引用中国站、中国大陆产品与人民币价格，EdgeOne Free 引用国际站美元计划并与腾讯云中国站交叉核对；未进入目标账号控制台，也没有取得合同、SLA 或账号专属权益。它适合产品筛选，不构成采购报价或长期权益保证。

- **阿里云 WAF / 腾讯云 WAF**：未核验到可长期免费的正式 WAF 套餐。阿里云 WAF 官方列出的计费方式为包年包月和按量付费；阿里云免费中心明确说明试用是一次性、限时或限额且不能延期。腾讯云中国大陆 WAF 官方计费页要求购买实例套餐，2026-07-16 页面列出的 SaaS 型和云原生型高级版均为 3,880 元/月起。[阿里云 WAF 计费](https://help.aliyun.com/zh/waf/web-application-firewall-3-0/billing-methods/) [阿里云免费试用规则](https://free.aliyun.com/) [腾讯云 WAF 中国大陆计费](https://cloud.tencent.com/document/product/627/11730)
- **Tencent EdgeOne Free**：国际站定价页确实承诺 `$0/月`、永久免费，并列出基础 WAF、基础 CC 和平台 DDoS 防护；但领取页同时注明 Free Plan 仍处于 limited beta，并通过活动领取。其“China Access”宣传没有给出大陆节点、ICP备案、SLA 和长期大陆权益的明确合同；腾讯云中国站产品页没有免费档，且把“中国大陆网络优化”列为企业版能力。因此，目前只能确认国际站 Free 计划存在，**不能确认它可作为中国大陆生产站点的长期免费 WAF/加速承诺**。[国际站定价](https://edgeone.ai/pricing) [Free Plan 领取规则](https://edgeone.ai/get-free-plan) [腾讯云中国站 EdgeOne](https://cloud.tencent.com/product/teo) [中国加速与合规说明](https://edgeone.ai/solutions/global-to-china)

以上自托管方案都只能处理已经到达服务器的 HTTP(S)/CC 流量，无法吸收打满公网链路的体积型 DDoS；而 WAF 的浏览器挑战也不能替代 SS ERP 绑定业务 action 的应用级人机挑战、手机号/IP 配额和全局短信费用熔断。若增加堡塔、ModSecurity 或其他代理层，还必须同步重做当前 `trustProxy: 1` 的真实 IP 信任链并封闭源站直连。
