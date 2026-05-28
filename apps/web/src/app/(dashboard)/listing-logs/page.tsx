'use client';

import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListingJobList } from '@/components/listing-job-list';

export default function ListingLogsPage() {
  const [filter, setFilter] = useState<'all' | 'follow' | 'clone'>('all');

  // ListingJobList 接收 modeFilter: 'follow' | 'clone' | null
  const modeFilter = filter === 'all' ? null : filter;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ScrollText className="h-6 w-6" /> 上架日志
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            汇总 SKU 采集跟卖 + SKU 采集改款的所有上架任务，点击「详情」查看完整信息
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'follow', 'clone'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={filter === m ? 'default' : 'outline'}
              onClick={() => setFilter(m)}
              className="h-8 text-xs"
            >
              {m === 'all' ? '全部' : m === 'follow' ? '跟卖' : '复制'}
            </Button>
          ))}
        </div>
      </div>

      <ListingJobList
        modeFilter={modeFilter}
        title="任务列表"
        limit={50}
      />
    </div>
  );
}
