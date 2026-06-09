'use client';

import { useEffect, useState } from 'react';
import { Calculator, GitBranch, ListPlus, Store, ShoppingCart, Package, TrendingUp, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency, convertToCny } from '@/lib/utils';
import { OrderChart } from '@/components/dashboard/order-chart';
import { NoticeList } from '@/components/dashboard/notice-list';
import { OnboardingGuide } from '@/components/dashboard/onboarding-guide';
import type { OnboardingStatus } from '@/lib/onboarding';
import {
  buildDashboardBusinessActions,
  getDashboardBusinessActionMeta,
  type DashboardBusinessAction,
  type DashboardBusinessStatus,
} from '@/lib/dashboard-business';

interface DashboardStats {
  shopCount: number;
  productCount: number;
  orderCount: number;
  pendingOrders: number;
  todayRevenue: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [businessStatus, setBusinessStatus] = useState<DashboardBusinessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const businessActions = buildDashboardBusinessActions();

  useEffect(() => {
    Promise.all([
      api.get<DashboardStats>('/api/dashboard/stats'),
      api.get<OnboardingStatus>('/api/user/onboarding-status'),
      api.get<DashboardBusinessStatus>('/api/dashboard/business-status'),
    ]).then(([statsRes, onboardingRes, businessRes]) => {
      if (statsRes.code === 1 && statsRes.data) setStats(statsRes.data);
      if (onboardingRes.code === 1 && onboardingRes.data) setOnboarding(onboardingRes.data);
      if (businessRes.code === 1 && businessRes.data) setBusinessStatus(businessRes.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">欢迎使用松鼠跨境 ERP</h1>
        <p className="text-muted-foreground mt-1">管理您的跨境电商业务</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="店铺数量" value={String(stats?.shopCount ?? 0)} icon={Store} description="已绑定店铺" />
        <StatCard title="待处理订单" value={String(stats?.pendingOrders ?? 0)} icon={ShoppingCart} description="需要发货" highlight />
        <StatCard title="在售商品" value={String(stats?.productCount ?? 0)} icon={Package} description="全平台商品" />
        <StatCard title="今日销售额" value={formatCurrency(convertToCny(stats?.todayRevenue ?? '0', 'RUB'), 'CNY')} icon={TrendingUp} description="估算汇率换算" />
      </div>

      {onboarding && !onboarding.completed && <OnboardingGuide status={onboarding} />}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <OrderChart />
        </div>
        <NoticeList />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">业务工作台</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {businessActions.map((action) => (
            <BusinessActionCard
              key={action.key}
              action={action}
              meta={getDashboardBusinessActionMeta(action, businessStatus)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, description, highlight }: {
  title: string; value: string; icon: React.ElementType; description: string; highlight?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${highlight ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

const ACTION_ICONS = {
  calculator: Calculator,
  mapping: GitBranch,
  package: Package,
  listing: ListPlus,
} satisfies Record<DashboardBusinessAction['icon'], React.ElementType>;

function BusinessActionCard({ action, meta }: { action: DashboardBusinessAction; meta: string }) {
  const Icon = ACTION_ICONS[action.icon];
  return (
    <a href={action.href} className="block rounded-md border p-4 transition-colors hover:border-primary hover:bg-primary/5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-medium">{action.label}</div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{action.description}</p>
          <div className="mt-3 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{meta}</div>
        </div>
      </div>
    </a>
  );
}
