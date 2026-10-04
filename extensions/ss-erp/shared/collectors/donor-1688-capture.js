(function (root) {
  'use strict';

  var PARSER_VERSION = 'ss-erp-donor-1688-v1';
  function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function text(value, maximum) { return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, maximum) : ''; }
  function positive(value) { if (value == null || value === '') return null; var number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
  function stock(value) { if (value == null || value === '') return null; var number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null; }
  function sourceUrl(value) {
    var url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'detail.1688.com' || !/^\/offer\/\d+\.html$/u.test(url.pathname)
      || url.username || url.password) throw new Error('来源商品网址无效');
    return url.origin + url.pathname;
  }
  function mediaUrl(value) {
    try {
      var url = new URL(value);
      var hostname = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || hostname === 'localhost'
        || hostname.includes(':') || /^\d+(?:\.\d+){3}$/u.test(hostname) || hostname.endsWith('.local')
        || hostname === 'metadata.google.internal') return '';
      return url.href;
    } catch { return ''; }
  }
  function videoUrl(value) {
    var candidate = mediaUrl(value);
    if (!candidate) return '';
    var url = new URL(candidate);
    if (candidate.length > 4096 || url.hash || url.hostname.endsWith('.localhost')
      || url.hostname === 'metadata' || !url.hostname.includes('.')
      || !/\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)$/iu.test(url.pathname)) return '';
    return candidate;
  }
  function evidence(type, path, observedAt) {
    return { sourceType: type, sourcePath: path, confidence: type === 'derived' ? 0.5 : 0.9,
      isEstimated: type === 'derived', observedAt: observedAt, parserVersion: PARSER_VERSION,
      derivedFrom: type === 'derived' ? ['/attributes'] : [] };
  }

  function compile(raw, options) {
    var meta = record(raw.meta_info);
    var data = record(raw.global_data);
    var canonicalUrl = sourceUrl(options.url);
    if (sourceUrl(meta.source_url) !== canonicalUrl) throw new Error('来源商品已变化');
    var observedAt = options.observedAt || new Date().toISOString();
    var productId = canonicalUrl.match(/\/offer\/(\d+)\.html$/u)[1];
    var skuType = ['script', 'main_world'].includes(meta.sku_source_type) ? meta.sku_source_type : 'dom';
    var rows = Array.isArray(raw.sku_matrix) ? raw.sku_matrix : [];
    var skuItems = rows.slice(0, 10000).map(function (row, index) {
      var item = record(row);
      var specs = record(item.specs);
      var specText = [text(specs.color_name_cn, 250), text(specs.size_name_cn, 250)].filter(Boolean).join(' / ');
      var sourceId = text(item.sku_unique_id, 200);
      var generatedId = /^sku_(?:standard|group|combo|1688|industrypro|next|pc|table)/u.test(sourceId);
      var isDerived = generatedId && skuType === 'dom';
      var type = isDerived ? 'derived' : skuType;
      var image = mediaUrl(item.sku_image_url);
      return {
        skuId: generatedId ? '' : sourceId, specText: specText, name: specText,
        price: positive(record(item.price).amount), stock: isDerived ? null : stock(item.stock_quantity),
        attrs: specText ? { '规格': specText } : {}, images: image ? [image] : [],
        source: isDerived ? 'attributeMatrix' : 'donor',
        evidence: evidence(type, '/donor/sku_matrix/' + index, observedAt),
      };
    });
    var gallery = record(data.media_gallery);
    var mainImages = (Array.isArray(gallery.main_images) ? gallery.main_images : []).slice(0, 10000).map(mediaUrl).filter(Boolean);
    var detailImages = (Array.isArray(gallery.detail_images) ? gallery.detail_images : []).slice(0, 10000).map(mediaUrl).filter(Boolean);
    var seenVideos = new Set();
    var sourceVideos = [];
    var mediaEvidence = {};
    mainImages.concat(detailImages).forEach(function (url, index) { mediaEvidence[url] = evidence('dom', '/donor/media_gallery/' + index, observedAt); });
    skuItems.forEach(function (row, index) { row.images.forEach(function (url) {
      if (!mediaEvidence[url]) mediaEvidence[url] = evidence(skuType, '/donor/sku_matrix/' + index + '/sku_image_url', observedAt);
    }); });
    (Array.isArray(gallery.video_urls) ? gallery.video_urls : []).slice(0, 10000).forEach(function (value, index) {
      var url = videoUrl(value);
      if (!url || seenVideos.has(url)) return;
      seenVideos.add(url);
      sourceVideos.push({ url: url });
      mediaEvidence[url] = evidence('dom', '/donor/media_gallery/video_urls/' + index, observedAt);
    });
    var title = text(data.product_name, 200000);
    var description = text(data.description_clean_text, 200000);
    if (description === title) description = '';
    var attributes = (Array.isArray(data.features) ? data.features : []).slice(0, 2000).map(function (item) {
      return { name: text(item.name, 300), value: text(item.value, 10000) };
    }).filter(function (item) { return item.name && item.value; });
    var attributeEvidence = {};
    attributes.forEach(function (item, index) { attributeEvidence[item.name + '\u0000' + item.value] = evidence('dom', '/donor/features/' + index, observedAt); });
    var prices = skuItems.map(function (row) { return row.price; }).filter(function (value) { return value !== null; });
    var minimum = prices.length ? Math.min.apply(Math, prices) : null;
    var packageDefaults = record(record(data.packaging).defaults);
    var packageRows = record(data.packaging)._hasRealPackaging === true ? [{
      name: '包装', rawText: '', skuAttrs: {},
      weightG: positive(packageDefaults.weight_g), lengthMm: positive(packageDefaults.length_mm),
      widthMm: positive(packageDefaults.width_mm), heightMm: positive(packageDefaults.height_mm),
      evidence: evidence('dom', '/donor/packaging', observedAt),
    }] : [];
    var truncations = rows.length > 10000 ? [{ stage: 'collector_core', fieldPath: '/skus', observedCount: rows.length,
      retainedCount: 10000, limit: 10000, unit: 'items', reason: 'source_limit', recoverability: 'not_recoverable', fallbackSourcePath: null }] : [];
    var core = root.SS_ERP_SOURCE_PRODUCT_CORE;
    if (!core || typeof core.build1688SourceProductCaptureV2 !== 'function') throw new Error('来源快照编译器不可用');
    var capture = core.build1688SourceProductCaptureV2({
      context: { host: 'detail.1688.com', observedAt: observedAt, parserVersion: PARSER_VERSION,
        extensionVersion: options.extensionVersion || 'unknown', pageBridgeVersion: PARSER_VERSION, bridgeTruncations: truncations },
      productId: productId, url: canonicalUrl, title: title, shopName: '', description: description,
      priceModel: { skuMinPrice: minimum, costPriceForOzon: minimum, ladderPrices: [], displayPrice: '',
        unitPriceText: minimum === null ? '' : '¥' + minimum,
        evidence: Object.assign(evidence('derived', '/donor/sku_minimum', observedAt), { derivedFrom: ['/skus'] }) },
      skuItems: skuItems, attributes: attributes, attributeEvidenceByKey: attributeEvidence,
      mainImages: mainImages, detailImages: detailImages, sourceVideos: sourceVideos, mediaEvidenceByUrl: mediaEvidence,
      factEvidence: { title: evidence('dom', '/donor/product_name', observedAt), description: evidence('dom', '/donor/description', observedAt) },
      packagingRows: packageRows, sources: [], domFallback: {
        categories: [{ id: null,
          name: text(data.category_hint || meta.source_category || meta.source_category_path, 500).split(/\s*(?:>|\/|›|»|→)\s*/).at(-1),
          path: text(meta.source_category_path || meta.source_category || data.category_hint, 4000),
          evidence: evidence('dom', '/donor/meta_info/source_category_path', observedAt),
        }],
      },
      packageDimensionsMm: packageRows.length ? { lengthMm: packageRows[0].lengthMm, widthMm: packageRows[0].widthMm, heightMm: packageRows[0].heightMm } : {},
      packageWeightG: packageRows.length ? packageRows[0].weightG : null, rejectedAssets: [],
    });
    capture.collector.name = 'ss-erp-donor-1688';
    return { platform: '1688', productId: productId, sourceProductId: productId, title: title, sourceUrl: canonicalUrl,
      captureV2: capture, skuItems: skuItems, variants: skuItems, images: mainImages,
      sourceMainImages: mainImages, sourceDetailImages: detailImages, sourceVideos: sourceVideos,
      extractionDiagnostics: { collector: 'DONOR_1688', skuCount: capture.skus.length,
        imageCount: capture.media.filter(function (item) { return item.kind === 'image'; }).length,
        videoCount: sourceVideos.length } };
  }

  async function collect(options) {
    var input = options || {};
    var url = sourceUrl(input.url || root.location.href);
    if (sourceUrl(root.location.href) !== url) throw new Error('来源商品已变化');
    var parser = root.SS_ERP_DONOR_STRATEGIES && root.SS_ERP_DONOR_STRATEGIES.adapter1688;
    if (!parser || typeof parser.scrape !== 'function') throw new Error('原 1688 采集器未加载');
    var started = Date.now();
    var raw = await parser.scrape();
    if (sourceUrl(root.location.href) !== url) throw new Error('来源商品已变化');
    var product = compile(raw, Object.assign({}, input, { url: url }));
    product.extractionDiagnostics.durationMs = Date.now() - started;
    var contract = root.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2;
    var submission = await contract.createSourceProductCaptureV2Submission(product.captureV2);
    var validation = contract.validateSourceProductCaptureV2Submission(submission);
    if (!validation.valid) throw new Error('原采集结果不符合 ERP 快照合同');
    return product;
  }
  root.SS_ERP_DONOR_1688_CAPTURE = { collect: collect, compile: compile };
})(typeof globalThis !== 'undefined' ? globalThis : self);
