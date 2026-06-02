import Link from 'next/link';
import { ArrowLeft, Cable, CheckCircle2, Download, Key, Package, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const appOrigin = process.env.NEXT_PUBLIC_USER_HOSTNAME
  ? `https://${process.env.NEXT_PUBLIC_USER_HOSTNAME}`
  : '';
const loginHref = `${appOrigin}/login`;
const registerHref = `${appOrigin}/register`;

export default function DownloadPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回官网
          </Link>
          <div className="flex items-center gap-3">
            <Link href={loginHref}><Button variant="ghost">登录 ERP</Button></Link>
            <Link href={registerHref}><Button>申请试用</Button></Link>
          </div>
        </div>
      </header>

      <section className="container mx-auto px-4 py-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10">
            <Package className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">SS ERP 浏览器扩展</h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            扩展用于读取当前浏览器页面里的 OZON/1688 商品数据，并把采集结果推送到你的 ERP 账号。
            云端版和本地版使用不同连接地址，但绑定流程一致。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={loginHref}>
              <Button size="lg" className="gap-2">
                <Cable className="h-4 w-4" />
                登录后一键连接
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="gap-2" disabled>
              <Download className="h-4 w-4" />
              扩展包待发布
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
          <StepCard
            icon={Download}
            title="1. 安装扩展"
            desc="测试阶段使用开发者模式加载扩展包；正式上架 Chrome Web Store 后改为商店安装入口。"
          />
          <StepCard
            icon={Key}
            title="2. ERP 生成 Token"
            desc="登录 ERP 后点击顶部“扩展连接”，生成 30 天有效 Token。Token 只用于写入当前 ERP 账号。"
          />
          <StepCard
            icon={Cable}
            title="3. 一键连接"
            desc="点击“一键连接”后，ERP 地址和 Token 会写入扩展本地存储；失败时仍可手动复制。"
          />
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="container mx-auto grid gap-8 px-4 py-14 lg:grid-cols-2">
          <ModeCard
            title="云端 SaaS 扩展"
            items={[
              '默认连接 app.ss-erp.com 的 API',
              '支持 R2/OSS 图片上传和云端队列',
              '适合多电脑、多账号团队协作',
            ]}
          />
          <ModeCard
            title="本地 Windows 扩展"
            items={[
              '默认连接 http://127.0.0.1:3001',
              '使用本地图存储，不依赖 R2/短信/Turnstile',
              '适合离线测试和单机便携版',
            ]}
          />
        </div>
      </section>

      <section className="container mx-auto px-4 py-14">
        <div className="mx-auto max-w-4xl rounded-lg border bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">更新策略</h2>
          </div>
          <div className="grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
            <p>
              公告系统只用于下发版本提醒、更新说明、文案和功能开关，不下发远程 JS 逻辑。
              这样符合 Chrome MV3 对远程托管代码的限制。
            </p>
            <p>
              扩展功能升级仍通过重新打包发布完成。测试阶段可以使用开发者模式重新加载；
              正式阶段优先使用 Chrome Web Store 或明确的安装包下载入口。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function StepCard({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function ModeCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border bg-background p-6">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
