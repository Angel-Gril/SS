(function (root) {
  'use strict';

  function setOf(values) {
    return new Set(values);
  }

  var SETTINGS_ONLY_TYPES = setOf([
    'ozon-calculator:build-config-from-captured-seller',
    'ozon-calculator:sync-captured-seller-official',
    'ozon-calculator:sync-captured-official',
    'ozon-calculator:update-fee-settings',
    'ozon-calculator:clear-captured-har',
    'ss-erp:logistics-device-claim',
    'ss-erp:logistics-device-clear',
    'ss-erp:logistics-device-status',
    'ss-erp:logistics-rules-sync',
    'ss-erp:logistics-capture-refresh',
    'ss-erp:logistics-capture-retry',
    'ss-erp:logistics-capture-status',
    'ss-erp:logistics-capture-cancel',
    'ss-erp:logistics-binding-probe-run',
    'ss-erp:logistics-binding-probe-status',
  ]);

  var CONFIG_IMPORT_TYPES = setOf([
    'ozon-calc:sync-config',
    'ozon-calc:erp-endpoint-get',
    'ozon-calc:erp-endpoint-save',
    'ozon-calc:erp-package-summary',
  ]);

  var ERP_BRIDGE_TYPES = setOf([
    'ss-erp:ping',
    'ss-erp:query-collect-status',
    'ss-erp:query-collect-batch-snapshot',
    'ss-erp:collect-product',
    'ozon-calc:auto-sync-status',
    'ozon-calc:auto-sync-maintenance',
    'spb-self-hosted:fetch-ozon-product-to-erp',
    'spb-self-hosted:fetch-ozon-product-batch',
    'spb-self-hosted:get-listing-data',
    'spb-self-hosted:fetch-ozon-dropoff-points',
  ]);

  var OFFICIAL_PAGE_TYPES = setOf([
    'ozon-calc:capture-har-entry',
  ]);

  var SOURCE_PAGE_TYPES = setOf([
    'ss-erp:source-candidate-context-get',
    'ss-erp:collect-source-to-erp',
    'ss-erp:open-source-workflow-handoff',
    'ss-erp:source-listing-workbench-status',
    'ss-erp:source-listing-workbench-media-history',
    'ss-erp:source-listing-workbench-media-command',
    'ss-erp:source-quote-save',
    'ss-erp:image-search-create',
    'ozon-calculator:status',
    'spb-self-hosted:get-config',
    'spb-self-hosted:collect-current-tab',
    'spb-self-hosted:get-ozon-shops',
    'spb-self-hosted:get-watermark-templates',
    'spb-self-hosted:fetch-ozon-workbench-rows',
    'spb-self-hosted:publish-ozon-workbench-rows',
  ]);

  var OZON_PAGE_TYPES = setOf([
    'ss-erp:ozon-company-id-captured',
    'ss-erp:collect-product',
    'ss-erp:source-candidate-context-save',
    'ss-erp:source-candidate-context-get',
    'ss-erp:source-quote-pending-get',
    'ss-erp:source-quote-pending-clear',
    'ss-erp:image-search-open-from-ozon',
    'ozon-calc:erp-enqueue',
    'ozon-calc:collect-to-erp',
    'ozon-calc:erp-endpoint-get',
    'ozon-calc:capture-har-entry',
    'ozon-calc:get-captured-har',
    'ozon-calc:product-pool-upsert',
    'ozon-calc:product-pool-update-meta',
    'ozon-calc:product-pool-list',
    'ozon-calc:visible-snapshot-save',
    'ozon-calc:visible-snapshot-list',
    'ozon-calc:seller-products-export',
    'ozon-calc:official-freight-export',
    'ozon-calc:seller-logistics-export',
    'ozon-calc:sync-ozon-cookie',
    'ozon-calc:sync-current-ozon-cookie',
    'ozon-calc:sync-ozon-company-id',
    'ozon-calculator:status',
    'ozon-calculator:sync-commission-rates',
    'ozon-calculator:sync-fx-rates',
    'spb-self-hosted:get-config',
    'spb-self-hosted:get-last-collected',
    'spb-self-hosted:collect-current-tab',
    'spb-self-hosted:get-ozon-insights',
    'spb-self-hosted:get-ozon-seller-offers',
    'spb-self-hosted:fetch-ozon-workbench-rows',
    'spb-self-hosted:publish-ozon-workbench-rows',
    'spb-self-hosted:get-watermark-templates',
    'spb-self-hosted:list-product-selection-rules',
    'spb-self-hosted:save-product-selection-rule',
    'spb-self-hosted:toggle-product-selection-rule',
    'spb-self-hosted:delete-product-selection-rule',
    'spb-self-hosted:upsert-product-selection-pool-item',
    'spb-self-hosted:get-product-selection-pool-status',
    'spb-self-hosted:download-product',
    'spb-self-hosted:download-ozon-workbench-excel',
    'spb-self-hosted:track-logistics',
    'spb-self-hosted:check-premium',
    'spb-self-hosted:check-logins',
    'spb-self-hosted:sync-shop-analytics',
    'spb-self-hosted:fetch-ozon-dropoff-points',
    'spb-self-hosted:sync-shop-graphs',
    'spb-self-hosted:test-market-apis',
    'spb-self-hosted:get-ozon-shops',
    'spb-self-hosted:fetch-ozon-product',
    'spb-self-hosted:aggregate-product-insights',
    'spb-self-hosted:fetch-ozon-product-batch',
    'spb-self-hosted:get-listing-data',
    'spb-self-hosted:fetch-ozon-product-to-erp',
  ]);

  var GENERAL_EXTENSION_TYPES = setOf([
    'ozon-calc:sync-config',
    'ozon-calc:erp-enqueue',
    'ozon-calc:collect-to-erp',
    'ozon-calc:erp-endpoint-get',
    'ozon-calc:erp-endpoint-save',
    'ozon-calc:erp-push-history-list',
    'ozon-calc:capture-har-entry',
    'ozon-calc:get-captured-har',
    'ozon-calc:product-pool-upsert',
    'ozon-calc:product-pool-update-meta',
    'ozon-calc:product-pool-list',
    'ozon-calc:product-pool-export',
    'ozon-calc:visible-snapshot-save',
    'ozon-calc:visible-snapshot-list',
    'ozon-calc:visible-snapshot-export',
    'ozon-calc:seller-products-export',
    'ozon-calc:official-freight-export',
    'ozon-calc:seller-logistics-export',
    'ozon-calc:erp-package-export',
    'ozon-calc:erp-package-summary',
    'ozon-calc:erp-package-push',
    'ozon-calc:sync-ozon-cookie',
    'ozon-calc:sync-current-ozon-cookie',
    'ozon-calc:auto-sync-maintenance',
    'ozon-calc:auto-sync-status',
    'ozon-calc:sync-ozon-company-id',
    'ozon-calculator:status',
    'ozon-calculator:sync-commission-rates',
    'ozon-calculator:sync-fx-rates',
    'ss-erp:ozon-company-id-captured',
    'ss-erp:ping',
    'ss-erp:query-collect-status',
    'ss-erp:query-collect-batch-snapshot',
    'ss-erp:collect-product',
    'ss-erp:source-candidate-context-save',
    'ss-erp:source-candidate-context-get',
    'ss-erp:collect-source-to-erp',
    'ss-erp:open-source-workflow-handoff',
    'ss-erp:source-listing-workbench-status',
    'ss-erp:source-listing-workbench-media-history',
    'ss-erp:source-listing-workbench-media-command',
    'ss-erp:source-quote-save',
    'ss-erp:source-quote-pending-get',
    'ss-erp:source-quote-pending-clear',
    'ss-erp:source-quote-list',
    'ss-erp:source-quote-export',
    'ss-erp:source-candidate-upsert',
    'ss-erp:source-candidate-list',
    'ss-erp:image-search-open-from-ozon',
    'ss-erp:image-search-create',
  ]);

  var SELF_HOSTED_TYPES = setOf([
    'spb-self-hosted:get-config',
    'spb-self-hosted:save-config',
    'spb-self-hosted:get-last-collected',
    'spb-self-hosted:collect-current-tab',
    'spb-self-hosted:get-ozon-insights',
    'spb-self-hosted:get-ozon-seller-offers',
    'spb-self-hosted:fetch-ozon-workbench-rows',
    'spb-self-hosted:publish-ozon-workbench-rows',
    'spb-self-hosted:get-watermark-templates',
    'spb-self-hosted:list-product-selection-rules',
    'spb-self-hosted:save-product-selection-rule',
    'spb-self-hosted:toggle-product-selection-rule',
    'spb-self-hosted:delete-product-selection-rule',
    'spb-self-hosted:upsert-product-selection-pool-item',
    'spb-self-hosted:get-product-selection-pool-status',
    'spb-self-hosted:download-product',
    'spb-self-hosted:download-ozon-workbench-excel',
    'spb-self-hosted:track-logistics',
    'spb-self-hosted:check-premium',
    'spb-self-hosted:check-logins',
    'spb-self-hosted:sync-shop-analytics',
    'spb-self-hosted:fetch-ozon-dropoff-points',
    'spb-self-hosted:sync-shop-graphs',
    'spb-self-hosted:test-market-apis',
    'spb-self-hosted:get-ozon-shops',
    'spb-self-hosted:fetch-ozon-product',
    'spb-self-hosted:aggregate-product-insights',
    'spb-self-hosted:fetch-ozon-product-batch',
    'spb-self-hosted:get-listing-data',
    'spb-self-hosted:fetch-ozon-product-to-erp',
  ]);

  function union() {
    var result = new Set();
    Array.prototype.forEach.call(arguments, function (values) {
      values.forEach(function (value) { result.add(value); });
    });
    return result;
  }

  var KNOWN_TYPES = union(
    SETTINGS_ONLY_TYPES,
    CONFIG_IMPORT_TYPES,
    ERP_BRIDGE_TYPES,
    OFFICIAL_PAGE_TYPES,
    SOURCE_PAGE_TYPES,
    OZON_PAGE_TYPES,
    GENERAL_EXTENSION_TYPES,
    SELF_HOSTED_TYPES,
  );

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function parseSenderUrl(sender) {
    if (!sender || typeof sender !== 'object') return null;
    var value = text(sender.url || sender.documentUrl);
    if (!value) return null;
    try {
      return new URL(value);
    } catch (_error) {
      return null;
    }
  }

  function sameAuthority(left, right) {
    return left.protocol === right.protocol && left.hostname === right.hostname
      && left.port === right.port;
  }

  function senderUrlIsConsistent(sender, parsed) {
    if (sender.origin) {
      try {
        var origin = new URL(text(sender.origin));
        if (!sameAuthority(parsed, origin)) return false;
      } catch (_error) {
        return false;
      }
    }
    if (sender.tab && sender.tab.url) {
      try {
        var tabUrl = new URL(text(sender.tab.url));
        if (!sameAuthority(parsed, tabUrl)) return false;
      } catch (_error) {
        return false;
      }
    }
    return true;
  }

  function isHostOrSubdomain(hostname, base) {
    return hostname === base || hostname.endsWith('.' + base);
  }

  function senderKind(sender, runtimeId) {
    var extensionId = text(runtimeId);
    if (!extensionId || !sender || text(sender.id) !== extensionId) return null;
    var url = parseSenderUrl(sender);
    if (!url || !senderUrlIsConsistent(sender, url)) return null;
    if (url.protocol === 'chrome-extension:' && url.hostname === extensionId) {
      if (url.pathname === '/pages/settings.html') return 'settings';
      if (url.pathname === '/pages/config-import.html') return 'config_import';
      return 'extension';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    var hostname = url.hostname.toLowerCase();
    if (
      (hostname === 'localhost' || hostname === '127.0.0.1')
      && (url.protocol === 'http:' || url.protocol === 'https:')
    ) return 'erp';
    if (url.protocol === 'https:' && (
      isHostOrSubdomain(hostname, 'ss-erp.com')
      || isHostOrSubdomain(hostname, 'ss-erp.cn')
    )) return 'erp';
    if (url.protocol === 'https:' && hostname === 'globalcalculator.ozon.ru') return 'official';
    if (url.protocol === 'https:' && (
      isHostOrSubdomain(hostname, 'ozon.ru')
      || isHostOrSubdomain(hostname, 'ozon.kz')
      || isHostOrSubdomain(hostname, 'ozon.by')
    )) return 'ozon';
    if (url.protocol === 'https:' && (
      isHostOrSubdomain(hostname, '1688.com')
      || isHostOrSubdomain(hostname, 'pinduoduo.com')
      || isHostOrSubdomain(hostname, 'yangkeduo.com')
      || isHostOrSubdomain(hostname, 'taobao.com')
      || isHostOrSubdomain(hostname, 'tmall.com')
      || isHostOrSubdomain(hostname, 'goofish.com')
      || isHostOrSubdomain(hostname, 'jd.com')
      || isHostOrSubdomain(hostname, 'temu.com')
      || isHostOrSubdomain(hostname, 'aliexpress.com')
      || isHostOrSubdomain(hostname, 'wildberries.ru')
    )) return 'source';
    return null;
  }

  function isKnownRuntimeMessageType(type) {
    return KNOWN_TYPES.has(text(type));
  }

  function isAllowedRuntimeMessageSender(type, sender, runtimeId) {
    var messageType = text(type);
    if (!KNOWN_TYPES.has(messageType)) return false;
    var kind = senderKind(sender, runtimeId);
    if (kind === 'settings') return true;
    if (kind === 'config_import') return CONFIG_IMPORT_TYPES.has(messageType);
    if (kind === 'extension') return !SETTINGS_ONLY_TYPES.has(messageType);
    if (kind === 'erp') return ERP_BRIDGE_TYPES.has(messageType);
    if (kind === 'official') return OFFICIAL_PAGE_TYPES.has(messageType);
    if (kind === 'ozon') return OZON_PAGE_TYPES.has(messageType);
    if (kind === 'source') return SOURCE_PAGE_TYPES.has(messageType);
    return false;
  }

  root.SS_ERP_RUNTIME_MESSAGE_POLICY = {
    isAllowedRuntimeMessageSender: isAllowedRuntimeMessageSender,
    isKnownRuntimeMessageType: isKnownRuntimeMessageType,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
