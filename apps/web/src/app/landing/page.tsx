'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Store,
  ShoppingCart,
  Truck,
  BarChart3,
  Image as ImageIcon,
  Shield,
  Package,
  Users,
  Database,
  CheckCircle2,
  ArrowRight,
  Download,
  Link2,
  Monitor,
  Cloud,
  Server,
} from 'lucide-react';

const appHostname = process.env.NEXT_PUBLIC_USER_HOSTNAME
  || (process.env.NEXT_PUBLIC_RUNTIME_MODE === 'cloud' ? 'app.ss-erp.com' : '');
const appOrigin = appHostname ? `https://${appHostname}` : '';
const loginHref = `${appOrigin}/login`;
const registerHref = `${appOrigin}/register`;
const downloadHref = appOrigin ? `${appOrigin}/download` : '/download';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <span className="text-lg font-bold text-primary-foreground">SS</span>
            </div>
            <span className="text-lg font-semibold">松鼠跨境 ERP</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href={downloadHref}><Button variant="ghost">扩展下载</Button></Link>
            <Link href={loginHref}><Button variant="ghost">登录系统</Button></Link>
            <Link href={registerHref}><Button>申请试用</Button></Link>
          </div>
        </div>
      </header>

      <section className="container mx-auto px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-4xl space-y-6 text-center">
          <div className="mb-4 inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            为 OZON 跨境卖家设计
          </div>
          <h1 className="text-4xl font-bold tracking-tight lg:text-6xl">
            从手工表格到系统化运营<br />
            <span className="text-primary">一站式 ERP 工作台</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground lg:text-xl">
            商品采集、图片处理、上架、订单同步、物流处理、财务统计，集中在一个系统里完成。
            适合从手工表格迁移到系统化运营的中小团队。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-6">
            <Link href={registerHref}><Button size="lg" className="h-12 px-8">申请试用</Button></Link>
            <Link href={loginHref}><Button size="lg" variant="outline" className="h-12 px-8">登录 ERP</Button></Link>
            <Link href={downloadHref}>
              <Button size="lg" variant="ghost" className="h-12 px-8 gap-2">
                <Download className="h-4 w-4" />
                下载扩展
              </Button>
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <DashboardPreview />
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="container mx-auto grid gap-10 px-4 py-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <h2 className="mb-3 text-3xl font-bold">浏览器扩展 + ERP 后台联动</h2>
            <p className="text-muted-foreground">
              扩展负责读取当前浏览器里的 OZON/1688 页面数据，ERP 负责保存、处理图片、上架和团队权限。
              新版支持在 ERP 页面一键写入扩展连接配置，减少手动复制 Token。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={downloadHref}>
                <Button className="gap-2">
                  <Download className="h-4 w-4" />
                  获取扩展
                </Button>
              </Link>
              <Link href={loginHref}>
                <Button variant="outline" className="gap-2">
                  登录后连接
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <FlowStep icon={Monitor} title="打开商品页" desc="扩展在 OZON/1688 页面采集商品、图片和分析字段。" />
            <FlowStep icon={Link2} title="连接 ERP" desc="ERP 生成 30 天 Token，一键写入扩展本地配置。" />
            <FlowStep icon={Package} title="进入上品流程" desc="采集数据进入 ERP，继续水印、翻译、定价和上架。" />
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="container mx-auto px-4 py-16">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold">手工管理的痛点</h2>
            <p className="text-muted-foreground">你是否也遇到这些问题？</p>
          </div>
          <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-4">
            <PainPoint title="表格管理混乱" desc="多个 Excel 文件分散，找数据费时费力" />
            <PainPoint title="多店铺订单处理慢" desc="手动切换店铺后台，订单处理效率低" />
            <PainPoint title="图片处理重复劳动" desc="每次上架都要手动打水印、压缩、上传" />
            <PainPoint title="财务对账分散" desc="物流单号、仓库、OZON 账单分散在不同地方" />
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold">核心能力</h2>
          <p className="text-muted-foreground">围绕 OZON 卖家全流程的工具集</p>
        </div>
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 lg:grid-cols-3">
          <Feature icon={Package} title="商品采集与上架" desc="浏览器扩展采集 1688/淘宝/拼多多商品，自动提取标题、属性、图片。支持批量打水印、一键上架 OZON。" />
          <Feature icon={ImageIcon} title="图片水印与存储" desc="内置水印模板，支持 R2/OSS/本地存储。图片自动压缩、格式转换，减少存储成本。" />
          <Feature icon={Store} title="OZON 店铺同步" desc="多店铺统一管理，自动同步商品、订单、库存。支持子账号权限分级。" />
          <Feature icon={ShoppingCart} title="订单与物流处理" desc="订单自动拉取，批量打单、发货跟踪。支持扫码出库、仓库作业和第三方代理对接。" />
          <Feature icon={BarChart3} title="财务与利润统计" desc="OZON 账单同步、成本快照、月度利润统计。支持多币种汇率、费用模板。" />
          <Feature icon={Users} title="团队协作与权限" desc="子账号管理、角色权限、操作审计。适合多人协作的中小团队。" />
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="container mx-auto px-4 py-16">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold">部署方式</h2>
            <p className="text-muted-foreground">云端 SaaS 或本地私有化部署</p>
          </div>
          <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2">
            <DeploymentOption icon={Cloud} title="云端 SaaS" features={['无需安装，注册即用', 'Cloudflare 全球加速', 'R2 对象存储与自动备份', '按需付费，灵活扩展']} cta="申请试用" ctaLink={registerHref} />
            <DeploymentOption icon={Server} title="本地离线版" features={['数据完全自主可控', '支持内网部署', '无需短信/OSS/云验证', '适合老电脑的解压运行路线']} cta="查看本地版" ctaLink={downloadHref} variant="outline" />
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold">安全与稳定</h2>
          <p className="text-muted-foreground">企业级安全防护</p>
        </div>
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-4">
          <SecurityFeature icon={Shield} title="Cloudflare 防护" />
          <SecurityFeature icon={Database} title="R2 对象存储" />
          <SecurityFeature icon={CheckCircle2} title="数据备份" />
          <SecurityFeature icon={Truck} title="物流链路跟踪" />
        </div>
      </section>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium">OZON 运营工作台</span>
        </div>
        <div className="hidden gap-2 text-xs text-muted-foreground md:flex">
          <span>订单</span>
          <span>商品</span>
          <span>采集</span>
          <span>财务</span>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[180px_1fr]">
        <aside className="hidden border-r bg-muted/20 p-4 lg:block">
          {['今日订单', '采集商品', '图片处理', '上架任务', '利润统计'].map((item, index) => (
            <div key={item} className={`mb-2 rounded-md px-3 py-2 text-sm ${index === 1 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              {item}
            </div>
          ))}
        </aside>
        <div className="p-4 md:p-6">
          <div className="mb-5 grid gap-3 md:grid-cols-4">
            <Metric label="待处理订单" value="128" />
            <Metric label="今日采集" value="642" />
            <Metric label="待上架" value="86" />
            <Metric label="R2 上传" value="正常" />
          </div>
          <div className="overflow-hidden rounded-md border">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr] bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>商品</span>
              <span>状态</span>
              <span>价格</span>
              <span>操作</span>
            </div>
            {[
              ['便携收纳包 多变体', '已采集', '¥50.16', '处理图片'],
              ['厨房置物架', '待翻译', '¥34.80', '生成标题'],
              ['儿童画笔套装', '待上架', '¥18.90', '发布 OZON'],
            ].map((row) => (
              <div key={row[0]} className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr] border-t px-3 py-3 text-sm">
                <span className="truncate font-medium">{row[0]}</span>
                <span className="text-muted-foreground">{row[1]}</span>
                <span>{row[2]}</span>
                <span className="truncate text-primary">{row[3]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function PainPoint({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-6">
      <div className="font-semibold text-destructive">{title}</div>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function FlowStep({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-background p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="mb-1 font-semibold">{title}</div>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="mb-2 text-lg font-semibold">{title}</div>
        <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function DeploymentOption({
  icon: Icon,
  title,
  features,
  cta,
  ctaLink,
  variant = 'default',
}: {
  icon: React.ElementType;
  title: string;
  features: string[];
  cta: string;
  ctaLink: string;
  variant?: 'default' | 'outline';
}) {
  return (
    <div className="space-y-6 rounded-lg border bg-card p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h3 className="text-2xl font-bold">{title}</h3>
      </div>
      <ul className="space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
            <span className="text-sm text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>
      <Link href={ctaLink}>
        <Button variant={variant} className="w-full" size="lg">{cta}</Button>
      </Link>
    </div>
  );
}

function SecurityFeature({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex flex-col items-center space-y-3 rounded-lg border bg-card p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <div className="font-medium">{title}</div>
    </div>
  );
}
