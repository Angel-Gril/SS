'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  Package,
  PlayCircle,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { formatCurrency, convertToCny } from '@/lib/utils';
import { OrderChart } from '@/components/dashboard/order-chart';
import { NoticeList } from '@/components/dashboard/notice-list';
import { cn } from '@/lib/utils';

interface DashboardStats {
  shopCount: number;
  productCount: number;
  orderCount: number;
  pendingOrders: number;
  todayRevenue: string;
}

interface DashboardContentBlock {
  id: string;
  key: string;
  type: 'BANNER' | 'QUICK_LINKS' | 'STEP_GROUP' | 'TUTORIALS' | 'UPDATE_CARD' | 'SUPPORT_LINKS' | 'CHECKLIST';
  title: string;
  subtitle?: string | null;
  content: Record<string, unknown>;
  sortOrder: number;
}

interface QuickLinkItem {
  label: string;
  href: string;
  description?: string;
  icon?: string;
  external?: boolean;
}

interface StepGroup {
  title: string;
  tone?: 'blue' | 'violet' | 'orange' | 'green';
  items: Array<{ title: string; href?: string; description?: string } | string>;
}

interface TutorialItem {
  title: string;
  href: string;
  description?: string;
  duration?: string;
}

const fallbackStepGroups: StepGroup[] = [
  {
    title: '开店前',
    tone: 'blue',
    items: [
      { title: '绑定 Ozon 店铺', href: '/shops/ozon' },
      { title: '同步 Cookie / companyId', href: '/shops/ozon' },
      { title: '配置仓库和发运点', href: '/warehouses' },
    ],
  },
  {
    title: '出单前',
    tone: 'violet',
    items: [
      { title: '采集商品并定价', href: '/collect' },
      { title: '处理图片和水印', href: '/image-processing' },
      { title: '发布并查看上架日志', href: '/listing-logs' },
    ],
  },
  {
    title: '出单后',
    tone: 'orange',
    items: [
      { title: '处理订单和物流', href: '/orders' },
      { title: '打包发货', href: '/orders/ship' },
      { title: '复盘利润和活动', href: '/finance/profit' },
    ],
  },
];

const fallbackQuickLinks: QuickLinkItem[] = [
  { label: 'Ozon 店铺', href: '/shops/ozon', description: '授权、Cookie、API', icon: 'store' },
  { label: '商品管理', href: '/products', description: '同步、价格、库存', icon: 'package' },
  { label: 'SKU采集跟卖', href: '/collect', description: '采集、改款、上架', icon: 'sparkles' },
  { label: '店铺分析', href: '/shops/ozon/analytics', description: '分析、图表、促销', icon: 'chart' },
  { label: '发运点查询', href: '/ozon-pickup-points', description: '按城市/承运商筛选', icon: 'truck' },
  { label: '图片处理', href: '/image-processing', description: '水印和分辨率', icon: 'play' },
  { label: '订单处理', href: '/orders', description: '打包发货和售后', icon: 'orders' },
  { label: '公告更新', href: '/announcements', description: '系统通知和版本更新', icon: 'book' },
];

const fallbackTutorials: TutorialItem[] = [
  { title: '插件安装与连接检查', href: '/help', description: '确认 ERP 后端、Ozon 登录态和扩展状态' },
  { title: 'Ozon 上品基本流程', href: '/listing', description: '从采集、图片、水印到发布日志' },
  { title: '发运点池同步与查询', href: '/ozon-pickup-points', description: '管理员同步，用户查询附近可用点' },
];

function arrayContent<T>(block: DashboardContentBlock | undefined, key: string, fallback: T[]): T[] {
  const value = block?.content?.[key];
  return Array.isArray(value) && value.length ? value as T[] : fallback;
}

function iconFor(name?: string) {
  switch (name) {
    case 'store': return Store;
    case 'chart': return BarChart3;
    case 'truck': return Truck;
    case 'orders': return ShoppingCart;
    case 'book': return BookOpen;
    case 'play': return PlayCircle;
    case 'sparkles': return Sparkles;
    case 'package':
    default: return Package;
  }
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [blocks, setBlocks] = useState<DashboardContentBlock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<DashboardStats>('/api/dashboard/stats'),
      api.get<{ items: DashboardContentBlock[] }>('/api/dashboard-content'),
    ]).then(([statsRes, contentRes]) => {
      if (cancelled) return;
      if (statsRes.code === 1 && statsRes.data) setStats(statsRes.data);
      if (contentRes.code === 1 && contentRes.data?.items) setBlocks(contentRes.data.items);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const content = useMemo(() => {
    const byType = new Map<string, DashboardContentBlock>();
    for (const block of blocks) if (!byType.has(block.type)) byType.set(block.type, block);
    const banner = byType.get('BANNER');
    return {
      banner,
      steps: arrayContent<StepGroup>(byType.get('STEP_GROUP'), 'groups', fallbackStepGroups),
      links: arrayContent<QuickLinkItem>(byType.get('QUICK_LINKS'), 'links', fallbackQuickLinks),
      tutorials: arrayContent<TutorialItem>(byType.get('TUTORIALS'), 'items', fallbackTutorials),
    };
  }, [blocks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-card px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {content.banner?.title || 'Ozon 运营工作台'}
              </h1>
              <Badge variant="secondary" className="text-[10px]">SS ERP</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {content.banner?.subtitle || '围绕店铺同步、商品上架、发货履约和利润复盘组织你的日常操作。'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-right sm:grid-cols-4 lg:min-w-[560px]">
            <Metric label="店铺" value={stats?.shopCount ?? 0} />
            <Metric label="商品" value={stats?.productCount ?? 0} />
            <Metric label="待发货" value={stats?.pendingOrders ?? 0} tone="warn" />
            <Metric label="今日销售额" value={formatCurrency(convertToCny(stats?.todayRevenue ?? '0', 'RUB'), 'CNY')} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
        <div className="grid gap-4 lg:grid-cols-3">
          {content.steps.map((group, index) => (
            <StepPanel key={`${group.title}-${index}`} group={group} index={index} />
          ))}
        </div>
        <QuickLinks links={content.links} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
        <OrderChart />

        <div className="space-y-4">
          <NoticeList />
          <TutorialList tutorials={content.tutorials} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'warn' && Number(value) > 0 ? 'text-amber-600' : '')}>
        {value}
      </div>
    </div>
  );
}

function StepPanel({ group, index }: { group: StepGroup; index: number }) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  }[group.tone || 'blue'];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs', toneClass)}>
            {index + 1}
          </span>
          {group.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {group.items.map((raw, itemIndex) => {
          const item = typeof raw === 'string' ? { title: raw } : raw;
          const row = (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="font-medium leading-5">{item.title}</div>
                {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
              </div>
            </div>
          );
          return item.href ? (
            <Link key={`${item.title}-${itemIndex}`} href={item.href} className="block rounded-md px-1 py-0.5 hover:bg-muted">
              {row}
            </Link>
          ) : (
            <div key={`${item.title}-${itemIndex}`}>{row}</div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function QuickLinks({ links }: { links: QuickLinkItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">快捷入口</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {links.slice(0, 10).map((item) => {
          const Icon = iconFor(item.icon);
          const content = (
            <div className="group flex min-h-[86px] flex-col justify-between rounded-md border p-3 transition-colors hover:border-primary/50 hover:bg-muted/40">
              <div className="flex items-center justify-between">
                <Icon className="h-4 w-4 text-primary" />
                {item.external ? <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /> : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />}
              </div>
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                {item.description && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.description}</div>}
              </div>
            </div>
          );
          return item.external ? (
            <a key={item.label} href={item.href} target="_blank" rel="noreferrer">{content}</a>
          ) : (
            <Link key={item.label} href={item.href}>{content}</Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TutorialList({ tutorials }: { tutorials: TutorialItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">教程与排查</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tutorials.slice(0, 5).map((item) => (
          <Link key={item.title} href={item.href} className="flex items-start gap-3 rounded-md p-2 hover:bg-muted">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{item.title}</span>
                {item.duration && <Badge variant="outline" className="text-[10px]">{item.duration}</Badge>}
              </div>
              {item.description && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</div>}
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
