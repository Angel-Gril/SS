'use client';

import { ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export interface ResourceListLayoutProps {
  title: string;
  description?: string;
  loading: boolean;
  isEmpty: boolean;
  emptyMessage?: string;
  onCreateClick: () => void;
  createLabel?: string;
  children: ReactNode;
}

/**
 * 通用资源列表布局
 * 封装列表页的通用布局：标题、创建按钮、加载状态、空状态
 */
export function ResourceListLayout({
  title,
  description,
  loading,
  isEmpty,
  emptyMessage = '暂无数据，点击上方按钮创建',
  onCreateClick,
  createLabel = '新增',
  children,
}: ResourceListLayoutProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        <Button onClick={onCreateClick}>
          <Plus className="h-4 w-4 mr-1" />
          {createLabel}
        </Button>
      </div>

      <Card>
        {description && (
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">{description}</p>
          </CardHeader>
        )}
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : isEmpty ? (
            <p className="text-center py-10 text-muted-foreground">{emptyMessage}</p>
          ) : (
            children
          )}
        </CardContent>
      </Card>
    </div>
  );
}
