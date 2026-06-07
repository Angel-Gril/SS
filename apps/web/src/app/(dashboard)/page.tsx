'use client';

import { useEffect, useState } from 'react';
import { Store, ShoppingCart, Package, TrendingUp, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency, convertToCny } from '@/lib/utils';
import { OrderChart } from '@/components/dashboard/order-chart';
import { NoticeList } from '@/components/dashboard/notice-list';

interface DashboardStats {
  shopCount: number;
  productCount: number;
  orderCount: number;
  pendingOrders: number;
  todayRevenue: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DashboardStats>('/api/dashboard/stats').then((res) => {
      if (res.code === 1 && res.data) setStats(res.data);
      setLoading(false);
    });
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <OrderChart />
        </div>
        <NoticeList />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快速操作</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <QuickAction label="绑定店铺" href="/shops/ozon" />
          <QuickAction label="同步商品" href="/products" />
          <QuickAction label="处理订单" href="/orders" />
          <QuickAction label="批量上架" href="/listing" />
          <QuickAction label="1688采集上品" href="/collect/1688" />
          <QuickAction label="1688上架准备" href="/listing/1688" />
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

function QuickAction({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} className="flex items-center justify-center h-12 rounded-md border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
      {label}
    </a>
  );
}
