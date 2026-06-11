(function (root, factory) {
  var api = factory();
  root.SS_ERP_IMAGE_SEARCH_JOB = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var JOB_TTL_MS = 30 * 60 * 1000;
  var JOB_LIMIT = 8;

  function toText(value) {
    return value == null ? '' : String(value);
  }

  function normalizePlatform(value) {
    var text = toText(value).trim().toLowerCase();
    if (text === '1688' || text === 'ali1688') return '1688';
    if (text === 'pdd' || text === 'pinduoduo') return 'pdd';
    if (text === 'taobao' || text === 'tb') return 'taobao';
    return text || '1688';
  }

  function normalizeOzon(ozon) {
    ozon = ozon && typeof ozon === 'object' ? ozon : {};
    return {
      productId: toText(ozon.productId || ozon.sku).trim(),
      title: toText(ozon.title).trim(),
      url: toText(ozon.url || ozon.sourceUrl).trim(),
    };
  }

  function buildToken(now) {
    return 'img-' + (Number(now) || Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function pruneImageSearchJobs(jobs, now) {
    var cutoff = (Number(now) || Date.now()) - JOB_TTL_MS;
    var entries = Object.keys(jobs || {}).map(function (key) {
      return [key, jobs[key]];
    }).filter(function (entry) {
      var job = entry[1] || {};
      return Number(job.createdAt) >= cutoff;
    }).slice(-JOB_LIMIT);

    return entries.reduce(function (acc, entry) {
      acc[entry[0]] = entry[1];
      return acc;
    }, {});
  }

  function build1688SearchUrl(token) {
    var url = new URL('https://s.1688.com/youyuan/index.htm');
    url.searchParams.set('tab', 'imageSearch');
    url.hash = new URLSearchParams({
      ssErpImageSearch: '1688',
      ssErpImageSearchToken: token,
    }).toString();
    return url.toString();
  }

  function buildPddSearchUrl(token) {
    var url = new URL('https://pifa.pinduoduo.com/search');
    url.hash = new URLSearchParams({
      ssErpImageSearch: 'pdd',
      ssErpImageSearchToken: token,
    }).toString();
    return url.toString();
  }

  function buildTaobaoSearchUrl(token) {
    var url = new URL('https://www.taobao.com/');
    url.hash = new URLSearchParams({
      ssErpImageSearch: 'taobao',
      ssErpImageSearchToken: token,
    }).toString();
    return url.toString();
  }

  function buildSearchUrl(platform, token) {
    var normalized = normalizePlatform(platform);
    if (normalized === '1688') return build1688SearchUrl(token);
    if (normalized === 'pdd') return buildPddSearchUrl(token);
    if (normalized === 'taobao') return buildTaobaoSearchUrl(token);
    throw new Error('暂不支持该搜图平台');
  }

  function createImageSearchJob(existingJobs, input, options) {
    input = input && typeof input === 'object' ? input : {};
    options = options && typeof options === 'object' ? options : {};
    var now = Number(options.now) || Date.now();
    var platform = normalizePlatform(input.platform);
    var imageBase64 = toText(input.imageBase64).trim();
    if (!imageBase64) throw new Error('缺少图片 base64，无法发起搜图');

    var token = toText(options.token).trim() || buildToken(now);
    var jobs = pruneImageSearchJobs(existingJobs, now);
    jobs[token] = {
      platform: platform,
      imageUrl: toText(input.imageUrl).trim(),
      imageBase64: imageBase64,
      imagePreviewDataUrl: toText(input.imagePreviewDataUrl).trim(),
      imageSize: toText(input.imageSize).trim(),
      ozon: normalizeOzon(input.ozon),
      createdAt: now,
    };

    return {
      token: token,
      url: buildSearchUrl(platform, token),
      jobs: jobs,
    };
  }

  return {
    createImageSearchJob: createImageSearchJob,
    build1688SearchUrl: build1688SearchUrl,
    buildPddSearchUrl: buildPddSearchUrl,
    buildTaobaoSearchUrl: buildTaobaoSearchUrl,
    pruneImageSearchJobs: pruneImageSearchJobs,
  };
});
