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

  function renderMediaTask(container, status, mediaItems) {
    var actionableItems = mediaItems.filter(function (item) { return item.actionable === true; });
    if (!actionableItems.length) return;
    var task = actionableItems[0];
    container.appendChild(element(
      'p',
      'ss-erp-source-workbench-task',
      operationLabel(task.operation) + ' · ' + statusLabel(task)
        + (status.media.actionableCount > 1 ? ' · 另有 ' + (status.media.actionableCount - 1) + ' 项待处理' : ''),
    ));
  }

  function renderReady(container, status) {
    var listing = status.listing.items[0] || null;
    var mediaItems = status.media.items || [];
    var heading = element('div', 'ss-erp-source-workbench-heading');
    heading.appendChild(element('strong', '', 'ERP 商品工作流'));
    heading.appendChild(element(
      'span',
      status.snapshot.current ? 'is-current' : 'is-stale',
      status.snapshot.current ? '采集快照有效' : '采集快照已更新',
    ));
    container.appendChild(heading);

    if (!listing) {
      container.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        '已保存采集快照，前往 ERP 选择店铺和 SKU 后继续。',
      ));
      renderMediaTask(container, status, mediaItems);
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
    renderMediaTask(container, status, mediaItems);
  }

  function render(container, result) {
    if (!container) return;
    clear(container);
    if (!result || result.state !== 'ready' || !result.status) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    renderReady(container, result.status);
  }

  root.SS_ERP_SOURCE_LISTING_WORKBENCH = {
    render: render,
  };
})(window);
