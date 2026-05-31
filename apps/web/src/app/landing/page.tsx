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
} from 'lucide-react';

const appOrigin = process.env.NEXT_PUBLIC_USER_HOSTNAME
  ? `https://${process.env.NEXT_PUBLIC_USER_HOSTNAME}`
  : '';
const loginHref = `${appOrigin}/login`;
const registerHref = `${appOrigin}/register`;

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
          <div className="flex items-center justify-center gap-4 pt-6">
            <Link href={registerHref}><Button size="lg" className="h-12 px-8">申请试用</Button></Link>
            <Link href={loginHref}><Button size="lg" variant="outline" className="h-12 px-8">登录 ERP</Button></Link>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <div className="flex aspect-video items-center justify-center rounded-lg border bg-muted/50">
            <div className="space-y-2 text-center">
              <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">ERP 工作台截图</p>
            </div>
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
          <Feature icon={ShoppingCart} title="订单与物流处理" desc="订单自动拉取，批量打单、发货跟踪。支持扫码出库、仓库指令、第三方代理对接。" />
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
            <DeploymentOption title="云端 SaaS" features={['无需安装，注册即用', 'Cloudflare 全球加速', '自动备份与更新', '按需付费，灵活扩展']} cta="申请试用" ctaLink={registerHref} />
            <DeploymentOption title="本地离线版" features={['数据完全自主可控', '支持内网部署', '一次性买断授权', '提供技术支持']} cta="联系部署" ctaLink={registerHref} variant="outline" />
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

function PainPoint({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-6">
      <div className="font-semibold text-destructive">{title}</div>
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
  title,
  features,
  cta,
  ctaLink,
  variant = 'default',
}: {
  title: string;
  features: string[];
  cta: string;
  ctaLink: string;
  variant?: 'default' | 'outline';
}) {
  return (
    <div className="space-y-6 rounded-lg border bg-card p-8">
      <h3 className="text-2xl font-bold">{title}</h3>
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
