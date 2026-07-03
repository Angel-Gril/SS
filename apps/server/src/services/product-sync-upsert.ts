type ProductDelegate = {
  upsert(args: any): Promise<unknown>;
  update(args: any): Promise<unknown>;
};

type SyncedOzonProductUpsertArgs = {
  product: ProductDelegate;
  shopId: string;
  platformProductId: string;
  offerId?: string | null;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function isOfferIdUniqueConflict(error: unknown): boolean {
  const err = error as { code?: string; meta?: { target?: unknown } } | null;
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (!Array.isArray(target)) return false;
  return target.includes('shop_id') && target.includes('offer_id');
}

export async function upsertSyncedOzonProduct(args: SyncedOzonProductUpsertArgs) {
  try {
    return await args.product.upsert({
      where: {
        shopId_platformProductId: {
          shopId: args.shopId,
          platformProductId: args.platformProductId,
        },
      },
      create: args.create,
      update: args.update,
    });
  } catch (error) {
    if (!args.offerId || !isOfferIdUniqueConflict(error)) throw error;
    return args.product.update({
      where: {
        shopId_offerId: {
          shopId: args.shopId,
          offerId: args.offerId,
        },
      },
      data: {
        ...args.update,
        platformProductId: args.platformProductId,
      },
    });
  }
}
