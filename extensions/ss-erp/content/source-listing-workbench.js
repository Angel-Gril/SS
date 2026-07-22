(function (root) {
  'use strict';

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function stageLabel(value) {
    var labels = {
      CATEGORY_REVIEW: '类目确认',
      ATTRIBUTE_REVIEW: '属性确认',
      CONTENT_REVIEW: '文案确认',
      MEDIA_REVIEW: '图片处理',
      PRICING_REVIEW: '定价确认',
      READY_TO_PUBLISH: '等待发布确认',
      PUBLISH_INTENT_RECORDED: '发布任务已确认',
      PUBLISHED: '已发布',
    };
    return labels[value] || String(value || '处理中');
  }

  function operationLabel(value) {
    var labels = {
      IMAGE_TO_IMAGE: '参考改图',
      IMAGE_TRANSLATE: '图片翻译',
      FULL_EDIT: '全图编辑',
      INPAINT: '局部重绘',
    };
    return labels[value] || String(value || '图片任务');
  }

  function statusLabel(task) {
    if (task && task.status === 'SUCCEEDED' && task.reviewStatus === 'PENDING') {
      return '等待审核';
    }
    if (task && task.status === 'SUCCEEDED' && task.reviewStatus === 'APPROVED') {
      return '审核通过，等待应用';
    }
    var labels = {
      QUEUED: '等待处理',
      RUNNING: '处理中',
      CANCEL_REQUESTED: '正在取消',
      CANCELLED: '已取消',
      FAILED: '处理失败，请在 ERP 检查',
      SUCCEEDED: '处理完成',
    };
    return labels[task && task.status] || String(task && task.status || '状态未知');
  }

  function actionLabel(action) {
    return action === 'CANCEL' ? '取消' : '重试';
  }

  function commandKey(task, action) {
    return String(task && task.id || '') + ':' + action;
  }

  function renderReviewAction(container, mediaItems, options) {
    if (!options || typeof options.onReview !== 'function') return;
    var reviewable = mediaItems.find(function (item) {
      return item && item.status === 'SUCCEEDED'
        && (item.reviewStatus === 'PENDING' || item.reviewStatus === 'APPROVED');
    });
    if (!reviewable) return;
    var button = element('button', 'ss-erp-source-workbench-review', '在 ERP 审核');
    button.type = 'button';
    button.addEventListener('click', function (event) {
      if (!event || event.isTrusted !== true) return;
      options.onReview(reviewable);
    });
    container.appendChild(button);
  }

  function renderTranslationLaunch(container, listing, options) {
    var launch = options && options.launch;
    var context = launch && launch.context;
    var capability = launch && launch.capability;
    if (!listing || !launch || launch.state !== 'ready' || !context || !capability
      || capability.enabled !== true || capability.ready !== true || capability.testOnly !== true
      || capability.operation !== 'IMAGE_TRANSLATE'
      || context.id !== listing.id || context.shopId !== listing.shopId
      || context.revision !== listing.revision || context.draftVersion !== listing.draftVersion
      || typeof options.onCreateTranslation !== 'function') return;
    var allowedKeys = new Set((context.sourceInputs || []).map(function (item) {
      return item && item.sourceMediaKey;
    }).filter(Boolean));
    var sourceInputs = (Array.isArray(options.sourceInputs) ? options.sourceInputs : [])
      .filter(function (item) {
        return item && allowedKeys.has(item.sourceMediaKey);
      }).slice(0, 50);
    if (!sourceInputs.length) return;

    var drawer = element('details', 'ss-erp-source-workbench-drawer ss-erp-source-workbench-create');
    drawer.open = true;
    drawer.appendChild(element('summary', '', '图片翻译（测试）'));
    var controls = element('div', 'ss-erp-source-workbench-create-controls');
    var select = element('select', 'ss-erp-source-workbench-source-select');
    select.setAttribute('aria-label', '选择待翻译图片');
    sourceInputs.forEach(function (source, index) {
      var label = source.label || source.role || ('图片 ' + (index + 1));
      var option = element('option', '', label);
      option.value = source.sourceMediaKey;
      select.appendChild(option);
    });
    var button = element('button', 'ss-erp-source-workbench-create-button', '翻译为俄文');
    button.type = 'button';
    button.disabled = Boolean(options.busyCreateKey);
    button.addEventListener('click', function (event) {
      if (!event || event.isTrusted !== true || button.disabled) return;
      var selected = sourceInputs.find(function (item) {
        return item.sourceMediaKey === select.value;
      }) || sourceInputs[0];
      options.onCreateTranslation(selected);
    });
    controls.appendChild(select);
    controls.appendChild(button);
    drawer.appendChild(controls);
    container.appendChild(drawer);
  }

  function renderListingSelector(container, listings, options) {
    if (!Array.isArray(listings) || listings.length <= 1
      || !options || typeof options.onSelectListing !== 'function') return;
    var wrapper = element('div', 'ss-erp-source-workbench-listing-picker');
    var label = element('label', '', '店铺草稿');
    var select = element('select', 'ss-erp-source-workbench-listing-select');
    select.setAttribute('aria-label', '选择店铺草稿');
    var selectedId = String(options.selectedListingWorkflowId || '');
    var placeholder = element('option', '', '请选择店铺草稿');
    placeholder.value = '';
    select.appendChild(placeholder);
    listings.slice(0, 10).forEach(function (listing, index) {
      if (!listing || !listing.id) return;
      var option = element('option', '', '店铺 ' + (listing.shopId || '-') + ' · 草稿 ' + (index + 1));
      option.value = listing.id;
      option.selected = listing.id === selectedId;
      select.appendChild(option);
    });
    select.addEventListener('change', function (event) {
      if (!event || event.isTrusted !== true) return;
      options.onSelectListing(select.value);
    });
    label.appendChild(select);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  }

  function renderMediaCommands(container, mediaItems, options) {
    var commandable = mediaItems.filter(function (item) {
      return item && item.commandContext
        && Array.isArray(item.allowedActions)
        && item.allowedActions.length > 0;
    }).slice(0, 10);
    if (!commandable.length || !options || typeof options.onCommand !== 'function') return;
    var drawer = element('details', 'ss-erp-source-workbench-drawer');
    drawer.appendChild(element('summary', '', '任务操作'));
    var list = element('div', 'ss-erp-source-workbench-command-list');
    commandable.forEach(function (task) {
      var row = element('div', 'ss-erp-source-workbench-command-row');
      var label = element('span', '', operationLabel(task.operation) + ' · ' + statusLabel(task));
      row.appendChild(label);
      var actions = element('div', 'ss-erp-source-workbench-command-actions');
      task.allowedActions.forEach(function (action) {
        var button = element('button', '', actionLabel(action));
        button.type = 'button';
        button.title = actionLabel(action) + operationLabel(task.operation);
        button.disabled = options.busyCommandKey === commandKey(task, action);
        button.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true) return;
          options.onCommand(task, action);
        });
        actions.appendChild(button);
      });
      row.appendChild(actions);
      list.appendChild(row);
    });
    drawer.appendChild(list);
    container.appendChild(drawer);
  }

  function renderHistoryOutput(container, output, operation) {
    var link = element('a', 'ss-erp-source-workbench-output');
    link.href = output.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = '打开原始候选图';
    var frame = element('span', 'ss-erp-source-workbench-output-frame');
    var image = element('img');
    image.src = output.url;
    image.alt = operationLabel(operation) + '候选图';
    image.loading = 'lazy';
    var fallback = element('span', 'ss-erp-source-workbench-output-fallback', '预览不可用');
    image.addEventListener('error', function () {
      frame.classList.add('is-error');
      image.removeAttribute('src');
    }, { once: true });
    frame.appendChild(image);
    frame.appendChild(fallback);
    link.appendChild(frame);
    var dimensions = output.width && output.height
      ? output.width + ' × ' + output.height
      : output.mimeType;
    link.appendChild(element('span', 'ss-erp-source-workbench-output-meta', dimensions));
    container.appendChild(link);
  }

  function renderHistoryItem(container, item) {
    var card = element('article', 'ss-erp-source-workbench-history-item');
    var heading = element('div', 'ss-erp-source-workbench-history-heading');
    heading.appendChild(element('strong', '', operationLabel(item.operation)));
    heading.appendChild(element('span', '', statusLabel(item)));
    card.appendChild(heading);
    if (Array.isArray(item.outputs) && item.outputs.length) {
      var outputs = element('div', 'ss-erp-source-workbench-output-grid');
      item.outputs.forEach(function (output) {
        renderHistoryOutput(outputs, output, item.operation);
      });
      card.appendChild(outputs);
    } else {
      card.appendChild(element('div', 'ss-erp-source-workbench-output-empty', '尚无可预览结果'));
    }
    var footer = element('div', 'ss-erp-source-workbench-history-footer');
    footer.appendChild(element('span', '', new Date(item.updatedAt).toLocaleString('zh-CN')));
    if (item.application) {
      footer.appendChild(element(
        'b',
        item.application.state === 'ROLLED_BACK' ? 'is-muted' : 'is-applied',
        item.application.state === 'ROLLED_BACK' ? '已回滚' : '已写入草稿',
      ));
    }
    card.appendChild(footer);
    container.appendChild(card);
  }

  function renderMediaHistory(container, listing, options) {
    if (!listing || !options || typeof options.onLoadHistory !== 'function') return;
    var drawer = element('details', 'ss-erp-source-workbench-drawer ss-erp-source-workbench-history');
    drawer.open = options.historyOpen === true;
    drawer.appendChild(element('summary', '', '图片结果与历史'));
    drawer.addEventListener('toggle', function (event) {
      if (!event || event.isTrusted !== true) return;
      if (typeof options.onHistoryOpenChange === 'function') {
        options.onHistoryOpenChange(drawer.open);
      }
      if (drawer.open && !options.history && !options.historyLoading) {
        options.onLoadHistory();
      }
    });
    if (options.historyLoading) {
      drawer.appendChild(element('div', 'ss-erp-source-workbench-history-state', '正在读取图片任务...'));
    } else if (options.historyError) {
      var error = element('div', 'ss-erp-source-workbench-history-state is-error');
      error.appendChild(element('span', '', options.historyError));
      var retry = element('button', '', '重试');
      retry.type = 'button';
      retry.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true) return;
        options.onLoadHistory();
      });
      error.appendChild(retry);
      drawer.appendChild(error);
    } else if (options.history) {
      var items = Array.isArray(options.history.items) ? options.history.items : [];
      var list = element('div', 'ss-erp-source-workbench-history-list');
      if (!items.length) {
        list.appendChild(element('div', 'ss-erp-source-workbench-history-state', '暂无图片任务'));
      } else {
        items.forEach(function (item) { renderHistoryItem(list, item); });
      }
      drawer.appendChild(list);
      if (options.history.nextCursor && typeof options.onLoadMoreHistory === 'function') {
        var more = element('button', 'ss-erp-source-workbench-history-more', '加载更多');
        more.type = 'button';
        more.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true) return;
          options.onLoadMoreHistory();
        });
        drawer.appendChild(more);
      }
    }
    container.appendChild(drawer);
  }

  function renderMediaTask(container, status, mediaItems, options) {
    var actionableItems = mediaItems.filter(function (item) { return item.actionable === true; });
    if (actionableItems.length) {
      var task = actionableItems[0];
      container.appendChild(element(
        'p',
        'ss-erp-source-workbench-task',
        operationLabel(task.operation) + ' · ' + statusLabel(task)
          + (status.media.actionableCount > 1 ? ' · 另有 ' + (status.media.actionableCount - 1) + ' 项待处理' : ''),
      ));
    }
    renderReviewAction(container, mediaItems, options);
    renderMediaCommands(container, mediaItems, options);
  }

  function renderReady(container, status, options) {
    var listings = Array.isArray(status.listing.items) ? status.listing.items : [];
    var selectedId = String(options && options.selectedListingWorkflowId || '');
    var listing = selectedId
      ? listings.find(function (item) { return item && item.id === selectedId; }) || null
      : (listings.length === 1 ? listings[0] : null);
    var mediaItems = status.media.items || [];
    var heading = element('div', 'ss-erp-source-workbench-heading');
    heading.appendChild(element('strong', '', 'ERP 商品工作流'));
    heading.appendChild(element(
      'span',
      status.snapshot.current ? 'is-current' : 'is-stale',
      status.snapshot.current ? '采集快照有效' : '采集快照已更新',
    ));
    container.appendChild(heading);

    renderListingSelector(container, listings, options);

    if (!listing) {
      container.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        listings.length > 1
          ? '请选择要处理的店铺草稿。'
          : '已保存采集快照，前往 ERP 选择店铺和 SKU 后继续。',
      ));
      renderMediaTask(container, status, mediaItems, options);
      return;
    }

    var metrics = element('div', 'ss-erp-source-workbench-metrics');
    var stage = element('div', 'ss-erp-source-workbench-metric');
    stage.appendChild(element('span', '', '当前阶段'));
    stage.appendChild(element('b', '', stageLabel(listing.stage)));
    metrics.appendChild(stage);
    var sku = element('div', 'ss-erp-source-workbench-metric');
    sku.appendChild(element('span', '', 'SKU / 图片'));
    sku.appendChild(element('b', '', listing.selectedSkuCount + ' / ' + listing.mediaAssignmentCount));
    metrics.appendChild(sku);
    var blockers = element('div', 'ss-erp-source-workbench-metric');
    blockers.appendChild(element('span', '', '阻塞 / 提醒'));
    blockers.appendChild(element('b', '', listing.blockerCount + ' / ' + listing.warningCount));
    metrics.appendChild(blockers);
    container.appendChild(metrics);

    if (listing.blockers && listing.blockers[0]) {
      container.appendChild(element(
        'p',
        'ss-erp-source-workbench-blocker',
        listing.blockers[0].message,
      ));
    }
    renderTranslationLaunch(container, listing, options);
    renderMediaTask(container, status, mediaItems, options);
    renderMediaHistory(container, listing, options);
  }

  function render(container, result, options) {
    if (!container) return;
    clear(container);
    if (!result || result.state !== 'ready' || !result.status) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    renderReady(container, result.status, options || null);
  }

  root.SS_ERP_SOURCE_LISTING_WORKBENCH = {
    render: render,
  };
})(window);
