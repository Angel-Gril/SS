(function (root) {
  'use strict';

  function listingForShop(projection, shopId) {
    return projection.workbench.status.listing.items.find(function (item) {
      return item.shopId === shopId;
    }) || null;
  }

  function toDonorData(projection) {
    return {
      meta_info: { source_url: projection.source.canonicalUrl, source_category: projection.source.categoryName },
      global_data: {
        product_name: projection.source.title,
        media_gallery: {
          main_images: projection.media.filter(function (item) { return item.role === 'product_main'; }).map(function (item) { return item.url; }),
          detail_images: projection.media.filter(function (item) { return item.role === 'product_detail'; }).map(function (item) { return item.url; }),
        },
      },
      sku_matrix: projection.skus.map(function (sku) {
        return {
          row_id: sku.key,
          source_sku_id: sku.sourceSkuId,
          specifications: { '规格': sku.label },
          specs: { color_name_cn: sku.label, size_name_cn: '' },
          sku_image_url: sku.imageUrl,
          price: { amount: sku.priceCny, currency: 'CNY' },
          stock: sku.stock,
        };
      }),
    };
  }

  function sourceIdentity(projection) {
    return [projection.source.platform, projection.source.sourceProductId, projection.source.canonicalUrl].join('|');
  }

  function createSession(options) {
    var getProjection = options.getProjection;
    var send = options.send;
    var active = false;
    var needsRecovery = false;
    async function command(type, fields) {
      try {
        var result = await send(type, fields || {});
        if (!result || result.ok !== true) throw new Error(result && result.error || '工作台操作未完成');
        return result;
      } catch (error) {
        if (type !== 'REFRESH' && error.outcome === 'UNKNOWN_OUTCOME') needsRecovery = true;
        throw error;
      }
    }
    return {
      async start(input) {
        if (active) throw new Error('工作台正在执行，请等待当前操作完成');
        if (needsRecovery) throw new Error('上次写入结果尚未核对，请重新读取并确认草稿状态');
        active = true;
        try {
          await command('REFRESH');
          var projection = getProjection();
          var identity = sourceIdentity(projection);
          if (!projection.source.sourceProductId || !projection.skus.length) throw new Error('尚未读取到商品 SKU');
          if (!projection.shops.some(function (shop) { return shop.id === input.shopId; })) throw new Error('请先选择已授权店铺');
          var existing = listingForShop(projection, input.shopId);
          if (existing) return existing;
          var selected = await input.selectSkus(toDonorData(projection));
          if (!selected) return null;
          if (identity !== sourceIdentity(getProjection())) throw new Error('来源商品已变化，请重新采集');
          var keys = selected.sku_matrix.map(function (row) { return row.row_id; });
          if (!keys.length || keys.length > 100 || new Set(keys).size !== keys.length) throw new Error('请选择 1 至 100 个不同 SKU');
          var currentKeys = new Set(getProjection().skus.map(function (sku) { return sku.key; }));
          if (keys.some(function (key) { return !currentKeys.has(key); })) throw new Error('商品 SKU 已变化，请重新选择');
          if (!getProjection().handoff) await command('COLLECT');
          projection = getProjection();
          if (identity !== sourceIdentity(projection)) throw new Error('来源商品已变化，请重新采集');
          if (!projection.handoff || projection.handoff.platform !== projection.source.platform
            || projection.handoff.sourceProductId !== projection.source.sourceProductId) throw new Error('采集快照未确认，请重新读取');
          currentKeys = new Set(projection.skus.map(function (sku) { return sku.key; }));
          if (keys.some(function (key) { return !currentKeys.has(key); })) throw new Error('快照 SKU 已变化，请重新选择');
          await command('CREATE_DRAFT', { shopId: input.shopId, selectedSkuKeys: keys });
          var draft = listingForShop(getProjection(), input.shopId);
          if (!draft) { needsRecovery = true; throw new Error('草稿响应尚未核对，请重新读取'); }
          return draft;
        } finally {
          active = false;
        }
      },
      isActive: function () { return active; },
      needsRecovery: function () { return needsRecovery; },
    };
  }

  root.SS_ERP_PRECISION_WORKFLOW = { createSession: createSession, toDonorData: toDonorData, listingForShop: listingForShop };
})(typeof globalThis !== 'undefined' ? globalThis : self);
