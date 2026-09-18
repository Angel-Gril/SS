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
    if (task && task.status === 'SUCCEEDED' && task.reviewStatus === 'REJECTED') {
      return '审核已驳回';
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

  function mediaOperationDefinitions() {
    return [
      { operation: 'IMAGE_TO_IMAGE', label: '参考生图' },
      { operation: 'IMAGE_TRANSLATE', label: '图片翻译' },
      { operation: 'FULL_EDIT', label: '全图编辑' },
      { operation: 'INPAINT', label: '局部重绘' },
    ];
  }

  var IMAGE_WORKFLOW_DEFINITIONS = Object.freeze([
      {
        mode: 'TRANSLATE_ONLY',
        label: '仅图片翻译',
        description: '识别商品图文字并翻译为俄文',
        kind: 'translation',
        target: 'TRANSLATE_ONLY',
        operations: ['IMAGE_TRANSLATE'],
      },
      {
        mode: 'AI_MAIN_TRANSLATE',
        label: 'AI 主图 + 翻译',
        description: '先生成主图候选，再处理图片文案',
        kind: 'suite',
        target: 'AI_SUITE',
        operations: ['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE'],
      },
      {
        mode: 'AI_SUITE',
        label: 'AI 套图',
        description: '按审核计划生成主图与详情图套组',
        kind: 'suite',
        target: 'AI_SUITE',
        operations: ['IMAGE_TO_IMAGE'],
      },
      {
        mode: 'IMAGE_TO_IMAGE',
        label: '参考图生图',
        description: '选择 1–4 张参考图生成新候选',
        kind: 'editor',
        target: 'MEDIA_EDITOR',
        operation: 'IMAGE_TO_IMAGE',
        operations: ['IMAGE_TO_IMAGE'],
      },
      {
        mode: 'FULL_EDIT',
        label: '全图编辑',
        description: '使用提示词调整整张商品图',
        kind: 'editor',
        target: 'MEDIA_EDITOR',
        operation: 'FULL_EDIT',
        operations: ['FULL_EDIT'],
      },
      {
        mode: 'INPAINT',
        label: '局部重绘',
        description: '绘制遮罩后只修改指定区域',
        kind: 'editor',
        target: 'MEDIA_EDITOR',
        operation: 'INPAINT',
        operations: ['INPAINT'],
      },
    ].map(function (definition) {
      definition.operations = Object.freeze(definition.operations.slice());
      return Object.freeze(definition);
    }));

  function imageWorkflowDefinitions() {
    return IMAGE_WORKFLOW_DEFINITIONS;
  }

  function imageWorkflowDefinition(mode) {
    return IMAGE_WORKFLOW_DEFINITIONS.find(function (definition) {
      return definition.mode === mode;
    }) || null;
  }

  function mediaCapabilityReason(definition, capability) {
    var label = definition && definition.label || '媒体操作';
    var reasonCode = String(capability && capability.reasonCode || '').trim();
    if (reasonCode === 'AI_MEDIA_WORKFLOW_DISABLED') {
      return 'AI 媒体工作流未对当前账号开放。';
    }
    if (reasonCode === 'SOURCE_LISTING_WEB_MEDIA_DISABLED') {
      return 'Web 媒体工作台未对当前账号开放。';
    }
    if (reasonCode === 'AI_MEDIA_OPERATION_DISABLED'
      || reasonCode === 'MEDIA_CREATE_DISABLED') {
      return label + '当前关闭。';
    }
    if (reasonCode === 'PROVIDER_NOT_READY'
      || reasonCode === 'MEDIA_PROVIDER_NOT_ALLOWED') {
      return 'Provider 尚未完成生产验证。';
    }
    if (reasonCode === 'STORAGE_NOT_READY'
      || reasonCode === 'MEDIA_STORAGE_NOT_READY') {
      return '需要可用的对象存储，当前存储配置不兼容。';
    }
    return label + '当前不可用，请在 ERP 管理后台查看能力状态。';
  }

  function workbenchAvailabilityMessage(result) {
    var scopeLabels = {
      'listing:review': '商品工作台审核',
      'media:execute': 'AI 媒体执行',
      'listing:write': '商品草稿编辑',
      'capture:write': '来源商品采集',
    };
    return result && result.state === 'unpaired'
      ? '扩展尚未连接 ERP，请先完成扩展连接。'
      : result && result.state === 'loading'
        ? '正在读取 ERP 商品工作流与 AI 媒体能力。'
      : result && result.state === 'scope_required'
        ? '设备缺少“' + (scopeLabels[result.scope] || result.scope || '所需功能')
          + '”权限，请在 ERP 扩展连接中更新授权。'
        : result && result.state === 'disabled'
          ? '扩展工作台未开放，请在管理员后台开启扩展工作台及当前账号发布策略。'
          : result && result.reason === 'source_handoff_mismatch'
            ? '当前商品尚未进入 ERP 工作流，请先采集货源到 ERP。'
            : result && result.reason === 'source_product_id_missing'
              ? '当前页面未提取到稳定的商品 ID，暂不能创建 ERP 图片工作流。'
              : result && result.reason === 'source_product_unavailable'
                ? '当前页面商品读取失败，刷新商品页后可重新尝试 AI 图片处理。'
            : 'ERP 商品工作流状态暂不可用，请检查扩展连接后重试。';
  }

  function aiImageSuiteWorkflowReadiness(listing, options) {
    if (!options || typeof options.onLoadAiImageSuite !== 'function') {
      return { ready: false, reason: 'AI 套图状态读取功能当前不可用。' };
    }
    if (options.aiImageSuiteError) {
      return { ready: false, reason: 'AI 套图状态读取失败，请重新读取。' };
    }
    if (options.aiImageSuiteLoading === true || options.aiImageSuite == null) {
      return { ready: false, reason: '正在读取 AI 套图计划与执行权限。' };
    }
    var result = aiImageSuiteResult(options.aiImageSuite);
    if (!result || result.state !== 'ready' || !result.projection) {
      return { ready: false, reason: 'AI 套图服务当前未开放。' };
    }
    var projection = result.projection;
    var context = projection.context || {};
    if (context.listingWorkflowId !== listing.id
      || context.shopId !== listing.shopId
      || context.draftRevision !== listing.revision
      || context.draftVersion !== listing.draftVersion) {
      return { ready: false, reason: 'AI 套图计划对应的草稿版本已更新，请重新读取。' };
    }
    if (!projection.plan) {
      return { ready: false, reason: '请先在 Web ERP 创建并审核 AI 主图或套图计划。' };
    }
    return { ready: true, reason: '可以查看已审核计划', readyLabel: '可查看计划' };
  }

  function workflowReadiness(definition, result, listing, options) {
    if (!result || result.state !== 'ready' || !result.status) {
      return { ready: false, reason: workbenchAvailabilityMessage(result || {}) };
    }
    if (!listing) {
      return { ready: false, reason: '请先在 ERP 创建或选择店铺草稿。' };
    }
    if (definition.mode === 'AI_MAIN_TRANSLATE') {
      return {
        ready: false,
        reason: '组合流程尚未开放；当前请先生成 AI 主图，再单独执行图片翻译。',
      };
    }
    if (definition.mode === 'AI_SUITE') {
      return aiImageSuiteWorkflowReadiness(listing, options);
    }
    var launch = options && options.launch;
    var operations = launch && launch.contractVersion === 2 && launch.operations;
    if (!operations) {
      return {
        ready: false,
        reason: launch ? workbenchAvailabilityMessage(launch) : 'AI 媒体能力状态暂不可用，请刷新后重试。',
      };
    }
    for (var index = 0; index < definition.operations.length; index += 1) {
      var operation = definition.operations[index];
      var capability = operations[operation];
      if (!capability || capability.ready !== true) {
        return {
          ready: false,
          reason: mediaCapabilityReason(
            mediaOperationDefinitions().find(function (item) {
              return item.operation === operation;
            }) || { label: definition.label },
            capability,
          ),
        };
      }
      if (operation === 'IMAGE_TRANSLATE' && capability.testOnly !== true) {
        return { ready: false, reason: '扩展内真实图片翻译尚未开放，请在 ERP 图片工作台执行。' };
      }
    }
    var context = launch.context;
    if (!context
      || context.id !== listing.id
      || context.shopId !== listing.shopId
      || context.revision !== listing.revision
      || context.draftVersion !== listing.draftVersion) {
      return { ready: false, reason: '当前草稿的 AI 媒体状态已更新，请刷新后重试。' };
    }
    var allowedSourceKeys = new Set((context.sourceInputs || []).map(function (item) {
      return item && item.sourceMediaKey;
    }).filter(Boolean));
    var hasSourceInput = (Array.isArray(options && options.sourceInputs)
      ? options.sourceInputs
      : []).some(function (item) {
      return item && allowedSourceKeys.has(item.sourceMediaKey);
    });
    if (!hasSourceInput) {
      return { ready: false, reason: '当前草稿没有可用于该流程的来源图片。' };
    }
    return { ready: true, reason: '可以开始配置' };
  }

  function workbenchJourneyIndex(result, listing, mediaItems) {
    if (!result || result.state !== 'ready' || !result.status
      || result.reason === 'source_handoff_mismatch') return 0;
    if (!listing) return 1;
    var reviewReady = (Array.isArray(mediaItems) ? mediaItems : []).some(function (item) {
      return item && item.status === 'SUCCEEDED'
        && ['PENDING', 'APPROVED'].includes(item.reviewStatus);
    });
    return reviewReady || [
      'PRICING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISH_INTENT_RECORDED', 'PUBLISHED',
    ].includes(listing.stage) ? 3 : 2;
  }

  function renderWorkbenchJourney(container, result, listing, mediaItems) {
    var current = workbenchJourneyIndex(result, listing, mediaItems);
    var masthead = element('header', 'ss-erp-source-workbench-masthead');
    var copy = element('div', 'ss-erp-source-workbench-masthead-copy');
    copy.appendChild(element('span', '', '货源页工作区'));
    copy.appendChild(element('h2', '', '独立 AI 图片工作台'));
    masthead.appendChild(copy);
    masthead.appendChild(element(
      'b',
      current >= 2 ? 'is-ready' : 'is-pending',
      current >= 2 ? '可以处理' : '正在准备',
    ));
    container.appendChild(masthead);

    var navigation = element('nav', 'ss-erp-source-workbench-journey');
    navigation.setAttribute('aria-label', 'AI 图片工作流阶段');
    var list = element('ol', '');
    ['采集商品', '店铺草稿', '图片处理', '审核应用'].forEach(function (label, index) {
      var item = element(
        'li',
        index === current ? 'is-active' : index < current ? 'is-complete' : '',
      );
      if (index === current) item.setAttribute('aria-current', 'step');
      item.appendChild(element('span', '', String(index + 1)));
      item.appendChild(element('b', '', label));
      list.appendChild(item);
    });
    navigation.appendChild(list);
    container.appendChild(navigation);
  }

  function renderImageWorkflowOverview(container, result, listing, options) {
    var wrapper = element('section', 'ss-erp-source-workbench-workflows');
    wrapper.setAttribute('data-role', 'ai-image-workflows');
    var heading = element('div', 'ss-erp-source-workbench-workflow-heading');
    var title = element('div');
    var listingItems = result && result.status && result.status.listing
      && Array.isArray(result.status.listing.items) ? result.status.listing.items : [];
    var setupMessage = result && result.state === 'ready' && result.status && !listing
      ? (listingItems.length > 1
        ? '请选择要处理的店铺草稿。'
        : '请先在 ERP 创建店铺草稿。')
      : workbenchAvailabilityMessage(result || {});
    title.appendChild(element('strong', '', listing ? '图片处理方式' : '开始前准备'));
    title.appendChild(element(
      'span',
      '',
      listing ? '选择本次处理方式' : setupMessage,
    ));
    heading.appendChild(title);
    heading.appendChild(element('b', '', listing ? '6 种方式' : '当前步骤'));
    wrapper.appendChild(heading);

    if (!result || result.state !== 'ready' || !result.status || !listing) {
      wrapper.classList.add('is-setup');
      if (result && result.reason === 'source_handoff_mismatch'
        && options && typeof options.onCollectForMedia === 'function') {
        var collect = element(
          'button',
          'ss-erp-source-workbench-workflow-primary',
          '采集货源并继续',
        );
        collect.type = 'button';
        collect.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true || collect.disabled) return;
          options.onCollectForMedia();
        });
        wrapper.appendChild(collect);
      } else if (result && result.state === 'ready' && result.status
        && Array.isArray(result.status.listing && result.status.listing.items)
        && result.status.listing.items.length === 0
        && options && typeof options.onOpenWorkflowForMedia === 'function') {
        var open = element(
          'button',
          'ss-erp-source-workbench-workflow-primary',
          '打开 ERP 创建草稿',
        );
        open.type = 'button';
        open.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true || open.disabled) return;
          options.onOpenWorkflowForMedia();
        });
        wrapper.appendChild(open);
      } else if (options && typeof options.onRefreshWorkbenchStatus === 'function') {
        var refresh = element(
          'button',
          'ss-erp-source-workbench-workflow-primary is-secondary',
          '重新检查连接',
        );
        refresh.type = 'button';
        refresh.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true || refresh.disabled) return;
          options.onRefreshWorkbenchStatus();
        });
        wrapper.appendChild(refresh);
      }
      container.appendChild(wrapper);
      return;
    }

    var grid = element('div', 'ss-erp-source-workbench-workflow-grid');
    grid.setAttribute('role', 'tablist');
    grid.setAttribute('aria-label', '选择图片处理方式');
    var selectedMode = String(options && options.selectedMediaWorkflowMode || '');
    imageWorkflowDefinitions().forEach(function (definition) {
      var readiness = workflowReadiness(definition, result, listing, options);
      var selected = definition.mode === selectedMode;
      var button = element(
        'button',
        'ss-erp-source-workbench-workflow'
          + (readiness.ready ? ' is-ready' : ' is-blocked')
          + (selected ? ' is-selected' : ''),
      );
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.setAttribute('aria-disabled', readiness.ready ? 'false' : 'true');
      button.disabled = !readiness.ready
        || !options || typeof options.onSelectMediaWorkflow !== 'function';
      button.title = readiness.reason;
      button.setAttribute('data-workflow-mode', definition.mode);
      button.appendChild(element('strong', '', definition.label));
      button.appendChild(element(
        'em',
        '',
        readiness.ready ? readiness.readyLabel || '可配置' : readiness.reason,
      ));
      button.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || button.disabled) return;
        options.onSelectMediaWorkflow(definition.mode);
      });
      grid.appendChild(button);
    });
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  function renderAiWorkbenchLauncher(container, listing, options) {
    if (!listing || !options) return;
    var launcher = element('section', 'ss-erp-source-workbench-ai-launcher');
    launcher.setAttribute('data-role', 'ai-workbench-launcher');
    launcher.setAttribute('aria-label', 'AI 图片工作台启动');
    var copy = element('div', 'ss-erp-source-workbench-ai-copy');
    copy.appendChild(element('strong', '', '独立 AI 图片工作台'));
    copy.appendChild(element('span', '', '当前商品 · 店铺 ' + (listing.shopId || '-')));
    launcher.appendChild(copy);

    var state = String(options.aiWorkbenchState || 'idle');
    var skuOptions = Array.isArray(options.aiWorkbenchSkuOptions)
      ? options.aiWorkbenchSkuOptions.filter(function (item) {
        return item && typeof item.skuKey === 'string' && item.skuKey;
      }).slice(0, 500)
      : [];
    var selectedSkuKey = String(options.selectedAiWorkbenchSkuKey || '');
    if (state === 'choice_required' && skuOptions.length >= 1) {
      var picker = element('label', 'ss-erp-source-workbench-ai-picker', '处理 SKU');
      var select = element('select', 'ss-erp-source-workbench-ai-select');
      select.setAttribute('aria-label', '选择 AI 图片工作台 SKU');
      select.setAttribute('data-role', 'ai-workbench-sku-select');
      select.disabled = options.aiWorkbenchBusy === true;
      var placeholder = element('option', '', '请选择 SKU');
      placeholder.value = '';
      select.appendChild(placeholder);
      skuOptions.forEach(function (item) {
        var option = element('option', '', String(item.label || item.skuKey));
        option.value = item.skuKey;
        option.selected = item.skuKey === selectedSkuKey;
        select.appendChild(option);
      });
      select.value = skuOptions.some(function (item) { return item.skuKey === selectedSkuKey; })
        ? selectedSkuKey : '';
      select.addEventListener('change', function (event) {
        if (!event || event.isTrusted !== true || select.disabled
          || typeof options.onSelectAiWorkbenchSku !== 'function') return;
        options.onSelectAiWorkbenchSku(select.value);
      });
      picker.appendChild(select);
      launcher.appendChild(picker);
    }

    if (state === 'stale' || state === 'unavailable') {
      var stateMessage = element(
        'p',
        'ss-erp-source-workbench-ai-state is-stale',
        options.aiWorkbenchMessage || (state === 'stale'
          ? '商品或草稿已变化，请刷新后重新选择。'
          : '扩展设备会话不可用，请检查 ERP 连接。'),
      );
      stateMessage.setAttribute('role', 'alert');
      launcher.appendChild(stateMessage);
    }

    var button = element(
      'button',
      'ss-erp-source-workbench-ai-button',
      state === 'refreshing'
        ? '正在刷新...'
        : options.aiWorkbenchBusy === true ? '正在打开...' : '打开独立工作台',
    );
    button.type = 'button';
    button.setAttribute('data-role', 'ai-workbench-open');
    button.disabled = options.aiWorkbenchAvailable !== true
      || typeof options.onOpenAiWorkbench !== 'function'
      || options.aiWorkbenchBusy === true
      || state === 'stale'
      || state === 'unavailable'
      || (state === 'choice_required' && !skuOptions.some(function (item) {
        return item.skuKey === selectedSkuKey;
      }));
    button.addEventListener('click', function (event) {
      if (!event || event.isTrusted !== true || button.disabled) return;
      options.onOpenAiWorkbench(listing);
    });
    launcher.appendChild(button);

    if ((state === 'stale' || state === 'unavailable')
      && typeof options.onRefreshAiWorkbench === 'function') {
      var refresh = element('button', 'ss-erp-source-workbench-ai-refresh', '刷新上下文');
      refresh.type = 'button';
      refresh.setAttribute('data-role', 'ai-workbench-refresh');
      refresh.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || refresh.disabled) return;
        options.onRefreshAiWorkbench();
      });
      launcher.appendChild(refresh);
    }
    container.appendChild(launcher);
  }

  function renderWorkbenchAvailability(container, result, options) {
    renderWorkbenchJourney(container, result, null, []);
    var heading = element('div', 'ss-erp-source-workbench-heading');
    heading.appendChild(element('strong', '', 'ERP 商品工作流'));
    heading.appendChild(element('span', 'is-stale', '尚未就绪'));
    container.appendChild(heading);
    renderImageWorkflowOverview(container, result, null, options || null);
  }

  function renderMediaLaunchStatus(container, listing, options) {
    var launch = options && options.launch;
    if (!listing || !launch || launch.state === 'ready') return;
    var drawer = element('details', 'ss-erp-source-workbench-drawer ss-erp-source-workbench-create');
    drawer.open = true;
    drawer.setAttribute('data-workflow-target', 'CAPABILITY_STATUS');
    drawer.appendChild(element('summary', '', 'AI 修图与生图'));
    var operations = launch.contractVersion === 2 && launch.operations;
    if (operations) {
      mediaOperationDefinitions().forEach(function (definition) {
        var capability = operations[definition.operation];
        if (!capability || capability.ready === true) return;
        drawer.appendChild(element(
          'p',
          'ss-erp-source-workbench-empty',
          definition.label + '：' + mediaCapabilityReason(definition, capability),
        ));
      });
    } else {
      var legacyCapability = launch.capability;
      drawer.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        legacyCapability && legacyCapability.reasonCode
          ? mediaCapabilityReason({ label: '图片翻译' }, legacyCapability)
          : '媒体能力当前未开放。',
      ));
    }
    container.appendChild(drawer);
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
    var capability = launch && launch.contractVersion === 2
      ? launch.operations && launch.operations.IMAGE_TRANSLATE
      : launch && launch.capability;
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
    drawer.setAttribute('data-workflow-target', 'TRANSLATE_ONLY');
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
    button.disabled = Boolean(options.busyCreateKey || options.busyCommandKey);
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

  function mediaCreateDraft(value) {
    var operation = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(value && value.operation)
      ? value.operation
      : 'IMAGE_TO_IMAGE';
    return {
      operation: operation,
      sourceMediaKeys: Array.isArray(value && value.sourceMediaKeys)
        ? value.sourceMediaKeys.filter(function (key) { return typeof key === 'string' && key; })
        : [],
    };
  }

  var aiImageSuiteInteractionStates = new WeakMap();
  var aiImageSuitePollingStates = new WeakMap();
  var activeAiImageSuitePollingStates = new Set();
  var suspendedAiImageSuitePollingStates = new Set();
  var aiImageSuitePageDisposed = false;

  function cloneAiImageSuiteIntentValue(value) {
    if (Array.isArray(value)) return value.map(cloneAiImageSuiteIntentValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], cloneAiImageSuiteIntentValue(entry[1])];
      }));
    }
    return value;
  }

  function freezeAiImageSuiteIntentValue(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freezeAiImageSuiteIntentValue);
    return Object.freeze(value);
  }

  function aiImageSuiteCommandTemplate(projection, action, slotId) {
    if (!projection || !projection.plan) return null;
    if (action === 'START') {
      return projection.plan.allowedActions.includes(action)
        ? projection.plan.commands.START
        : null;
    }
    if (action === 'CONTINUE' || action === 'CANCEL') {
      return projection.suite && projection.suite.allowedActions.includes(action)
        ? projection.suite.commands[action]
        : null;
    }
    var slot = projection.suite && projection.suite.slots.find(function (item) {
      return item.id === slotId;
    });
    return slot && slot.allowedActions.includes(action) ? slot.commands[action] : null;
  }

  function aiImageSuiteIntentWitness(projection, action, slotId, decision) {
    var authorityHash = projection && projection.commandAuthority
      && projection.commandAuthority.authorityHash;
    var normalizedSlotId = slotId || null;
    var normalizedDecision = decision || null;
    var template = aiImageSuiteCommandTemplate(projection, action, normalizedSlotId);
    if (typeof authorityHash !== 'string' || !/^[a-f0-9]{64}$/u.test(authorityHash)
      || !template || typeof template !== 'object' || Array.isArray(template)
      || (action === 'REVIEW_SLOT'
        ? !['APPROVE', 'REJECT'].includes(normalizedDecision)
        : normalizedDecision !== null)) return null;
    try {
      var serialized = JSON.stringify(template);
      if (!serialized || serialized.length > 4096) return null;
      return freezeAiImageSuiteIntentValue({
        version: 'extension-ai-image-suite-intent-witness/v1',
        context: cloneAiImageSuiteIntentValue(projection.context),
        authorityHash: authorityHash,
        action: action,
        slotId: normalizedSlotId,
        decision: normalizedDecision,
        commandTemplate: cloneAiImageSuiteIntentValue(template),
      });
    } catch {
      return null;
    }
  }

  function aiImageSuiteInteractionKey(projection) {
    var authority = projection && projection.commandAuthority;
    var preview = projection && projection.plan && projection.plan.preview;
    var suite = projection && projection.suite;
    return [
      authority && authority.authorityHash || '',
      preview && preview.hash || '',
      preview && preview.pricingVersion || '',
      preview && preview.estimatedCostCents || 0,
      preview && preview.maximumCostCents || 0,
      suite && suite.id || '',
      suite && suite.revision || 0,
    ].join(':');
  }

  function aiImageSuiteInteractionState(container, interactionKey) {
    var state = aiImageSuiteInteractionStates.get(container);
    if (!state || state.interactionKey !== interactionKey) {
      state = {
        interactionKey: interactionKey || '',
        startCostAccepted: false,
        retryCostAccepted: new Set(),
        pendingKey: '',
      };
      aiImageSuiteInteractionStates.set(container, state);
    }
    return state;
  }

  function stopAiImageSuitePolling(container) {
    var state = aiImageSuitePollingStates.get(container);
    if (!state) return;
    if (state.timer != null && typeof root.clearTimeout === 'function') {
      root.clearTimeout(state.timer);
    }
    state.timer = null;
    state.stopped = true;
    activeAiImageSuitePollingStates.delete(state);
    suspendedAiImageSuitePollingStates.delete(state);
  }

  function stopAllAiImageSuitePolling() {
    aiImageSuitePageDisposed = true;
    activeAiImageSuitePollingStates.forEach(function (state) {
      if (state.timer != null && typeof root.clearTimeout === 'function') {
        root.clearTimeout(state.timer);
      }
      state.timer = null;
      state.stopped = true;
      suspendedAiImageSuitePollingStates.add(state);
    });
    activeAiImageSuitePollingStates.clear();
  }

  function resumeAllAiImageSuitePolling() {
    aiImageSuitePageDisposed = false;
    var states = Array.from(suspendedAiImageSuitePollingStates);
    suspendedAiImageSuitePollingStates.clear();
    states.forEach(function (state) {
      state.stopped = false;
      scheduleAiImageSuitePolling(state.container, state.listing, state.options, state.result);
    });
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('pagehide', stopAllAiImageSuitePolling);
    root.addEventListener('pageshow', resumeAllAiImageSuitePolling);
  }

  function aiImageSuiteResult(value) {
    if (!value) return null;
    if (value.contractVersion === 'extension-ai-image-suite-projection/v1') {
      return { state: 'ready', projection: value };
    }
    return value;
  }

  function aiImageSuiteNeedsPolling(result) {
    if (!result || result.state !== 'ready' || !result.projection) return true;
    var suite = result.projection.suite;
    return Boolean(suite && [
      'PLANNED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED',
    ].includes(suite.status));
  }

  function scheduleAiImageSuitePolling(container, listing, options, result) {
    if (aiImageSuitePageDisposed
      || !listing || !options || typeof options.onLoadAiImageSuite !== 'function'
      || typeof root.setTimeout !== 'function'
      || !aiImageSuiteNeedsPolling(result)) {
      stopAiImageSuitePolling(container);
      return;
    }
    var bindingKey = [listing.id, listing.shopId, listing.revision, listing.draftVersion].join(':');
    var state = aiImageSuitePollingStates.get(container);
    if (!state || state.bindingKey !== bindingKey) {
      stopAiImageSuitePolling(container);
      state = {
        bindingKey: bindingKey,
        count: 0,
        timer: null,
        inFlight: false,
        stopped: false,
        exhausted: false,
        result: null,
      };
      aiImageSuitePollingStates.set(container, state);
    }
    state.stopped = false;
    state.options = options;
    state.container = container;
    state.listing = listing;
    state.result = result;
    activeAiImageSuitePollingStates.add(state);
    var maximum = Number.isSafeInteger(options.aiImageSuitePollLimit)
      ? Math.max(1, Math.min(60, options.aiImageSuitePollLimit))
      : 20;
    if (state.count >= maximum) {
      state.exhausted = true;
      activeAiImageSuitePollingStates.delete(state);
      return;
    }
    if (state.timer != null || state.inFlight) return;
    var interval = Number.isFinite(Number(options.aiImageSuitePollIntervalMs))
      ? Math.max(1000, Math.min(10000, Number(options.aiImageSuitePollIntervalMs)))
      : 3000;
    var delay = !result && options.aiImageSuiteLoading !== true ? 0 : interval;
    state.timer = root.setTimeout(function () {
      state.timer = null;
      if (state.stopped || aiImageSuitePageDisposed || state.count >= maximum) return;
      state.count += 1;
      state.inFlight = true;
      var returned;
      try {
        returned = state.options.onLoadAiImageSuite({
          reason: result ? 'poll' : 'initial',
          listing: state.listing,
          attempt: state.count,
          maximumAttempts: maximum,
        });
      } catch (error) {
        if (typeof state.options.onAiImageSuiteError === 'function') {
          state.options.onAiImageSuiteError(error);
        }
        state.inFlight = false;
        return;
      }
      Promise.resolve(returned).catch(function (error) {
        if (typeof state.options.onAiImageSuiteError === 'function') {
          state.options.onAiImageSuiteError(error);
        }
      }).finally(function () {
        state.inFlight = false;
        if (!state.stopped && !aiImageSuitePageDisposed) {
          scheduleAiImageSuitePolling(container, state.listing, state.options, state.result);
        }
      });
    }, delay);
  }

  function refreshExhaustedAiImageSuitePolling(container, listing, options, result) {
    var state = aiImageSuitePollingStates.get(container);
    if (!state || !state.exhausted || state.inFlight
      || typeof options.onLoadAiImageSuite !== 'function') return;
    state.count = 0;
    state.exhausted = false;
    state.stopped = false;
    state.inFlight = true;
    activeAiImageSuitePollingStates.add(state);
    var returned;
    try {
      returned = options.onLoadAiImageSuite({
        reason: 'manual',
        force: true,
        listing: listing,
        attempt: 0,
      });
    } catch (error) {
      state.inFlight = false;
      if (typeof options.onAiImageSuiteError === 'function') options.onAiImageSuiteError(error);
      return;
    }
    Promise.resolve(returned).catch(function (error) {
      if (typeof options.onAiImageSuiteError === 'function') options.onAiImageSuiteError(error);
    }).finally(function () {
      state.inFlight = false;
      if (!state.stopped && !aiImageSuitePageDisposed) {
        scheduleAiImageSuitePolling(container, listing, options, state.result || result);
      }
    });
  }

  function aiImageSuiteCost(value) {
    var cents = Number(value);
    if (!Number.isSafeInteger(cents) || cents < 0) return '--';
    return 'US$' + (cents / 100).toFixed(2);
  }

  function aiImageSuiteStatusLabel(value) {
    var labels = {
      PLANNED: '等待开始',
      QUEUED: '等待生成',
      RUNNING: '生成中',
      SUCCEEDED: '已完成',
      FAILED: '生成失败',
      PARTIAL_FAILURE: '部分失败',
      CANCEL_REQUESTED: '正在取消',
      CANCELLED: '已取消',
    };
    return labels[value] || String(value || '尚未开始');
  }

  function aiImageSuiteReviewLabel(value) {
    var labels = {
      NOT_READY: '尚未审核',
      PENDING: '等待审核',
      APPROVED: '审核通过',
      REJECTED: '已驳回',
    };
    return labels[value] || '';
  }

  function invokeAiImageSuiteCommand(container, button, options, payload, interactionKey) {
    if (!options || typeof options.onAiImageSuiteCommand !== 'function') return;
    var state = aiImageSuiteInteractionState(container, interactionKey);
    var key = [payload.action, payload.slotId || '', payload.decision || ''].join(':');
    if (state.pendingKey || options.aiImageSuiteBusyKey) return;
    state.pendingKey = key;
    var polling = aiImageSuitePollingStates.get(container);
    if (polling) {
      polling.count = 0;
      polling.exhausted = false;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    var returned;
    try {
      returned = options.onAiImageSuiteCommand(payload);
    } catch (error) {
      state.pendingKey = '';
      button.removeAttribute('aria-busy');
      if (typeof options.onAiImageSuiteError === 'function') options.onAiImageSuiteError(error);
      return;
    }
    Promise.resolve(returned).catch(function (error) {
      if (typeof options.onAiImageSuiteError === 'function') options.onAiImageSuiteError(error);
    }).finally(function () {
      if (state.pendingKey === key) state.pendingKey = '';
      button.removeAttribute('aria-busy');
      button.disabled = Boolean(options.aiImageSuiteBusyKey);
    });
  }

  function aiImageSuitePlanCommandButton(container, options) {
    var button = element('button', 'is-primary', '创建并审核 AI 套图计划');
    button.type = 'button';
    button.disabled = Boolean(options.aiImageSuiteBusyKey);
    button.addEventListener('click', function (event) {
      if (!event || event.isTrusted !== true || button.disabled
        || typeof options.onAiImageSuiteCommand !== 'function') return;
      invokeAiImageSuiteCommand(container, button, options, {
        action: 'CREATE_AND_REVIEW_PLAN',
        costConfirmed: false,
      }, 'CREATE_AND_REVIEW_PLAN');
    });
    return button;
  }

  function aiImageSuiteCommandButton(container, options, payload, label, className) {
    var button = element('button', className || '', label);
    button.type = 'button';
    var projection = payload.projection;
    var interactionKey = aiImageSuiteInteractionKey(projection);
    var intentWitness = aiImageSuiteIntentWitness(
      projection,
      payload.action,
      payload.slotId,
      payload.decision,
    );
    var state = aiImageSuiteInteractionState(container, interactionKey);
    var commandPayload = {
      action: payload.action,
      slotId: payload.slotId,
      decision: payload.decision,
      costConfirmed: payload.costConfirmed === true,
      intentWitness: intentWitness,
    };
    button.disabled = Boolean(options.aiImageSuiteBusyKey || state.pendingKey || !intentWitness);
    button.addEventListener('click', function (event) {
      if (!event || event.isTrusted !== true || button.disabled) return;
      invokeAiImageSuiteCommand(container, button, options, commandPayload, interactionKey);
    });
    return button;
  }

  function renderAiImageSuiteOutput(container, slot) {
    if (!slot.output) return;
    var link = element('a', 'ss-erp-source-workbench-output');
    link.href = slot.output.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = '打开 AI 生图结果';
    var frame = element('span', 'ss-erp-source-workbench-output-frame');
    var image = element('img');
    image.src = slot.output.url;
    image.alt = slot.goal + '生成结果';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    var fallback = element('span', 'ss-erp-source-workbench-output-fallback', '预览不可用');
    image.addEventListener('error', function () {
      frame.classList.add('is-error');
      image.removeAttribute('src');
    }, { once: true });
    frame.appendChild(image);
    frame.appendChild(fallback);
    link.appendChild(frame);
    link.appendChild(element(
      'span',
      'ss-erp-source-workbench-output-meta',
      slot.output.width && slot.output.height
        ? slot.output.width + ' × ' + slot.output.height
        : slot.output.mimeType,
    ));
    container.appendChild(link);
  }

  function renderAiImageSuiteSlot(container, rootContainer, projection, slot, options) {
    var row = element('article', 'ss-erp-source-workbench-history-item');
    var heading = element('div', 'ss-erp-source-workbench-history-heading');
    heading.appendChild(element('strong', '', slot.goal));
    heading.appendChild(element(
      'span',
      '',
      aiImageSuiteStatusLabel(slot.status)
        + (slot.reviewStatus !== 'NOT_READY' ? ' · ' + aiImageSuiteReviewLabel(slot.reviewStatus) : ''),
    ));
    row.appendChild(heading);
    var meta = element('div', 'ss-erp-source-workbench-history-footer');
    meta.appendChild(element('span', '', '第 ' + (slot.ordinal + 1) + ' 张 · 尝试 ' + slot.attempt + ' 次'));
    meta.appendChild(element('span', '', '最高 ' + aiImageSuiteCost(slot.maximumCostCents)));
    row.appendChild(meta);
    renderAiImageSuiteOutput(row, slot);
    var actions = element('div', 'ss-erp-source-workbench-output-actions');
    if (slot.allowedActions.includes('RETRY_SLOT')) {
      var retryState = aiImageSuiteInteractionState(
        rootContainer,
        aiImageSuiteInteractionKey(projection),
      );
      var retryKey = slot.id + ':' + slot.revision + ':' + slot.maximumCostCents;
      var retryLabel = element('label', 'ss-erp-source-workbench-command-row');
      var retryConfirm = element('input');
      retryConfirm.type = 'checkbox';
      retryConfirm.checked = retryState.retryCostAccepted.has(retryKey);
      retryConfirm.setAttribute('aria-label', '确认失败槽位追加费用');
      retryLabel.appendChild(retryConfirm);
      retryLabel.appendChild(element(
        'span',
        '',
        '确认本次最多增加 ' + aiImageSuiteCost(slot.maximumCostCents),
      ));
      row.appendChild(retryLabel);
      var retry = aiImageSuiteCommandButton(rootContainer, options, {
        projection: projection,
        action: 'RETRY_SLOT',
        slotId: slot.id,
        costConfirmed: true,
      }, '重试失败图片');
      retry.disabled = retry.disabled || !retryConfirm.checked;
      retryConfirm.addEventListener('change', function (event) {
        if (!event || event.isTrusted !== true) return;
        if (retryConfirm.checked) retryState.retryCostAccepted.add(retryKey);
        else retryState.retryCostAccepted.delete(retryKey);
        retry.disabled = Boolean(
          options.aiImageSuiteBusyKey || retryState.pendingKey || !retryConfirm.checked,
        );
      });
      actions.appendChild(retry);
    }
    if (slot.allowedActions.includes('REVIEW_SLOT')) {
      actions.appendChild(aiImageSuiteCommandButton(rootContainer, options, {
        projection: projection,
        action: 'REVIEW_SLOT',
        slotId: slot.id,
        decision: 'APPROVE',
      }, '审核通过', 'is-primary'));
      actions.appendChild(aiImageSuiteCommandButton(rootContainer, options, {
        projection: projection,
        action: 'REVIEW_SLOT',
        slotId: slot.id,
        decision: 'REJECT',
      }, '驳回'));
    }
    if (slot.allowedActions.includes('APPLY_SLOT')) {
      actions.appendChild(aiImageSuiteCommandButton(rootContainer, options, {
        projection: projection,
        action: 'APPLY_SLOT',
        slotId: slot.id,
      }, '追加到 ERP 来源商品', 'is-primary'));
    }
    if (actions.children.length) row.appendChild(actions);
    if (slot.application) {
      row.appendChild(element(
        'div',
        'ss-erp-source-workbench-history-footer',
        slot.application.state === 'ROLLED_BACK'
          ? '追加结果已回滚'
          : '已追加到 ERP 来源商品',
      ));
    }
    container.appendChild(row);
  }

  function renderAiImageSuite(container, listing, options) {
    if (!listing || !options
      || (options.aiImageSuite === undefined
        && typeof options.onLoadAiImageSuite !== 'function')) {
      stopAiImageSuitePolling(container);
      return;
    }
    var result = aiImageSuiteResult(options.aiImageSuite);
    var drawer = element(
      'details',
      'ss-erp-source-workbench-drawer ss-erp-source-workbench-create ss-erp-source-workbench-history',
    );
    drawer.setAttribute('data-workflow-target', 'AI_SUITE');
    drawer.open = options.aiImageSuiteOpen !== false;
    drawer.appendChild(element('summary', '', 'AI 主图 / AI 套图'));
    drawer.addEventListener('toggle', function (event) {
      if (!event || event.isTrusted !== true
        || typeof options.onAiImageSuiteOpenChange !== 'function') return;
      options.onAiImageSuiteOpenChange(drawer.open === true);
    });
    if (options.aiImageSuiteLoading === true && !result) {
      drawer.appendChild(element('div', 'ss-erp-source-workbench-history-state', '正在读取生图计划...'));
      container.appendChild(drawer);
      scheduleAiImageSuitePolling(container, listing, options, result);
      return;
    }
    if (options.aiImageSuiteError) {
      var error = element('div', 'ss-erp-source-workbench-history-state is-error');
      error.appendChild(element('span', '', String(options.aiImageSuiteError)));
      var retryLoad = element('button', '', '重新读取');
      retryLoad.type = 'button';
      retryLoad.disabled = options.aiImageSuiteLoading === true
        || typeof options.onLoadAiImageSuite !== 'function';
      retryLoad.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || retryLoad.disabled) return;
        retryLoad.disabled = true;
        var returned;
        try {
          returned = options.onLoadAiImageSuite({ reason: 'manual', listing: listing });
        } catch (loadError) {
          if (typeof options.onAiImageSuiteError === 'function') {
            options.onAiImageSuiteError(loadError);
          }
          retryLoad.disabled = false;
          return;
        }
        Promise.resolve(returned).catch(function (loadError) {
          if (typeof options.onAiImageSuiteError === 'function') {
            options.onAiImageSuiteError(loadError);
          }
        }).finally(function () {
          retryLoad.disabled = options.aiImageSuiteLoading === true;
        });
      });
      error.appendChild(retryLoad);
      drawer.appendChild(error);
      container.appendChild(drawer);
      stopAiImageSuitePolling(container);
      return;
    }
    if (!result) {
      drawer.appendChild(element('div', 'ss-erp-source-workbench-history-state', '正在读取生图计划...'));
      container.appendChild(drawer);
      scheduleAiImageSuitePolling(container, listing, options, result);
      return;
    }
    if (result.state !== 'ready' || !result.projection) {
      drawer.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        'AI 主图与套图状态暂不可用，请刷新 ERP 工作台后重试。',
      ));
      container.appendChild(drawer);
      stopAiImageSuitePolling(container);
      return;
    }
    var projection = result.projection;
    var context = projection.context || {};
    if (context.listingWorkflowId !== listing.id
      || context.shopId !== listing.shopId
      || context.draftRevision !== listing.revision
      || context.draftVersion !== listing.draftVersion) {
      drawer.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        '生图计划对应的商品版本已变化，请重新读取后操作。',
      ));
      container.appendChild(drawer);
      stopAiImageSuitePolling(container);
      return;
    }
    if (!projection.plan) {
      drawer.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        '尚无已审核的生图计划。请先在 Web ERP 创建并审核主图/套图计划。',
      ));
      drawer.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        '生成结果只会追加到 ERP 来源商品，不会直接写入店铺草稿。',
      ));
      if (typeof options.onAiImageSuiteCommand === 'function') {
        drawer.appendChild(aiImageSuitePlanCommandButton(container, options));
      }
      container.appendChild(drawer);
      stopAiImageSuitePolling(container);
      return;
    }

    var suite = projection.suite;
    scheduleAiImageSuitePolling(container, listing, options, result);
    var slots = suite && Array.isArray(suite.slots) ? suite.slots : [];
    var primary = slots.find(function (slot) {
      return /主图/u.test(slot.goal) || /(?:^|:)hero(?:$|:)/u.test(slot.slotKey);
    }) || slots[0] || null;
    var succeeded = slots.filter(function (slot) { return slot.status === 'SUCCEEDED'; }).length;
    var failed = slots.filter(function (slot) { return slot.status === 'FAILED'; }).length;
    var metrics = element('div', 'ss-erp-source-workbench-metrics');
    var mainMetric = element('div', 'ss-erp-source-workbench-metric');
    mainMetric.appendChild(element('span', '', 'AI 主图'));
    mainMetric.appendChild(element(
      'b',
      '',
      primary ? aiImageSuiteStatusLabel(primary.status) : suite ? '计划内无主图' : '待开始',
    ));
    metrics.appendChild(mainMetric);
    var suiteMetric = element('div', 'ss-erp-source-workbench-metric');
    suiteMetric.appendChild(element('span', '', 'AI 套图'));
    suiteMetric.appendChild(element(
      'b',
      '',
      suite
        ? succeeded + ' / ' + suite.itemCount + (failed ? ' · 失败 ' + failed : '')
        : '待生成 ' + projection.plan.preview.itemCount + ' 张',
    ));
    metrics.appendChild(suiteMetric);
    var statusMetric = element('div', 'ss-erp-source-workbench-metric');
    statusMetric.appendChild(element('span', '', '任务状态'));
    statusMetric.appendChild(element('b', '', aiImageSuiteStatusLabel(suite && suite.status)));
    metrics.appendChild(statusMetric);
    drawer.appendChild(metrics);

    var pricing = suite || projection.plan.preview;
    drawer.appendChild(element(
      'p',
      'ss-erp-source-workbench-task',
      '预计费用 ' + aiImageSuiteCost(pricing.estimatedCostCents)
        + ' · 最高费用 ' + aiImageSuiteCost(pricing.maximumCostCents),
    ));
    var pollingState = aiImageSuitePollingStates.get(container);
    if (pollingState && pollingState.exhausted && aiImageSuiteNeedsPolling(result)) {
      var refreshStatus = element('button', '', '刷新任务状态');
      refreshStatus.type = 'button';
      refreshStatus.disabled = options.aiImageSuiteLoading === true;
      refreshStatus.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || refreshStatus.disabled) return;
        refreshStatus.disabled = true;
        refreshExhaustedAiImageSuitePolling(container, listing, options, result);
      });
      drawer.appendChild(refreshStatus);
    }
    var state = aiImageSuiteInteractionState(
      container,
      aiImageSuiteInteractionKey(projection),
    );
    var suiteActions = element('div', 'ss-erp-source-workbench-command-actions');
    if (!suite && projection.plan.allowedActions.includes('START')) {
      var startConfirmLabel = element('label', 'ss-erp-source-workbench-command-row');
      var startConfirm = element('input');
      startConfirm.type = 'checkbox';
      startConfirm.checked = state.startCostAccepted;
      startConfirm.setAttribute('aria-label', '确认 AI 套图最高费用');
      startConfirmLabel.appendChild(startConfirm);
      startConfirmLabel.appendChild(element(
        'span',
        '',
        '我确认本次最高费用 ' + aiImageSuiteCost(projection.plan.preview.maximumCostCents),
      ));
      drawer.appendChild(startConfirmLabel);
      var start = aiImageSuiteCommandButton(container, options, {
        projection: projection,
        action: 'START',
        costConfirmed: true,
      }, '开始生成套图', 'ss-erp-source-workbench-create-button');
      start.disabled = start.disabled || !startConfirm.checked;
      startConfirm.addEventListener('change', function (event) {
        if (!event || event.isTrusted !== true) return;
        state.startCostAccepted = startConfirm.checked === true;
        start.disabled = Boolean(
          options.aiImageSuiteBusyKey || state.pendingKey || !state.startCostAccepted,
        );
      });
      suiteActions.appendChild(start);
    }
    if (suite && suite.allowedActions.includes('CONTINUE')) {
      suiteActions.appendChild(aiImageSuiteCommandButton(container, options, {
        projection: projection,
        action: 'CONTINUE',
      }, '继续生成', 'is-primary'));
    }
    if (suite && suite.allowedActions.includes('CANCEL')) {
      suiteActions.appendChild(aiImageSuiteCommandButton(container, options, {
        projection: projection,
        action: 'CANCEL',
      }, '取消任务'));
    }
    if (suiteActions.children.length) drawer.appendChild(suiteActions);

    if (slots.length) {
      var slotList = element('div', 'ss-erp-source-workbench-history-list');
      slots.slice().sort(function (left, right) {
        return left.ordinal - right.ordinal;
      }).forEach(function (slot) {
        renderAiImageSuiteSlot(slotList, container, projection, slot, options);
      });
      drawer.appendChild(slotList);
    } else if (suite) {
      drawer.appendChild(element('div', 'ss-erp-source-workbench-history-state', '正在准备图片槽位...'));
    }
    drawer.appendChild(element(
      'p',
      'ss-erp-source-workbench-empty',
      '生成结果只会追加到 ERP 来源商品，不会直接写入店铺草稿。',
    ));
    container.appendChild(drawer);
  }

  function renderStandaloneMediaLaunch(container, listing, options) {
    var launch = options && options.launch;
    var context = launch && launch.context;
    var operations = launch && launch.contractVersion === 2 && launch.operations;
    if (!listing || !operations || launch.state !== 'ready' || !context
      || context.id !== listing.id || context.shopId !== listing.shopId
      || context.revision !== listing.revision || context.draftVersion !== listing.draftVersion
      || typeof options.onMediaCreateDraftChange !== 'function') return;
    var allowedKeys = new Set((context.sourceInputs || []).map(function (item) {
      return item && item.sourceMediaKey;
    }).filter(Boolean));
    var sourceInputs = (Array.isArray(options.sourceInputs) ? options.sourceInputs : [])
      .filter(function (item) { return item && allowedKeys.has(item.sourceMediaKey); })
      .slice(0, 50);
    if (!sourceInputs.length) return;

    var draft = mediaCreateDraft(options.mediaCreateDraft);
    var allowedSourceKeys = new Set(sourceInputs.map(function (item) { return item.sourceMediaKey; }));
    draft.sourceMediaKeys = draft.sourceMediaKeys.filter(function (key) {
      return allowedSourceKeys.has(key);
    });
    var operationCapability = operations[draft.operation];
    var maximumReferences = draft.operation === 'IMAGE_TO_IMAGE'
      ? Math.min(4, Math.max(1, Number(operationCapability && operationCapability.maxReferences) || 4))
      : 1;
    draft.sourceMediaKeys = draft.sourceMediaKeys.slice(0, maximumReferences);
    var create = null;

    function refreshCreateState() {
      if (!create) return;
      var capability = operations[draft.operation];
      create.disabled = Boolean(options.busyCreateKey || options.busyCommandKey
        || !capability || capability.ready !== true
        || !draft.sourceMediaKeys.length);
    }

    function emit(patch, structural) {
      var next = mediaCreateDraft(Object.assign({}, draft, patch || {}));
      var capability = operations[next.operation];
      var maximum = next.operation === 'IMAGE_TO_IMAGE'
        ? Math.min(4, Math.max(1, Number(capability && capability.maxReferences) || 4))
        : 1;
      next.sourceMediaKeys = next.sourceMediaKeys
        .filter(function (key) { return allowedSourceKeys.has(key); })
        .slice(0, maximum);
      draft = next;
      refreshCreateState();
      options.onMediaCreateDraftChange(next, { structural: structural === true });
    }

    var drawer = element('details', 'ss-erp-source-workbench-drawer ss-erp-source-workbench-create ss-erp-source-workbench-media-create');
    drawer.setAttribute('data-workflow-target', 'MEDIA_EDITOR');
    drawer.open = options.mediaCreateOpen === true;
    drawer.addEventListener('toggle', function (event) {
      if (!event || event.isTrusted !== true
        || typeof options.onMediaCreateOpenChange !== 'function') return;
      options.onMediaCreateOpenChange(drawer.open === true);
    });
    drawer.appendChild(element('summary', '', 'AI 修图与生图'));
    var segmented = element('div', 'ss-erp-source-workbench-operation-tabs');
    mediaOperationDefinitions().filter(function (definition) {
      return definition.operation !== 'IMAGE_TRANSLATE';
    }).forEach(function (definition) {
      var capability = operations[definition.operation];
      var button = element('button', definition.operation === draft.operation ? 'is-active' : '', definition.label);
      button.type = 'button';
      button.setAttribute('data-media-operation', definition.operation);
      button.setAttribute('aria-pressed', definition.operation === draft.operation ? 'true' : 'false');
      button.disabled = !capability || capability.enabled !== true;
      button.title = capability && capability.ready === true
        ? definition.label
        : mediaCapabilityReason(definition, capability);
      button.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || button.disabled) return;
        emit({
          operation: definition.operation,
          sourceMediaKeys: draft.sourceMediaKeys.slice(0, definition.operation === 'IMAGE_TO_IMAGE' ? 4 : 1),
        }, true);
      });
      segmented.appendChild(button);
    });
    drawer.appendChild(segmented);

    var gallery = element('div', 'ss-erp-source-workbench-source-gallery');
    sourceInputs.forEach(function (source, index) {
      var selected = draft.sourceMediaKeys.includes(source.sourceMediaKey);
      var label = element('label', 'ss-erp-source-workbench-source-card' + (selected ? ' is-selected' : ''));
      var checkbox = element('input');
      checkbox.type = draft.operation === 'IMAGE_TO_IMAGE' ? 'checkbox' : 'radio';
      checkbox.name = 'ss-erp-source-workbench-media-source';
      checkbox.checked = selected;
      checkbox.setAttribute('data-source-media-key', source.sourceMediaKey);
      checkbox.setAttribute('aria-label', source.label || ('图片 ' + (index + 1)));
      checkbox.addEventListener('change', function (event) {
        if (!event || event.isTrusted !== true) return;
        var nextKeys;
        if (draft.operation === 'IMAGE_TO_IMAGE') {
          nextKeys = checkbox.checked
            ? draft.sourceMediaKeys.concat([source.sourceMediaKey])
            : draft.sourceMediaKeys.filter(function (key) { return key !== source.sourceMediaKey; });
        } else {
          nextKeys = [source.sourceMediaKey];
        }
        emit({ sourceMediaKeys: Array.from(new Set(nextKeys)) }, true);
      });
      label.appendChild(checkbox);
      if (source.url) {
        var image = element('img');
        image.src = source.url;
        image.alt = source.label || ('来源图片 ' + (index + 1));
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        label.appendChild(image);
      }
      label.appendChild(element('span', '', source.label || source.role || ('图片 ' + (index + 1))));
      gallery.appendChild(label);
    });
    drawer.appendChild(gallery);

    var createLabel = draft.operation === 'IMAGE_TO_IMAGE'
      ? '配置参考生图'
      : draft.operation === 'FULL_EDIT' ? '配置全图编辑' : '打开局部重绘';
    create = element('button', 'ss-erp-source-workbench-create-button', createLabel);
    create.type = 'button';
    refreshCreateState();
    create.addEventListener('click', function (event) {
      if (!event || event.isTrusted !== true || create.disabled) return;
      if (typeof options.onOpenMediaEditor === 'function') options.onOpenMediaEditor(draft);
    });
    drawer.appendChild(create);
    container.appendChild(drawer);
  }

  function renderListingSelector(container, listings, options, truncated) {
    if (!Array.isArray(listings) || listings.length <= 1
      || !options || typeof options.onSelectListing !== 'function') return;
    var wrapper = element('div', 'ss-erp-source-workbench-listing-picker');
    var label = element('label', '', '店铺草稿');
    var select = element('select', 'ss-erp-source-workbench-listing-select');
    select.setAttribute('aria-label', '选择店铺草稿');
    select.disabled = options.aiWorkbenchBusy === true;
    var selectedId = String(options.selectedListingWorkflowId || '');
    var placeholder = element('option', '', '请选择店铺草稿');
    placeholder.value = '';
    select.appendChild(placeholder);
    listings.slice(0, 10).forEach(function (listing) {
      if (!listing || !listing.id) return;
      var option = element(
        'option',
        '',
        '店铺 ' + (listing.shopId || '-') + ' · 草稿 ' + String(listing.id),
      );
      option.value = listing.id;
      option.selected = listing.id === selectedId;
      select.appendChild(option);
    });
    select.addEventListener('change', function (event) {
      if (!event || event.isTrusted !== true || select.disabled) return;
      options.onSelectListing(select.value);
    });
    label.appendChild(select);
    wrapper.appendChild(label);
    if (truncated === true) {
      wrapper.appendChild(element(
        'p',
        'ss-erp-source-workbench-listing-note',
        '草稿列表已截断，请在 ERP 查看全部草稿。',
      ));
    }
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
        button.disabled = Boolean(options.busyCommandKey || options.busyCreateKey);
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

  function renderHistoryOutputActions(container, item, output, options) {
    if (!options || item.status !== 'SUCCEEDED' || item.application !== null) return;
    var actions = element('div', 'ss-erp-source-workbench-output-actions');
    if (item.reviewStatus === 'PENDING' && typeof options.onReviewOutput === 'function') {
      [
        { decision: 'APPROVE', action: 'REVIEW_APPROVE', label: '通过' },
        { decision: 'REJECT', action: 'REVIEW_REJECT', label: '驳回' },
      ].forEach(function (definition) {
        var button = element('button', '', definition.label);
        button.type = 'button';
        button.disabled = Boolean(options.busyCommandKey || options.busyCreateKey);
        button.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true || button.disabled) return;
          options.onReviewOutput(item, output, definition.decision);
        });
        actions.appendChild(button);
      });
    } else if (item.reviewStatus === 'APPROVED'
      && item.selectedOutputAssetId === output.id
      && typeof options.onApplyOutput === 'function') {
      var apply = element('button', 'is-primary', '追加到草稿');
      apply.type = 'button';
      apply.disabled = Boolean(options.busyCommandKey || options.busyCreateKey);
      apply.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || apply.disabled) return;
        options.onApplyOutput(item, output);
      });
      actions.appendChild(apply);
    }
    if (actions.children.length) container.appendChild(actions);
  }

  function renderHistoryOutput(container, output, item, options) {
    var wrapper = element('div', 'ss-erp-source-workbench-output-item');
    var link = element('a', 'ss-erp-source-workbench-output');
    link.href = output.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = '打开原始候选图';
    var frame = element('span', 'ss-erp-source-workbench-output-frame');
    var image = element('img');
    image.src = output.url;
    image.alt = operationLabel(item.operation) + '候选图';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
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
    wrapper.appendChild(link);
    renderHistoryOutputActions(wrapper, item, output, options);
    container.appendChild(wrapper);
  }

  function renderHistoryItem(container, item, options) {
    var card = element('article', 'ss-erp-source-workbench-history-item');
    var heading = element('div', 'ss-erp-source-workbench-history-heading');
    heading.appendChild(element('strong', '', operationLabel(item.operation)));
    heading.appendChild(element('span', '', statusLabel(item)));
    card.appendChild(heading);
    if (Array.isArray(item.outputs) && item.outputs.length) {
      var outputs = element('div', 'ss-erp-source-workbench-output-grid');
      item.outputs.forEach(function (output) {
        renderHistoryOutput(outputs, output, item, options);
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
        items.forEach(function (item) { renderHistoryItem(list, item, options); });
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
    renderWorkbenchJourney(
      container,
      { state: 'ready', status: status },
      listing,
      mediaItems,
    );
    var heading = element('div', 'ss-erp-source-workbench-heading');
    heading.appendChild(element('strong', '', 'ERP 商品工作流'));
    heading.appendChild(element(
      'span',
      status.snapshot.current ? 'is-current' : 'is-stale',
      status.snapshot.current ? '采集快照有效' : '采集快照已更新',
    ));
    container.appendChild(heading);

    renderListingSelector(container, listings, options, status.listing.truncated === true);

    if (!listing) {
      stopAiImageSuitePolling(container);
      renderImageWorkflowOverview(container, { state: 'ready', status: status }, null, options);
      container.appendChild(element(
        'p',
        'ss-erp-source-workbench-empty',
        listings.length > 1
          ? '请选择要处理的店铺草稿。'
          : '已保存采集快照。可在 Web ERP 的采集详情中使用 AI 图片工作台；扩展内处理需先创建店铺草稿。',
      ));
      renderMediaTask(container, status, mediaItems, options);
      return;
    }

    renderImageWorkflowOverview(container, { state: 'ready', status: status }, listing, options);
    renderAiWorkbenchLauncher(container, listing, options);

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
    renderMediaLaunchStatus(container, listing, options);
    renderStandaloneMediaLaunch(container, listing, options);
    renderAiImageSuite(container, listing, options);
    renderTranslationLaunch(container, listing, options);
    renderMediaTask(container, status, mediaItems, options);
    renderMediaHistory(container, listing, options);
  }

  function render(container, result, options) {
    if (!container) return;
    clear(container);
    if (!result) {
      stopAiImageSuitePolling(container);
      container.hidden = false;
      renderWorkbenchAvailability(container, { state: 'loading' }, options || null);
      return;
    }
    container.hidden = false;
    if (result.state !== 'ready' || !result.status) {
      stopAiImageSuitePolling(container);
      renderWorkbenchAvailability(container, result, options || null);
      return;
    }
    renderReady(container, result.status, options || null);
  }

  root.SS_ERP_SOURCE_LISTING_WORKBENCH = {
    render: render,
    getImageWorkflowDefinition: imageWorkflowDefinition,
    getImageWorkflowDefinitions: function () { return IMAGE_WORKFLOW_DEFINITIONS.slice(); },
  };
})(window);
