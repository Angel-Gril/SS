import { z } from 'zod';

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

export interface ApiPagedResponse<T> {
  total: number;
  rows: T[];
}

export const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  sort: z.string().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
