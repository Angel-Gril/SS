'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';

export interface UseResourceQueryOptions {
  endpoint: string;
  queryKey: string[];
  onError?: (error: string) => void;
}

export interface UseResourceQueryReturn<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  create: (data: Partial<T>) => Promise<boolean>;
  update: (id: string, data: Partial<T>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/**
 * 基于 TanStack Query 的资源列表 Hook
 * 提供自动缓存、后台刷新、乐观更新等特性
 */
export function useResourceQuery<T extends { id: string }>(
  options: UseResourceQueryOptions
): UseResourceQueryReturn<T> {
  const { endpoint, queryKey, onError } = options;
  const queryClient = useQueryClient();

  // 查询列表
  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get<T[]>(endpoint);
      if (res.code === 1 && res.data) {
        return res.data;
      }
      throw new Error(res.msg || '加载失败');
    },
    staleTime: 30_000, // 30 秒内认为数据新鲜，不重新请求
    gcTime: 5 * 60_000, // 5 分钟后清理缓存
  });

  // 创建 mutation
  const createMutation = useMutation({
    mutationFn: async (newData: Partial<T>) => {
      const res = await api.post(endpoint, newData);
      if (res.code === 1) {
        return res.data;
      }
      throw new Error(res.msg || '创建失败');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: '创建成功' });
    },
    onError: (error: Error) => {
      const errorMsg = error.message || '创建失败';
      onError?.(errorMsg);
      toast({ title: errorMsg, variant: 'destructive' });
    },
  });

  // 更新 mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<T> }) => {
      const res = await api.put(`${endpoint}/${id}`, data);
      if (res.code === 1) {
        return res.data;
      }
      throw new Error(res.msg || '更新失败');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: '更新成功' });
    },
    onError: (error: Error) => {
      const errorMsg = error.message || '更新失败';
      onError?.(errorMsg);
      toast({ title: errorMsg, variant: 'destructive' });
    },
  });

  // 删除 mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`${endpoint}/${id}`);
      if (res.code === 1) {
        return id;
      }
      throw new Error(res.msg || '删除失败');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: '已删除' });
    },
    onError: (error: Error) => {
      const errorMsg = error.message || '删除失败';
      onError?.(errorMsg);
      toast({ title: errorMsg, variant: 'destructive' });
    },
  });

  return {
    items: data || [],
    loading: isLoading,
    error: error ? error.message : null,
    refresh: () => refetch(),
    create: async (data: Partial<T>) => {
      try {
        await createMutation.mutateAsync(data);
        return true;
      } catch {
        return false;
      }
    },
    update: async (id: string, data: Partial<T>) => {
      try {
        await updateMutation.mutateAsync({ id, data });
        return true;
      } catch {
        return false;
      }
    },
    remove: async (id: string) => {
      try {
        await deleteMutation.mutateAsync(id);
        return true;
      } catch {
        return false;
      }
    },
  };
}
