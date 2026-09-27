(function () {
  'use strict';

  var Contract = globalThis.SS_ERP_DONOR_WORKBENCH_CONTRACT;
  var PromptAdapter = globalThis.SS_ERP_DONOR_PROMPT_ADAPTER;
  if (!Contract) return;

  var projection = Contract.createProjection({});
  var activeStage = 'collection';
  var selectedSkuKeys = new Set();
  var selectedMediaKeys = new Set();
  var selectedShopId = '';
  var selectedMediaSkuKey = '';
  var skuSignature = '';
  var mediaSignature = '';
  var promptSignature = '';
  var stageUserSelected = false;
  var pending = new Map();
  var toastTimer = 0;
  var parentOrigin = allowedParentOrigin(document.referrer) || '*';

  function one(selector) { return document.querySelector(selector); }
  function all(selector) { return Array.from(document.querySelectorAll(selector)); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function node(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text != null) value.textContent = String(text);
    return value;
  }

  function allowedParentOrigin(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:') return '';
      var hostname = url.hostname.toLowerCase();
      if (hostname === 'detail.1688.com'
        || hostname.endsWith('.pinduoduo.com')
        || hostname.endsWith('.yangkeduo.com')
        || hostname === 'item.taobao.com'
        || hostname === 'detail.tmall.com') return url.origin;
      return '';
    } catch (_error) {
      return '';
    }
  }

  function requestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return 'request-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function send(type, fields) {
    var id = requestId();
    var message = Object.assign({
      contractVersion: Contract.CONTRACT_VERSION,
      type: type,
      requestId: id,
    }, fields || {});
    pending.set(id, type);
    globalThis.parent.postMessage(message, parentOrigin);
    return id;
  }

  function currentListing() {
    var items = projection.workbench.status.listing.items;
    if (!items.length) return null;
    if (selectedShopId) {
      var selected = items.find(function (item) { return item.shopId === selectedShopId; });
      if (selected) return selected;
    }
    return items[0];
  }

  function stageFromProjection() {
    if (!projection.source.sourceProductId) return 'collection';
    if (!projection.handoff) return 'collection';
    var listing = currentListing();
    if (!listing) return 'draft';
    if (listing.stage === 'CATEGORY_REVIEW' || listing.stage === 'ATTRIBUTE_REVIEW') return 'category';
    if (listing.stage === 'CONTENT_REVIEW' || listing.stage === 'MEDIA_REVIEW') return 'media';
    return 'review';
  }

  function stageOrder(stage) {
    return ['collection', 'draft', 'category', 'media', 'review'].indexOf(stage);
  }

  function syncSelections() {
    var nextSkuSignature = projection.skus.map(function (item) { return item.key; }).join('\u0000');
    if (nextSkuSignature !== skuSignature) {
      var allowed = new Set(projection.skus.map(function (item) { return item.key; }));
      selectedSkuKeys = new Set(Array.from(selectedSkuKeys).filter(function (key) { return allowed.has(key); }));
      if (!selectedSkuKeys.size) {
        projection.skus.slice(0, 100).forEach(function (item) { selectedSkuKeys.add(item.key); });
      }
      skuSignature = nextSkuSignature;
    }
    if (projection.source.preferredSkuKey) {
      selectedMediaSkuKey = projection.source.preferredSkuKey;
    } else if (!projection.skus.some(function (item) { return item.key === selectedMediaSkuKey; })) {
      selectedMediaSkuKey = projection.source.preferredSkuKey
        || (projection.skus[0] && projection.skus[0].key) || '';
    }
    var nextMediaSignature = projection.media.map(function (item) { return item.key; }).join('\u0000');
    if (nextMediaSignature !== mediaSignature) {
      var allowedMedia = new Set(projection.media.map(function (item) { return item.key; }));
      selectedMediaKeys = new Set(Array.from(selectedMediaKeys).filter(function (key) { return allowedMedia.has(key); }));
      if (!selectedMediaKeys.size) {
        projection.media.slice(0, 4).forEach(function (item) { selectedMediaKeys.add(item.key); });
      }
      mediaSignature = nextMediaSignature;
    }
    if (!projection.shops.some(function (shop) { return shop.id === selectedShopId; })) {
      selectedShopId = projection.shops[0] ? projection.shops[0].id : '';
    }
  }

  function syncPromptDraft() {
    var signature = [
      projection.source.sourceProductId,
      selectedMediaSkuKey || Array.from(selectedSkuKeys).join(','),
      Array.from(selectedMediaKeys).join(','),
    ].join('|');
    if (signature === promptSignature) return;
    promptSignature = signature;
    var textarea = one('[data-role="prompt-json"]');
    if (!textarea) return;
    var draft = PromptAdapter && typeof PromptAdapter.buildPromptDraft === 'function'
      && selectedSkuKeys.size > 0
      ? PromptAdapter.buildPromptDraft(projection, {
        selectedSkuKeys: selectedMediaSkuKey ? [selectedMediaSkuKey] : Array.from(selectedSkuKeys),
        selectedMediaKeys: Array.from(selectedMediaKeys),
      })
      : null;
    textarea.value = JSON.stringify({
      product: {
        title: projection.source.title,
        sourcePlatform: projection.source.platform,
        sourceCategory: projection.source.categoryName,
      },
      selectedSkuKeys: selectedMediaSkuKey ? [selectedMediaSkuKey] : Array.from(selectedSkuKeys),
      referenceMediaKeys: Array.from(selectedMediaKeys),
      visualDescription: draft ? draft.visualDescription : {
        subject: '', composition: '', background: '', lighting: '', constraints: [],
      },
      prompt: draft ? draft.prompt : '',
      negativePrompt: draft ? draft.negativePrompt : '',
    }, null, 2);
    var promptText = one('[data-role="prompt-text"]');
    var negativePromptText = one('[data-role="negative-prompt-text"]');
    if (promptText) promptText.value = draft ? draft.prompt : '';
    if (negativePromptText) negativePromptText.value = draft ? draft.negativePrompt : '';
    validatePromptJson();
  }

  function renderHeader() {
    one('[data-role="source-title"]').textContent = projection.source.title || '正在读取商品';
    one('[data-role="source-meta"]').textContent = [
      projection.source.platform ? projection.source.platform.toUpperCase() : 'SOURCE',
      projection.source.sourceProductId || '未识别',
    ].join(' · ');
    var connection = one('[data-role="connection"]');
    connection.className = 'connection';
    if (projection.error) {
      connection.textContent = '需要检查';
      connection.classList.add('is-error');
    } else if (projection.busy) {
      connection.textContent = '同步中';
    } else {
      connection.textContent = '已连接';
      connection.classList.add('is-ready');
    }
    var status = one('[data-role="status"]');
    status.hidden = !projection.error;
    status.textContent = projection.error || '';
    status.className = 'status-line' + (projection.error ? ' is-error' : '');
  }

  function renderStages() {
    var projectedStage = stageFromProjection();
    var projectedIndex = stageOrder(projectedStage);
    all('[data-stage]').forEach(function (button) {
      var stage = button.dataset.stage;
      var index = stageOrder(stage);
      button.classList.toggle('is-active', stage === activeStage);
      button.classList.toggle('is-complete', index < projectedIndex);
      var status = button.querySelector('[data-stage-state]');
      status.textContent = index < projectedIndex ? '完成' : index === projectedIndex ? '当前' : '等待';
    });
    all('[data-view]').forEach(function (view) {
      view.hidden = view.dataset.view !== activeStage;
    });
    one('[data-role="snapshot-state"]').textContent = projection.handoff
      ? (projection.workbench.status.snapshot.current ? '有效' : '已更新') : '未建立';
    var shop = projection.shops.find(function (item) { return item.id === selectedShopId; });
    one('[data-role="shop-state"]').textContent = shop ? shop.name : '未选择';
    var listing = currentListing();
    one('[data-role="draft-version"]').textContent = listing
      ? 'v' + listing.draftVersion + ' / r' + listing.revision : '--';
  }

  function appendEmpty(container, text) {
    var empty = node('div', 'empty-state', text);
    container.appendChild(empty);
  }

  function replaceBrokenPreview(image, label) {
    image.addEventListener('error', function () {
      var fallback = node('span', 'preview-fallback', label || '预览不可用');
      image.replaceWith(fallback);
    }, { once: true });
  }

  function renderCollection() {
    one('[data-role="platform"]').textContent = projection.source.platform.toUpperCase() || '--';
    one('[data-role="product-id"]').textContent = projection.source.sourceProductId || '--';
    one('[data-role="source-category"]').textContent = projection.source.categoryName || '--';
    one('[data-role="media-count"]').textContent = String(projection.media.length);
    one('[data-role="collection-media-count"]').textContent = projection.media.length + ' 张';
    var visual = one('[data-role="product-visual"]');
    clear(visual);
    if (projection.media[0]) {
      var image = node('img');
      image.src = projection.media[0].url;
      image.alt = projection.source.title || '商品主图';
      image.addEventListener('error', function () {
        clear(visual);
        visual.appendChild(node('span', '', '图片无法预览'));
      }, { once: true });
      visual.appendChild(image);
    } else {
      visual.appendChild(node('span', '', '暂无商品图'));
    }
    var strip = one('[data-role="collection-media"]');
    clear(strip);
    if (!projection.media.length) appendEmpty(strip, '暂无来源素材');
    projection.media.forEach(function (item) {
      var thumb = node('div', 'media-thumb');
      var img = node('img');
      img.src = item.url;
      img.alt = item.role;
      replaceBrokenPreview(img, '预览不可用');
      thumb.appendChild(img);
      thumb.appendChild(node('span', '', item.role));
      strip.appendChild(thumb);
    });
    var collect = one('[data-action="collect"]');
    collect.disabled = projection.busy || !projection.source.sourceProductId;
    collect.textContent = projection.handoff ? '重新采集快照' : '采集到 ERP';
  }

  function renderSkus() {
    var listing = currentListing();
    var locked = Boolean(listing);
    one('[data-role="sku-selection-count"]').textContent = selectedSkuKeys.size + ' / ' + projection.skus.length;
    var list = one('[data-role="sku-list"]');
    clear(list);
    if (!projection.skus.length) appendEmpty(list, '未读取到 SKU');
    projection.skus.forEach(function (item) {
      var label = node('label', 'sku-row');
      var checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedSkuKeys.has(item.key);
      checkbox.disabled = locked;
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedSkuKeys.add(item.key);
        else selectedSkuKeys.delete(item.key);
        promptSignature = '';
        renderSkus();
        syncPromptDraft();
      });
      label.appendChild(checkbox);
      if (item.imageUrl) {
        var image = node('img');
        image.src = item.imageUrl;
        image.alt = '';
        replaceBrokenPreview(image, 'SKU');
        label.appendChild(image);
      } else {
        label.appendChild(node('span', 'sku-image-fallback', 'SKU'));
      }
      var copy = node('span');
      copy.appendChild(node('strong', '', item.label));
      copy.appendChild(node('small', '', item.key));
      label.appendChild(copy);
      list.appendChild(label);
    });
    one('[data-action="select-all-skus"]').disabled = locked || !projection.skus.length;
    one('[data-action="clear-skus"]').disabled = locked || !selectedSkuKeys.size;
  }

  function summaryRow(label, value) {
    var row = node('div');
    row.appendChild(node('span', '', label));
    row.appendChild(node('strong', '', value));
    return row;
  }

  function renderDraft() {
    var select = one('[data-role="shop-select"]');
    clear(select);
    if (!projection.shops.length) {
      var empty = node('option', '', '暂无已授权 Ozon 店铺');
      empty.value = '';
      select.appendChild(empty);
    }
    projection.shops.forEach(function (shop) {
      var option = node('option', '', shop.name + (shop.status ? ' · ' + shop.status : ''));
      option.value = shop.id;
      option.selected = shop.id === selectedShopId;
      select.appendChild(option);
    });
    select.value = selectedShopId;
    select.disabled = Boolean(currentListing()) || projection.busy;
    var listing = currentListing();
    var summary = one('[data-role="draft-summary"]');
    clear(summary);
    summary.appendChild(summaryRow('快照', projection.handoff ? '已绑定' : '未建立'));
    summary.appendChild(summaryRow('SKU', String(selectedSkuKeys.size)));
    summary.appendChild(summaryRow('草稿', listing ? listing.id : '未创建'));
    summary.appendChild(summaryRow('阶段', listing ? listing.stage : '等待创建'));
    var create = one('[data-action="create-draft"]');
    create.disabled = projection.busy || Boolean(listing) || !projection.handoff
      || !selectedShopId || !selectedSkuKeys.size;
    create.textContent = listing ? '草稿已创建' : '创建精确快照草稿';
    one('[data-role="draft-state"]').textContent = listing ? listing.stage : projection.handoff ? '可以创建' : '等待快照';
    renderSkus();
  }

  function projectionCell(label, value) {
    var cell = node('div', 'projection-cell');
    cell.appendChild(node('span', '', label));
    cell.appendChild(node('strong', '', value));
    return cell;
  }

  function renderCategory() {
    var listing = currentListing();
    one('[data-role="category-path"]').textContent = projection.source.categoryPath.length
      ? projection.source.categoryPath.join(' / ')
      : projection.source.categoryName || '--';
    one('[data-role="category-state"]').textContent = listing ? listing.stage : '等待草稿';
    var table = one('[data-role="category-projection"]');
    clear(table);
    table.appendChild(projectionCell('草稿阶段', listing ? listing.stage : '--'));
    table.appendChild(projectionCell('运行状态', listing ? listing.runState : '--'));
    table.appendChild(projectionCell('选中 SKU', listing ? listing.selectedSkuCount : selectedSkuKeys.size));
    table.appendChild(projectionCell('草稿修订', listing ? 'r' + listing.revision : '--'));
    table.appendChild(projectionCell('草稿版本', listing ? 'v' + listing.draftVersion : '--'));
    table.appendChild(projectionCell('快照状态', projection.workbench.status.snapshot.current ? '有效' : '未确认'));
  }

  function renderReferences() {
    one('[data-role="reference-count"]').textContent = selectedMediaKeys.size + ' 已选';
    var grid = one('[data-role="reference-grid"]');
    clear(grid);
    if (!projection.media.length) appendEmpty(grid, '暂无参考素材');
    projection.media.forEach(function (item) {
      var label = node('label', 'image-tile' + (selectedMediaKeys.has(item.key) ? ' is-selected' : ''));
      var checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedMediaKeys.has(item.key);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedMediaKeys.add(item.key);
        else selectedMediaKeys.delete(item.key);
        promptSignature = '';
        renderReferences();
        syncPromptDraft();
      });
      var image = node('img');
      image.src = item.url;
      image.alt = item.role;
      replaceBrokenPreview(image, '预览不可用');
      label.appendChild(checkbox);
      label.appendChild(image);
      label.appendChild(node('small', '', item.role));
      grid.appendChild(label);
    });
  }

  function renderQueue() {
    var items = projection.workbench.status.media.items;
    one('[data-role="queue-count"]').textContent = items.length + ' 项';
    var list = one('[data-role="queue-list"]');
    clear(list);
    if (!items.length) appendEmpty(list, '暂无图片任务');
    items.forEach(function (item) {
      var row = node('div', 'queue-row');
      row.appendChild(node('strong', '', item.operation || '图片任务'));
      row.appendChild(node('span', '', item.status || '--'));
      row.appendChild(node('span', '', item.reviewStatus || '--'));
      list.appendChild(row);
    });
    one('[data-role="media-state"]').textContent = items.length ? '服务端任务' : '投影模式';
  }

  function renderMedia() {
    renderReferences();
    renderQueue();
    syncPromptDraft();
    var openButton = one('[data-action="open-ai-workbench"]');
    openButton.disabled = projection.busy || !currentListing();
    var skuSelect = one('[data-role="media-sku-select"]');
    clear(skuSelect);
    projection.skus.forEach(function (sku) {
      var option = node('option', '', sku.label || sku.key);
      option.value = sku.key;
      option.selected = sku.key === selectedMediaSkuKey;
      skuSelect.appendChild(option);
    });
    skuSelect.value = selectedMediaSkuKey;
    skuSelect.disabled = projection.busy || projection.skus.length < 2
      || Boolean(projection.source.preferredSkuKey);
  }

  function reviewMetric(label, value) {
    var metric = node('div', 'review-metric');
    metric.appendChild(node('span', '', label));
    metric.appendChild(node('strong', '', value));
    return metric;
  }

  function renderReview() {
    var listing = currentListing();
    var summary = one('[data-role="review-summary"]');
    clear(summary);
    summary.appendChild(reviewMetric('阶段', listing ? listing.stage : '--'));
    summary.appendChild(reviewMetric('状态', listing ? listing.runState : '--'));
    summary.appendChild(reviewMetric('图片', listing ? listing.mediaAssignmentCount : 0));
    summary.appendChild(reviewMetric('版本', listing ? 'v' + listing.draftVersion + ' / r' + listing.revision : '--'));
    one('[data-role="review-state"]').textContent = listing ? listing.stage : '等待草稿';
    var issues = [];
    if (listing) {
      listing.blockers.forEach(function (issue) { issues.push({ blocker: true, issue: issue }); });
      listing.warnings.forEach(function (issue) { issues.push({ blocker: false, issue: issue }); });
    }
    one('[data-role="issue-count"]').textContent = String(issues.length);
    var list = one('[data-role="issue-list"]');
    clear(list);
    if (!issues.length) appendEmpty(list, listing ? '当前没有阻断或提醒' : '尚未创建草稿');
    issues.forEach(function (entry) {
      list.appendChild(node(
        'div',
        'issue-row' + (entry.blocker ? ' is-blocker' : ''),
        [entry.issue.code, entry.issue.message].filter(Boolean).join(' · '),
      ));
    });
  }

  function processEntry(label, detail, state, ordinal) {
    var row = node('div', 'process-row is-' + state);
    row.appendChild(node('span', 'process-dot', state === 'complete' ? '✓' : String(ordinal)));
    var copy = node('div', 'process-copy');
    copy.appendChild(node('strong', '', label));
    copy.appendChild(node('span', '', detail));
    row.appendChild(copy);
    return row;
  }

  function renderProcess() {
    var listing = currentListing();
    var projected = stageFromProjection();
    var current = stageOrder(projected);
    var definitions = [
      ['商品采集', projection.source.sourceProductId ? projection.source.sourceProductId : '等待来源商品'],
      ['店铺草稿', listing ? listing.id : projection.handoff ? '快照已建立' : '等待快照'],
      ['类目属性', listing ? listing.stage : '等待草稿'],
      ['图片处理', projection.workbench.status.media.items.length + ' 项任务'],
      ['审核发布', listing ? listing.blockerCount + ' 阻断 · ' + listing.warningCount + ' 提醒' : '等待草稿'],
    ];
    var list = one('[data-role="process-list"]');
    clear(list);
    definitions.forEach(function (definition, index) {
      list.appendChild(processEntry(
        definition[0], definition[1], index < current ? 'complete' : index === current ? 'active' : 'waiting', index + 1,
      ));
    });
    one('[data-role="updated-at"]').textContent = projection.updatedAt || '--';
  }

  function validatePromptJson() {
    var textarea = one('[data-role="prompt-json"]');
    var state = one('[data-role="json-state"]');
    try {
      var value = JSON.parse(textarea.value);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      state.textContent = '有效';
      state.style.color = '#166534';
      return true;
    } catch (_error) {
      state.textContent = 'JSON 无效';
      state.style.color = '#b42318';
      return false;
    }
  }

  function buildCurrentPromptDraft() {
    var prompt = one('[data-role="prompt-text"]');
    var negative = one('[data-role="negative-prompt-text"]');
    if (!prompt || !String(prompt.value || '').trim()) return null;
    return {
      contractVersion: 'ss-erp-donor-prompt-prefill/v1',
      prompt: String(prompt.value || '').normalize('NFKC').trim().slice(0, 8000),
      negativePrompt: String(negative && negative.value || '').normalize('NFKC').trim().slice(0, 4000),
    };
  }

  function showToast(message, error) {
    var toast = one('[data-role="toast"]');
    toast.textContent = String(message || '操作完成');
    toast.className = 'toast' + (error ? ' is-error' : '');
    toast.hidden = false;
    globalThis.clearTimeout(toastTimer);
    toastTimer = globalThis.setTimeout(function () { toast.hidden = true; }, 3200);
  }

  function render() {
    syncSelections();
    if (!all('[data-stage].is-active').length) activeStage = stageFromProjection();
    renderHeader();
    renderStages();
    renderCollection();
    renderDraft();
    renderCategory();
    renderMedia();
    renderReview();
    renderProcess();
  }

  all('[data-stage]').forEach(function (button) {
    button.addEventListener('click', function () {
      stageUserSelected = true;
      activeStage = button.dataset.stage;
      renderStages();
    });
  });
  one('[data-action="close"]').addEventListener('click', function (event) {
    if (!event.isTrusted) return;
    send('CLOSE');
  });
  one('[data-action="refresh"]').addEventListener('click', function (event) {
    if (!event.isTrusted) return;
    send('REFRESH');
  });
  one('[data-action="collect"]').addEventListener('click', function (event) {
    if (!event.isTrusted || projection.busy) return;
    send('COLLECT');
  });
  one('[data-action="select-all-skus"]').addEventListener('click', function () {
    selectedSkuKeys = new Set(projection.skus.slice(0, 100).map(function (item) { return item.key; }));
    promptSignature = '';
    renderSkus();
    syncPromptDraft();
  });
  one('[data-action="clear-skus"]').addEventListener('click', function () {
    selectedSkuKeys.clear();
    promptSignature = '';
    renderSkus();
    syncPromptDraft();
  });
  one('[data-role="shop-select"]').addEventListener('change', function (event) {
    selectedShopId = event.target.value;
    render();
  });
  one('[data-action="create-draft"]').addEventListener('click', function (event) {
    if (!event.isTrusted || projection.busy) return;
    send('CREATE_DRAFT', {
      shopId: selectedShopId,
      selectedSkuKeys: Array.from(selectedSkuKeys),
    });
  });
  one('[data-action="open-ai-workbench"]').addEventListener('click', function (event) {
    if (!event.isTrusted || projection.busy) return;
    var listing = currentListing();
    if (!listing) {
      showToast('请先创建店铺草稿', true);
      return;
    }
    var preferredSkuKey = selectedMediaSkuKey || null;
    send('OPEN_MEDIA_WORKBENCH', {
      listingWorkflowId: listing.id,
      preferredSkuKey: preferredSkuKey,
      sourceSelectionKey: projection.source.preferredSkuKey || null,
      choiceBinding: null,
      promptDraft: buildCurrentPromptDraft(),
    });
  });
  one('[data-role="media-sku-select"]').addEventListener('change', function (event) {
    selectedMediaSkuKey = String(event.target.value || '');
    promptSignature = '';
    syncPromptDraft();
    renderMedia();
  });
  one('[data-role="prompt-json"]').addEventListener('input', validatePromptJson);
  one('[data-action="copy-json"]').addEventListener('click', async function (event) {
    if (!event.isTrusted || !validatePromptJson()) return;
    try {
      await navigator.clipboard.writeText(one('[data-role="prompt-json"]').value);
      showToast('JSON 已复制', false);
    } catch (_error) {
      showToast('复制失败', true);
    }
  });
  globalThis.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') send('CLOSE');
  });

  globalThis.addEventListener('message', function (event) {
    if (event.source !== globalThis.parent || !allowedParentOrigin(event.origin)) return;
    var message = event.data;
    if (!message || typeof message !== 'object'
      || message.contractVersion !== Contract.CONTRACT_VERSION) return;
    if (message.type === 'PROJECTION' && message.projection
      && message.projection.contractVersion === Contract.CONTRACT_VERSION) {
      try {
        projection = Contract.parseProjection(message.projection);
      } catch (_error) {
        return;
      }
      syncSelections();
      if (!stageUserSelected) activeStage = stageFromProjection();
      render();
      return;
    }
    if (message.type === 'COMMAND_RESULT' && typeof message.requestId === 'string'
      && pending.has(message.requestId)) {
      var type = pending.get(message.requestId);
      pending.delete(message.requestId);
      showToast(message.ok === true ? (type === 'CREATE_DRAFT' ? '草稿已创建' : '操作完成')
        : message.error || '操作失败', message.ok !== true);
    }
  });

  render();
  send('READY');
}());
