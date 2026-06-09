export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2 border-b pb-6">
          <p className="text-sm text-muted-foreground">生效日期：2026-06-08</p>
          <h1 className="text-3xl font-semibold tracking-normal">用户服务协议</h1>
          <p className="text-sm text-muted-foreground">
            本协议适用于您注册、登录和使用松鼠跨境 ERP 提供的跨境电商 ERP 服务。
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. 服务内容</h2>
          <p>
            松鼠跨境 ERP 为跨境卖家提供商品采集、图片处理、上架辅助、订单同步、物流处理、财务统计、
            供应链协作和相关运营管理工具。具体功能以实际开放的产品界面和接口为准。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. 账号与安全</h2>
          <p>
            您应使用真实、准确的手机号注册账号，并妥善保管登录凭证、验证码、扩展 Token 和店铺 API
            密钥。因您主动泄露、共享账号或未及时修改密码造成的损失，由您自行承担。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. 合规使用</h2>
          <p>
            您承诺遵守适用法律法规、平台规则和第三方服务条款，不利用本服务从事侵权、欺诈、刷单、
            爬取受限数据、绕过平台风控或其他违法违规行为。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. 数据与第三方平台</h2>
          <p>
            您授权本服务在必要范围内处理您提交或同步的店铺、商品、订单、物流、图片和财务数据。
            第三方平台接口、页面结构或政策变化可能影响部分功能可用性，本服务会尽合理努力维护兼容性。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. 费用与服务变更</h2>
          <p>
            付费功能、计费方式、余额消耗和退款规则以产品页面或双方确认的订单为准。我们可根据业务需要
            调整、暂停或下线部分功能，并尽量提前通过站内公告或其他方式通知。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. 责任限制</h2>
          <p>
            在法律允许范围内，本服务不对因第三方平台故障、网络中断、用户配置错误、不可抗力或非本服务
            可控原因造成的间接损失、利润损失、数据延迟或业务中断承担责任。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. 协议更新</h2>
          <p>
            我们可能根据产品和合规要求更新本协议。重大变更会通过站内公告、页面提示或其他合理方式通知。
            您继续使用服务即表示接受更新后的协议。
          </p>
        </section>
      </article>
    </main>
  );
}
