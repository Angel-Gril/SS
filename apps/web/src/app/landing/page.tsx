import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Database,
  Image as ImageIcon,
  Layers3,
  Package,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: '松鼠跨境 ERP - OZON 跨境卖家工作台',
  description: '面向 OZON 跨境卖家的 ERP 系统，覆盖商品采集、图片处理、上架、订单同步、物流、财务和团队协作。',
  openGraph: {
    title: '松鼠跨境 ERP',
    description: '从商品采集到订单履约，把 OZON 跨境运营集中到一个工作台。',
    type: 'website',
    locale: 'zh_CN',
  },
};

const userOrigin = process.env.NEXT_PUBLIC_USER_HOSTNAME
  ? `https://${process.env.NEXT_PUBLIC_USER_HOSTNAME}`
  : '';
const loginHref = `${userOrigin}/login`;
const registerHref = `${userOrigin}/register`;

const workflow = [
  { label: '采集商品', value: '1,248', tone: 'text-emerald-600' },
  { label: '待处理订单', value: '86', tone: 'text-amber-600' },
  { label: '今日利润', value: '¥12,430', tone: 'text-sky-600' },
];

const features = [
  {
    icon: Package,
    title: '商品采集与上架',
    text: '浏览器扩展从 OZON 和供应链页面采集商品、图片、属性和价格，沉淀到商品池后批量处理。',
  },
  {
    icon: ImageIcon,
    title: '图片处理与对象存储',
    text: '水印、压缩、格式转换和 R2/OSS 存储统一配置，避免图片链路散落在本地文件夹里。',
  },
  {
    icon: ShoppingCart,
    title: '订单同步与履约',
    text: '多店铺订单集中处理，支持物流跟踪、扫码出入库、打印代理和仓库指令协作。',
  },
  {
    icon: BarChart3,
    title: '财务与利润统计',
    text: '保留成本快照、汇率、佣金、物流费用和订单收入，按月统计利润和异常成本。',
  },
  {
    icon: Users,
    title: '账号与团队协作',
    text: '根账号、子账号、供应商、服务标签和操作审计放在同一权限体系里管理。',
  },
  {
    icon: ShieldCheck,
    title: '上线运维基础',
    text: '健康检查、配置中心、备份脚本、扩展包校验和本地 Windows 包路线已经纳入工程流程。',
  },
];

const comparison = [
  ['商品数据', '表格复制、图片散落', '扩展采集，商品池统一处理'],
  ['订单处理', '多后台切换，人工对账', '同步订单、物流、财务口径'],
  ['图片链路', '本地文件夹和手工水印', '水印模板、压缩、对象存储'],
  ['团队协作', '账号共用、权限不清', '子账号、供应商、审计日志'],
];

const workflowSteps: Array<[string, string, LucideIcon]> = [
  ['01', '采集', Package],
  ['02', '处理图片', ImageIcon],
  ['03', '上架', Layers3],
  ['04', '履约统计', Truck],
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#fbfaf8] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#fbfaf8]/90 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-sm font-bold text-white">
              SS
            </span>
            <span className="font-semibold">松鼠跨境 ERP</span>
          </Link>
          <div className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
            <a href="#workflow" className="hover:text-slate-950">流程</a>
            <a href="#features" className="hover:text-slate-950">功能</a>
            <a href="#security" className="hover:text-slate-950">部署</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href={loginHref}>
              <Button variant="ghost" className="h-9 px-3">登录</Button>
            </Link>
            <Link href={registerHref}>
              <Button className="h-9 px-4">注册试用</Button>
            </Link>
          </div>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-20 lg:pt-16">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm">
            <Store className="h-4 w-4 text-primary" />
            为 OZON 跨境卖家设计
          </div>
          <div className="space-y-5">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
              松鼠跨境 ERP
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-600">
              从商品采集、图片处理、上架到订单履约，把跨境运营团队每天反复处理的表格和后台切换，收进一个可维护的工作台。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={registerHref}>
              <Button size="lg" className="h-12 w-full gap-2 px-6 sm:w-auto">
                注册试用 <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href={loginHref}>
              <Button size="lg" variant="outline" className="h-12 w-full border-slate-300 bg-white px-6 sm:w-auto">
                登录 ERP
              </Button>
            </Link>
          </div>
          <div className="grid max-w-xl grid-cols-3 gap-3 pt-2">
            {workflow.map((item) => (
              <div key={item.label} className="border-l border-slate-200 pl-4">
                <div className={`text-xl font-semibold ${item.tone}`}>{item.value}</div>
                <div className="mt-1 text-xs text-slate-500">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <ErpPreview />
      </section>

      <section id="workflow" className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-normal">把运营动作串成一条线</h2>
            <p className="text-slate-600">
              商品、图片、订单、物流和财务不再分散在不同文件里，关键数据沿着实际履约流程流动。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {workflowSteps.map(([num, label, Icon]) => (
              <div key={String(label)} className="rounded-md border border-slate-200 bg-[#fbfaf8] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">{String(num)}</span>
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="mt-8 font-medium">{String(label)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-normal">核心能力</h2>
            <p className="max-w-2xl text-slate-600">围绕 OZON 卖家从选品到履约的日常工作，优先解决高频、重复、容易出错的环节。</p>
          </div>
          <Link href={registerHref} className="text-sm font-medium text-primary hover:underline">
            开始配置店铺
          </Link>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <article key={title} className="bg-white p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-slate-950 text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="space-y-4">
              <h2 className="text-3xl font-semibold tracking-normal">从表格迁移到系统</h2>
              <p className="text-slate-300">
                不是再做一个看板，而是把重复操作、口径不一致和多人协作的问题收敛到稳定流程里。
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <div className="grid grid-cols-3 bg-white/5 px-4 py-3 text-sm text-slate-300">
                <span>环节</span>
                <span>手工方式</span>
                <span>松鼠跨境 ERP</span>
              </div>
              {comparison.map(([area, manual, erp]) => (
                <div key={area} className="grid grid-cols-3 border-t border-white/10 px-4 py-4 text-sm">
                  <span className="font-medium text-white">{area}</span>
                  <span className="text-slate-400">{manual}</span>
                  <span className="text-slate-200">{erp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-normal">部署和安全边界清楚</h2>
            <p className="text-slate-600">云端 SaaS 与 Windows 本地版分别推进，不把密钥和数据链路混在浏览器里。</p>
          </div>
          {[
            ['云端 SaaS', '单 VPS 起步，支持 PostgreSQL、Redis、R2/OSS、Nginx 和 Cloudflare。'],
            ['本地 Windows 版', 'Portable 与 runtime-assisted 两条打包路线，适合离线或内网使用。'],
          ].map(([title, text]) => (
            <div key={title} className="rounded-lg border border-slate-200 bg-white p-6">
              <Database className="h-6 w-6 text-primary" />
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <span>© 2026 松鼠跨境 ERP</span>
          <div className="flex gap-5">
            <Link href="/terms" className="hover:text-slate-950">用户服务协议</Link>
            <Link href="/privacy" className="hover:text-slate-950">隐私政策</Link>
            <Link href={loginHref} className="hover:text-slate-950">登录系统</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ErpPreview() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-200/80">
      <div className="rounded-lg border border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <div className="text-xs text-slate-400">app.ss-erp.com/orders</div>
        </div>
        <div className="grid min-h-[420px] grid-cols-[120px_1fr] sm:grid-cols-[160px_1fr]">
          <aside className="border-r border-slate-200 bg-slate-950 p-3 text-white">
            <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-xs">SS</span>
              ERP
            </div>
            {['订单', '商品', '采集', '仓库', '财务'].map((item, index) => (
              <div
                key={item}
                className={`mb-1 rounded px-3 py-2 text-xs ${index === 0 ? 'bg-white text-slate-950' : 'text-slate-400'}`}
              >
                {item}
              </div>
            ))}
          </aside>
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">订单工作台</div>
                <div className="text-xs text-slate-500">OZON 多店铺履约状态</div>
              </div>
              <div className="rounded bg-primary px-3 py-2 text-xs font-medium text-white">同步订单</div>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              {[
                ['待发货', '42'],
                ['异常物流', '7'],
                ['今日收入', '₽184k'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="text-xs text-slate-500">{label}</div>
                  <div className="mt-2 text-xl font-semibold">{value}</div>
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              {[
                ['#9281', 'Moscow', '待打单', '¥84.20'],
                ['#9278', 'Kazan', '已出库', '¥126.90'],
                ['#9274', 'SPB', '待揽收', '¥63.10'],
                ['#9269', 'Perm', '异常', '¥214.50'],
              ].map(([order, city, status, profit]) => (
                <div key={order} className="grid grid-cols-4 border-b border-slate-100 px-3 py-3 text-xs last:border-0">
                  <span className="font-medium">{order}</span>
                  <span className="text-slate-500">{city}</span>
                  <span className={status === '异常' ? 'text-red-600' : 'text-slate-600'}>{status}</span>
                  <span className="text-right font-medium">{profit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
