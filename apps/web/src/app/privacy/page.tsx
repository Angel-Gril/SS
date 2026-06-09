export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2 border-b pb-6">
          <p className="text-sm text-muted-foreground">生效日期：2026-06-08</p>
          <h1 className="text-3xl font-semibold tracking-normal">隐私政策</h1>
          <p className="text-sm text-muted-foreground">
            本政策说明松鼠跨境 ERP 如何收集、使用、存储和保护您的个人信息及业务数据。
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. 我们收集的信息</h2>
          <p>
            为提供 ERP 服务，我们可能收集手机号、昵称、登录记录、设备和浏览器信息、店铺授权信息、
            商品资料、订单、物流、库存、图片、财务统计和您主动提交的配置数据。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. 信息使用目的</h2>
          <p>
            我们使用相关信息用于账号注册与登录、身份验证、商品采集、订单同步、上架辅助、图片处理、
            费用结算、客户支持、安全风控、故障排查和产品体验改进。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. 存储与保护</h2>
          <p>
            我们采用访问控制、加密存储、日志审计、备份和权限隔离等措施保护数据安全。店铺 API 密钥、
            对象存储密钥和扩展 Token 等敏感信息仅在服务端必要范围内使用。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. 信息共享</h2>
          <p>
            除获得您的授权、履行法律义务、维护系统安全或接入必要第三方服务外，我们不会向无关第三方
            出售或披露您的个人信息和业务数据。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. 第三方服务</h2>
          <p>
            本服务可能接入短信服务商、对象存储、错误监控、云基础设施和电商平台接口。第三方服务会按照
            其自身政策处理其接收的信息，我们会尽量选择具备合理安全能力的服务商。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. 您的权利</h2>
          <p>
            您可以在产品中查看、修改部分账号资料和业务数据，也可以联系我们请求更正、删除或导出相关数据。
            在删除账号或数据前，我们可能需要进行身份核验并保留法律要求的必要记录。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. 政策更新</h2>
          <p>
            我们可能根据业务和合规要求更新本政策。重大变更会通过站内公告、页面提示或其他合理方式通知。
            您继续使用服务即表示接受更新后的政策。
          </p>
        </section>
      </article>
    </main>
  );
}
