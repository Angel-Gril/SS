'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Store, ShoppingCart, Truck, BarChart3, Image as ImageIcon, Shield } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-lg font-bold text-primary-foreground">SS</span>
            </div>
            <span className="font-semibold">松鼠跨境 ERP</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login"><Button variant="ghost">登录</Button></Link>
            <Link href="/register"><Button>免费注册</Button></Link>
          </div>
        </div>
      </header>

      <section className="container mx-auto px-4 py-16 lg:py-24">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h1 className="text-4xl lg:text-6xl font-bold tracking-tight">
            专为 OZON 卖家打造的<br />跨境电商 ERP 系统
          </h1>
          <p className="text-lg lg:text-xl text-muted-foreground">
            从店铺管理、订单同步、商品上架，到仓储物流、财务对账，一站式管理你的跨境业务。
          </p>
          <div className="flex items-center justify-center gap-3 pt-4">
            <Link href="/register"><Button size="lg">免费开始使用</Button></Link>
            <Link href="/login"><Button size="lg" variant="outline">已有账号</Button></Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16 border-t">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold">核心功能</h2>
          <p className="text-muted-foreground mt-2">围绕 OZON 卖家全流程的工具集</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
          <Feature icon={Store} title="多店铺管理" desc="一个账号管理多个 OZON 店铺，子账号权限分级" />
          <Feature icon={ShoppingCart} title="订单同步" desc="自动拉取 OZON 订单，支持批量打单和发货跟踪" />
          <Feature icon={ImageIcon} title="商品采集与上架" desc="浏览器扩展采集 1688/淘宝/拼多多，一键上架 OZON" />
          <Feature icon={Truck} title="仓储物流" desc="扫码出库、仓库指令、第三方代理对接" />
          <Feature icon={BarChart3} title="财务对账" desc="OZON 账单同步、成本快照、月度利润统计" />
          <Feature icon={Shield} title="安全可靠" desc="数据加密、操作审计、Cloudflare 安全防护" />
        </div>
      </section>

      <section className="container mx-auto px-4 py-16 border-t">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h2 className="text-3xl font-bold">现在就开始</h2>
          <p className="text-muted-foreground">注册即可免费试用，无需信用卡</p>
          <Link href="/register"><Button size="lg">免费注册</Button></Link>
        </div>
      </section>

      <footer className="border-t mt-16">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          © 2026 松鼠跨境 ERP · <Link href="/terms" className="hover:text-foreground">服务协议</Link> · <Link href="/privacy" className="hover:text-foreground">隐私政策</Link>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-3">
      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
