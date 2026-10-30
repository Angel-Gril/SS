import { z } from 'zod';

/** Read scope only: never grants access beyond the caller's authorized shop IDs. */
export const platformShopScopeSchema = z.object({
  platform: z.enum(['OZON', 'YANDEX', 'KASPI', 'WILDBERRIES']).optional(),
  shopId: z.string().trim().min(1).max(200).optional(),
});

export function restrictOwnedShopIds(ownedIds: string[], selectedShopId?: string): string[] {
  return selectedShopId ? ownedIds.filter(id => id === selectedShopId) : ownedIds;
}
