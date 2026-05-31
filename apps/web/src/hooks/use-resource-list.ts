'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';

export interface UseResourceListOptions {
  endpoint: string;
  onError?: (error: string) => void;
}

export interface UseResourceListReturn<T> {
  items: T[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (data: Partial<T>) => Promise<boolean>;
  update: (id: string, data: Partial<T>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/**
 * 通用资源列表 Hook
 * 封装 CRUD 操作的通用逻辑
 */
export function useResourceList<T extends { id: string }>(
  options: UseResourceListOptions
): UseResourceListReturn<T> {
  const { endpoint, onError } = options;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<T[]>(endpoint);
      if (res.code === 1 && res.data) {
        setItems(res.data);
      } else {
        const errorMsg = res.msg || '加载失败';
        onError?.(errorMsg);
        toast({ title: errorMsg, variant: 'destructive' });
      }
    } catch {
      const errorMsg = '网络错误';
      onError?.(errorMsg);
      toast({ title: errorMsg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [endpoint, onError]);

  const create = useCallback(async (data: Partial<T>): Promise<boolean> => {
    const res = await api.post(endpoint, data);
    if (res.code === 1) {
      toast({ title: '创建成功' });
      await refresh();
      return true;
    } else {
      toast({ title: res.msg || '创建失败', variant: 'destructive' });
      return false;
    }
  }, [endpoint, refresh]);

  const update = useCallback(async (id: string, data: Partial<T>): Promise<boolean> => {
    const res = await api.put(`${endpoint}/${id}`, data);
    if (res.code === 1) {
      toast({ title: '更新成功' });
      await refresh();
      return true;
    } else {
      toast({ title: res.msg || '更新失败', variant: 'destructive' });
      return false;
    }
  }, [endpoint, refresh]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const res = await api.delete(`${endpoint}/${id}`);
    if (res.code === 1) {
      toast({ title: '已删除' });
      await refresh();
      return true;
    } else {
      toast({ title: res.msg || '删除失败', variant: 'destructive' });
      return false;
    }
  }, [endpoint, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, refresh, create, update, remove };
}
