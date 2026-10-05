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
    var pendingMutation = null;
    var recoveredDraft = null;
    function unknown(message) {
      var error = new Error(message);
      error.outcome = 'UNKNOWN_OUTCOME';
      needsRecovery = true;
      return error;
    }
    function remember(type, projection, shopId, keys) {
      pendingMutation = {
        type: type, sourceIdentity: sourceIdentity(projection), platform: projection.source.platform,
        sourceProductId: projection.source.sourceProductId, shopId: shopId,
        snapshotId: projection.handoff && projection.handoff.snapshotId || null,
        supplyGoodsId: projection.handoff && projection.handoff.supplyGoodsId || null,
        selectedSkuKeys: keys.slice().sort(),
      };
    }
    function recoveryContext(projection, pending) {
      if (sourceIdentity(projection) !== pending.sourceIdentity) return 'SOURCE_CHANGED';
      if (!projection.shops.some(function (shop) { return shop.id === pending.shopId; })) return 'SHOP_AUTHORIZATION_CHANGED';
      if (!projection.handoff || projection.workbench.state !== 'ready' || projection.workbench.status.snapshot.current !== true
        || projection.handoff.platform !== pending.platform || projection.handoff.sourceProductId !== pending.sourceProductId) return 'SNAPSHOT_UNCONFIRMED';
      if (pending.snapshotId && (projection.handoff.snapshotId !== pending.snapshotId
        || projection.handoff.supplyGoodsId !== pending.supplyGoodsId)) return 'SNAPSHOT_CHANGED';
      var available = new Set(projection.skus.map(function (sku) { return sku.key; }));
      if (pending.selectedSkuKeys.some(function (key) { return !available.has(key); })) return 'SOURCE_SKUS_CHANGED';
      return null;
    }
    function matchingKeys(actual, expected) {
      return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length
        && JSON.stringify(actual.slice().sort()) === JSON.stringify(expected);
    }
    function recoverable(draft) {
      return draft && Number.isSafeInteger(draft.revision) && draft.revision > 0
        && Number.isSafeInteger(draft.draftVersion) && draft.draftVersion > 0 && draft.stage !== 'PUBLISHED'
        && ['ACTIVE', 'PAUSED', 'RETRYABLE_FAILURE', 'MANUAL_REVIEW'].includes(draft.runState);
    }
    function currentDraft(shopId) {
      var projection = getProjection();
      if (!projection.shops.some(function (shop) { return shop.id === shopId; })) {
        if (recoveredDraft && recoveredDraft.shopId === shopId) recoveredDraft = null;
        return null;
      }
      if (recoveredDraft && recoveredDraft.shopId === shopId) {
        if (sourceIdentity(projection) !== recoveredDraft.sourceIdentity
          || projection.handoff?.snapshotId !== recoveredDraft.snapshotId
          || projection.handoff?.supplyGoodsId !== recoveredDraft.supplyGoodsId) recoveredDraft = null;
        else {
          var preferred = projection.workbench.status.listing.items.find(function (draft) {
            return draft.id === recoveredDraft.id && draft.shopId === shopId;
          });
          if (preferred) return preferred;
          pendingMutation = recoveredDraft.pending;
          needsRecovery = true;
          return null;
        }
      }
      return listingForShop(projection, shopId);
    }
    async function command(type, fields) {
      try {
        var result = await send(type, fields || {});
        if (!result || result.ok !== true) {
          var responseError = new Error(result && result.error || '工作台操作未完成');
          if (result && result.outcome) responseError.outcome = result.outcome;
          throw responseError;
        }
        return result;
      } catch (error) {
        if (['COLLECT', 'CREATE_DRAFT'].includes(type)) {
          if (error.outcome === 'NOT_SUBMITTED') pendingMutation = null;
          else { error.outcome = 'UNKNOWN_OUTCOME'; needsRecovery = true; }
        }
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
          var existing = currentDraft(input.shopId);
          if (needsRecovery) throw unknown('原草稿不在当前读取结果中，请核对原草稿，不会替换成其他 SKU 草稿');
          if (existing) return existing;
          var selected = await input.selectSkus(toDonorData(projection));
          if (!selected) return null;
          if (identity !== sourceIdentity(getProjection())) throw new Error('来源商品已变化，请重新采集');
          var keys = selected.sku_matrix.map(function (row) { return row.row_id; });
          if (!keys.length || keys.length > 100 || new Set(keys).size !== keys.length) throw new Error('请选择 1 至 100 个不同 SKU');
          var currentKeys = new Set(getProjection().skus.map(function (sku) { return sku.key; }));
          if (keys.some(function (key) { return !currentKeys.has(key); })) throw new Error('商品 SKU 已变化，请重新选择');
          if (!getProjection().handoff) {
            remember('COLLECT', getProjection(), input.shopId, keys);
            await command('COLLECT');
          }
          projection = getProjection();
          if (identity !== sourceIdentity(projection)) {
            if (pendingMutation) throw unknown('来源商品已变化，请回到原商品核对采集结果');
            throw new Error('来源商品已变化，请重新采集');
          }
          if (!projection.handoff || projection.handoff.platform !== projection.source.platform
            || projection.handoff.sourceProductId !== projection.source.sourceProductId) throw unknown('采集快照未确认，请重新读取');
          currentKeys = new Set(projection.skus.map(function (sku) { return sku.key; }));
          if (keys.some(function (key) { return !currentKeys.has(key); })) {
            if (pendingMutation) throw unknown('快照 SKU 已变化，请核对原采集结果');
            throw new Error('快照 SKU 已变化，请重新选择');
          }
          remember('CREATE_DRAFT', projection, input.shopId, keys);
          await command('CREATE_DRAFT', { shopId: input.shopId, selectedSkuKeys: keys });
          var draft = listingForShop(getProjection(), input.shopId);
          if (!draft || draft.selectedSkuCount !== keys.length
            || recoveryContext(getProjection(), pendingMutation)) throw unknown('草稿响应尚未核对，请重新读取');
          pendingMutation = null;
          return draft;
        } finally {
          active = false;
        }
      },
      async recoverCurrentDraft() {
        if (active) throw new Error('工作台正在核对，请等待当前操作完成');
        if (!needsRecovery || !pendingMutation) return { state: 'idle', draft: null };
        active = true;
        var pending = pendingMutation;
        function unresolved(reasonCode, message) {
          return { state: 'recovery_required', recoveredOperation: pending.type, reasonCode: reasonCode,
            message: message || '原请求尚未核对，请保留当前操作并重新读取。', draft: null };
        }
        try {
          await command('REFRESH');
          var projection = getProjection();
          var mismatch = recoveryContext(projection, pending);
          if (mismatch) return unresolved(mismatch, '来源商品、快照、店铺或 SKU 已变化，请回到原上下文核对。');
          var found = null;
          if (pending.type === 'CREATE_DRAFT') {
            var candidates = projection.workbench.status.listing.items.filter(function (draft) {
              return draft.shopId === pending.shopId && draft.selectedSkuCount === pending.selectedSkuKeys.length && recoverable(draft);
            });
            for (var candidate of candidates) {
              var binding = { snapshotId: pending.snapshotId, supplyGoodsId: pending.supplyGoodsId, shopId: pending.shopId,
                listingWorkflowId: candidate.id, draftRevision: candidate.revision, draftVersion: candidate.draftVersion };
              var response = await command('EDITOR_READ', { listingWorkflowId: candidate.id, binding: binding });
              var editor = response.data && response.data.editor;
              mismatch = recoveryContext(getProjection(), pending);
              if (mismatch) return unresolved(mismatch);
              var live = getProjection().workbench.status.listing.items.find(function (draft) { return draft.id === candidate.id; });
              if (response.data?.state !== 'ready' || !editor || editor.contractVersion !== 'extension-listing-editor/v1' || !editor.binding
                || !Object.keys(binding).every(function (key) { return editor.binding[key] === binding[key]; })
                || !live || live.shopId !== candidate.shopId || live.revision !== candidate.revision || live.draftVersion !== candidate.draftVersion) {
                return unresolved('DRAFT_READBACK_CHANGED');
              }
              if (matchingKeys(editor.selectedSkuKeys, pending.selectedSkuKeys)) {
                if (found) return unresolved('DRAFT_READBACK_AMBIGUOUS');
                found = live;
              }
            }
            if (!found) return unresolved('DRAFT_NOT_CONFIRMED', '尚未找到与原快照、店铺和 SKU 完全一致的草稿，不会重新创建。');
            recoveredDraft = { id: found.id, shopId: pending.shopId, sourceIdentity: pending.sourceIdentity,
              snapshotId: pending.snapshotId, supplyGoodsId: pending.supplyGoodsId, pending: pending };
          }
          needsRecovery = false;
          pendingMutation = null;
          return { state: 'ready', recoveredOperation: pending.type, draft: found,
            handoff: Object.assign({}, getProjection().handoff), selectedSkuKeys: pending.selectedSkuKeys.slice() };
        } catch (error) {
          return unresolved('READBACK_UNAVAILABLE', error.message || '原请求核对暂不可用，请稍后重新读取。');
        } finally { active = false; }
      },
      currentDraft: currentDraft,
      isActive: function () { return active; },
      needsRecovery: function () { return needsRecovery; },
    };
  }

  root.SS_ERP_PRECISION_WORKFLOW = { createSession: createSession, toDonorData: toDonorData, listingForShop: listingForShop };
})(typeof globalThis !== 'undefined' ? globalThis : self);
