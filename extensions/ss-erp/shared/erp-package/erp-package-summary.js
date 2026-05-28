(function (root) {
  var SECTION_DEFS = [
    { key: 'productPool', shortLabel: '选品', label: '选品池' },
    { key: 'sellerProducts', shortLabel: '商品', label: 'seller 商品表' },
    { key: 'sellerLogistics', shortLabel: '物流', label: 'seller 物流模板' },
    { key: 'officialFreight', shortLabel: '运费样本', label: 'official 运费样本' },
    { key: 'visibleSnapshots', shortLabel: '页面快照', label: '页面快照' },
    { key: 'capturedHarEntries', shortLabel: '捕获', label: 'HAR 捕获' },
  ];

  function numberValue(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function normalizeCounts(counts) {
    counts = counts && typeof counts === 'object' ? counts : {};
    return SECTION_DEFS.reduce(function (result, section) {
      result[section.key] = numberValue(counts[section.key]);
      return result;
    }, {});
  }

  function sumCounts(counts) {
    return SECTION_DEFS.reduce(function (total, section) {
      return total + numberValue(counts[section.key]);
    }, 0);
  }

  function formatCountText(counts) {
    var normalized = normalizeCounts(counts);
    return SECTION_DEFS.map(function (section) {
      return section.shortLabel + ' ' + normalized[section.key];
    }).join('，');
  }

  function formatLastPush(lastPush) {
    if (!lastPush || typeof lastPush !== 'object') return '最近推送：暂无';
    var parts = [
      '最近推送：' + (lastPush.ok ? '成功' : '失败'),
      'HTTP ' + (numberValue(lastPush.status) || 0),
    ];
    if (lastPush.pushedAt) parts.push(String(lastPush.pushedAt));
    return parts.join('，');
  }

  function buildSectionStatus(counts) {
    var normalized = normalizeCounts(counts);
    return SECTION_DEFS.map(function (section) {
      var count = normalized[section.key];
      return {
        key: section.key,
        label: section.label,
        shortLabel: section.shortLabel,
        count: count,
        ok: count > 0,
      };
    });
  }

  function formatCompletionText(sectionStatus) {
    var statuses = Array.isArray(sectionStatus) ? sectionStatus : buildSectionStatus(sectionStatus);
    var filledCount = statuses.filter(function (section) {
      return Boolean(section && section.ok);
    }).length;
    return '已填充 ' + filledCount + '/' + SECTION_DEFS.length;
  }

  function formatIssueText(sectionStatus) {
    var statuses = Array.isArray(sectionStatus) ? sectionStatus : buildSectionStatus(sectionStatus);
    var missing = statuses.filter(function (section) {
      return !section || !section.ok;
    });
    return missing.length ? ('待补齐：' + missing.map(function (section) {
      return section.label;
    }).join('；')) : '数据包结构完整';
  }

  function formatWarnings(sectionStatus) {
    var statuses = Array.isArray(sectionStatus) ? sectionStatus : buildSectionStatus(sectionStatus);
    return statuses.filter(function (section) {
      return !section || !section.ok;
    }).map(function (section) {
      return '缺少 ' + section.label;
    });
  }

  function formatSummary(summary) {
    summary = summary && typeof summary === 'object' ? summary : {};
    var counts = normalizeCounts(summary.counts);
    var sectionStatus = buildSectionStatus(counts);
    var totalCount = sumCounts(counts);
    var endpointConfigured = Boolean(summary.endpointConfigured);
    var ready = Boolean(summary.ready);
    var blockers = [];
    if (!endpointConfigured) blockers.push('未配置 ERP 导入地址');
    if (!totalCount) blockers.push('当前 ERP 数据包为空');
    return {
      ready: ready,
      tone: ready ? 'ready' : 'blocked',
      statusText: ready ? '可推送' : '不可推送',
      completionText: formatCompletionText(sectionStatus),
      issueText: formatIssueText(sectionStatus),
      totalCount: totalCount,
      counts: counts,
      sectionStatus: sectionStatus,
      countText: formatCountText(counts),
      endpointConfigured: endpointConfigured,
      endpointText: 'ERP 地址：' + (endpointConfigured ? '已配置' : '未配置'),
      hasToken: Boolean(summary.hasToken),
      tokenText: 'Token：' + (summary.hasToken ? '已保存' : '未保存'),
      blockers: blockers,
      warnings: formatWarnings(sectionStatus),
      lastPushText: formatLastPush(summary.lastPush),
    };
  }

  var api = {
    normalizeCounts: normalizeCounts,
    sumCounts: sumCounts,
    formatCountText: formatCountText,
    formatLastPush: formatLastPush,
    buildSectionStatus: buildSectionStatus,
    formatCompletionText: formatCompletionText,
    formatIssueText: formatIssueText,
    formatWarnings: formatWarnings,
    formatSummary: formatSummary,
  };

  root.OZON_CALC_ERP_PACKAGE_SUMMARY = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_ERP_PACKAGE_SUMMARY = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
