'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, PackageCheck, PackageMinus, Activity, ScanLine, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface DashboardData {
  todayIn: number;
  todayOut: number;
  inStock: number;
  totalProcessed: number;
  recentOps: RecentOp[];
}

interface RecentOp {
  id: string;
  postingNumber: string;
  platformOrderId: string;
  domesticTrackingNumber: string | null;
  domesticStatus: string | null;
  internationalTrackingNumber: string | null;
  internationalStatus: string | null;
  items: any;
  updatedAt: string;
  shop: { name: string };
}

export default function WarehouseDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function fetchDashboard() {
    setLoading(true);
    const res = await api.get<DashboardData>('/api/warehouse/dashboard');
    if (res.code === 1 && res.data) {
      setData(res.data);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">仓库看板</h1>
          <p className="text-muted-foreground mt-1">实时掌握仓库出入库状态</p>
        </div>
        <div className="flex gap-3">
          <Link href="/warehouse/scan-in">
            <Button size="lg" variant="outline" className="text-base">
              <ScanLine className="mr-2 h-5 w-5" /> 扫码入库
            </Button>
          </Link>
          <Link href="/warehouse/scan-out">
            <Button size="lg" className="text-base">
              <ScanLine className="mr-2 h-5 w-5" /> 扫码出库
            </Button>
          </Link>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
                <Package className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">今日入库</p>
                <p className="text-3xl font-bold">{data?.todayIn ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-green-100 text-green-600">
                <PackageCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">今日出库</p>
                <p className="text-3xl font-bold">{data?.todayOut ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-orange-100 text-orange-600">
                <PackageMinus className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">在库待出</p>
                <p className="text-3xl font-bold">{data?.inStock ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-purple-100 text-purple-600">
                <Activity className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">总处理量</p>
                <p className="text-3xl font-bold">{data?.totalProcessed ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 最近操作记录 */}
      <Card>
        <CardHeader>
          <CardTitle>最近操作记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>订单号</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>国内单号</TableHead>
                <TableHead>入库状态</TableHead>
                <TableHead>国际单号</TableHead>
                <TableHead>出库状态</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!data?.recentOps || data.recentOps.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    暂无操作记录
                  </TableCell>
                </TableRow>
              ) : (
                data.recentOps.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell className="font-mono text-xs">{op.postingNumber || op.platformOrderId}</TableCell>
                    <TableCell>{op.shop?.name}</TableCell>
                    <TableCell className="font-mono text-xs">{op.domesticTrackingNumber || '-'}</TableCell>
                    <TableCell>
                      {op.domesticStatus === 'received' ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已入库</Badge>
                      ) : op.domesticStatus ? (
                        <Badge variant="secondary">{op.domesticStatus}</Badge>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{op.internationalTrackingNumber || '-'}</TableCell>
                    <TableCell>
                      {op.internationalStatus === 'shipped' ? (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">已出库</Badge>
                      ) : op.internationalStatus ? (
                        <Badge variant="secondary">{op.internationalStatus}</Badge>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(op.updatedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
