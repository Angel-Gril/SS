(function (root, factory) {
  var api = factory(root);
  root.SS_ERP_SOURCE_NETWORK_PAGE_HOOK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var SOURCE = 'ss-erp-source-network-page';
  var BRIDGE_SOURCE = 'ss-erp-source-network-bridge';
  var INIT = 'SS_ERP_SOURCE_NETWORK_INIT';
  var CANDIDATE = 'SS_ERP_SOURCE_NETWORK_CANDIDATE';
  var MAX_RAW_BYTES = 262144;
  var MAX_CANDIDATE_BYTES = 65536;
  var MAX_ENTRIES = 20;
  var MAX_TOTAL_BYTES = 524288;
  var TTL_MS = 120000;
  var channel = null;
  var sequence = 0;
  var totalBytes = 0;
  var interceptorsInstalled = false;

  var RULES = [
    {
      platform: 'pdd',
      host: 'api.pinduoduo.com',
      path: '/api/goods/detail',
      methods: ['GET', 'POST'],
      signature: 'pdd.mobile.goods.detail.v2',
    },
    {
      platform: 'taobao',
      host: 'h5api.m.taobao.com',
      path: '/h5/mtop.taobao.detail.getdetail/7.0/',
      methods: ['GET', 'POST'],
      signature: 'mtop.taobao.detail.getdetail.v7',
    },
  ];

  function canonicalPage() {
    var url = new URL(root.location.href);
    var host = url.hostname.toLowerCase();
    var productId = '';
    var platform = '';
    if (host === 'mobile.yangkeduo.com' && url.pathname === '/goods.html') {
      platform = 'pdd';
      productId = url.searchParams.get('goods_id') || '';
    } else if (
      (host === 'item.taobao.com' || host === 'detail.tmall.com') &&
      url.pathname === '/item.htm'
    ) {
      platform = 'taobao';
      productId = url.searchParams.get('id') || '';
    }
    return {
      platform: platform,
      productId: /^\d{4,32}$/.test(productId) ? productId : '',
      generationKey: host + url.pathname + ':' + productId,
    };
  }

  function matchRequest(input, method) {
    var url;
    try {
      url = new URL(
        typeof input === 'string' ? input : input && (input.url || input.href),
        root.location.href,
      );
    } catch (_) {
      return null;
    }
    var verb = String(method || (input && input.method) || 'GET').toUpperCase();
    var matched =
      RULES.find(function (rule) {
        return (
          url.protocol === 'https:' &&
          !url.port &&
          url.hostname.toLowerCase() === rule.host &&
          url.pathname === rule.path &&
          rule.methods.indexOf(verb) >= 0
        );
      }) || null;
    return matched ? Object.assign({}, matched, { method: verb }) : null;
  }

  function project(rule, value) {
    value = value && value.data && typeof value.data === 'object' ? value.data : value;
    if (rule.platform === 'pdd') {
      var result = (value && value.result) || {};
      return {
        result: {
          goods_id: String(result.goods_id || ''),
          goods_name: cleanText(result.goods_name, 500),
          goods_image_url: cleanUrl(result.goods_image_url),
          skus: boundedArray(result.skus, 500).map(function (row) {
            return {
              sku_id: String((row && row.sku_id) || '').slice(0, 80),
              price_fen: Number(row && row.price_fen),
              specs: boundedArray(row && row.specs, 20).map(function (spec) {
                return {
                  name: cleanText(spec && spec.name, 80),
                  value: cleanText(spec && spec.value, 160),
                };
              }),
            };
          }),
        },
      };
    }
    var item = (value && value.item) || {};
    var skuBase = (value && value.skuBase) || {};
    var sku2info = (value && value.skuCore && value.skuCore.sku2info) || {};
    var projectedMap = {};
    boundedArray(skuBase.skus, 500).forEach(function (row) {
      var id = String((row && row.skuId) || '').slice(0, 80);
      if (id && sku2info[id])
        projectedMap[id] = {
          price: { priceText: cleanText(sku2info[id].price && sku2info[id].price.priceText, 40) },
        };
    });
    return {
      item: {
        itemId: String(item.itemId || '').slice(0, 32),
        title: cleanText(item.title, 500),
        images: boundedArray(item.images, 50).map(cleanUrl).filter(Boolean),
      },
      skuBase: {
        props: boundedArray(skuBase.props, 40).map(function (prop) {
          return {
            pid: String((prop && (prop.pid || prop.propId)) || '').slice(0, 80),
            propName: cleanText(prop && (prop.propName || prop.name), 80),
            values: boundedArray(prop && prop.values, 100).map(function (entry) {
              return {
                vid: String((entry && (entry.vid || entry.valueId)) || '').slice(0, 80),
                name: cleanText(entry && (entry.name || entry.value), 160),
                image: cleanUrl(entry && (entry.image || entry.imageUrl)),
              };
            }),
          };
        }),
        skus: boundedArray(skuBase.skus, 500).map(function (row) {
          return {
            skuId: String((row && row.skuId) || '').slice(0, 80),
            propPath: cleanText(row && row.propPath, 500),
          };
        }),
      },
      skuCore: { sku2info: projectedMap },
    };
  }

  function cleanText(value, limit) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, limit);
  }
  function cleanUrl(value) {
    try {
      var url = new URL(String(value || ''), root.location.href);
      return url.protocol === 'https:' ? url.origin + url.pathname : '';
    } catch (_) {
      return '';
    }
  }
  function boundedArray(value, limit) {
    return Array.isArray(value) ? value.slice(0, limit) : [];
  }
  function byteLength(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }
  function utf8ByteLength(value) {
    return new TextEncoder().encode(String(value || '')).length;
  }

  function emit(rule, parsed) {
    if (!channel || Date.now() - channel.createdAt > TTL_MS || sequence >= MAX_ENTRIES) return;
    var page = canonicalPage();
    if (!page.productId || page.generationKey !== channel.generationKey) return;
    var body = project(rule, parsed);
    var bytes = byteLength(body);
    if (bytes > MAX_CANDIDATE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) return;
    sequence += 1;
    totalBytes += bytes;
    root.postMessage(
      {
        source: SOURCE,
        type: CANDIDATE,
        nonce: channel.nonce,
        generation: channel.generation,
        productId: page.productId,
        platform: page.platform,
        sequence: sequence,
        observedAt: Date.now(),
        candidate: {
          signature: rule.signature,
          method: rule.method,
          url: rule.host + rule.path,
          body: body,
          bytes: bytes,
        },
      },
      root.location.origin,
    );
  }

  function channelActive() {
    return channel && Date.now() - channel.createdAt <= TTL_MS && sequence < MAX_ENTRIES;
  }
  function responseMatchesRule(rule, responseUrl) {
    var matched = responseUrl ? matchRequest(responseUrl, rule && rule.method) : null;
    return Boolean(
      matched && rule && matched.platform === rule.platform &&
      matched.signature === rule.signature && matched.method === rule.method,
    );
  }
  async function readBoundedText(response, limit) {
    var declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > limit) {
      try { if (response.body) await response.body.cancel(); } catch (_) {}
      return null;
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      return null;
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var text = '';
    var total = 0;
    while (true) {
      var part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  }
  function inspect(rule, response) {
    if (!channelActive() || !responseMatchesRule(rule, response && response.url)) return;
    try {
      var clone = response.clone();
      readBoundedText(clone, MAX_RAW_BYTES)
        .then(function (text) {
          if (text == null || !channelActive()) return;
          try {
            emit(rule, JSON.parse(text));
          } catch (_) {}
        })
        .catch(function () {});
    } catch (_) {}
  }

  function installInterceptors() {
    if (interceptorsInstalled || root.top !== root || !root.fetch || !root.XMLHttpRequest) return false;
    interceptorsInstalled = true;
    var originalFetch = root.fetch;
    root.fetch = function (input, init) {
      var rule = matchRequest(input, init && init.method);
      return originalFetch.apply(this, arguments).then(function (response) {
        if (rule && channelActive()) inspect(rule, response);
        return response;
      });
    };
    var OriginalXHR = root.XMLHttpRequest;
    var open = OriginalXHR.prototype.open;
    var send = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function (method, url) {
      this.__ssErpRule = matchRequest(url, method);
      return open.apply(this, arguments);
    };
    OriginalXHR.prototype.send = function () {
      if (this.__ssErpRule)
        this.addEventListener('load', function () {
          if (!channelActive() || !responseMatchesRule(this.__ssErpRule, this.responseURL)) return;
          var text = '';
          try {
            text = typeof this.responseText === 'string' ? this.responseText : '';
          } catch (_) {
            if (this.response && typeof this.response === 'object') {
              try { text = JSON.stringify(this.response); } catch (_) {}
            }
          }
          if (utf8ByteLength(text) <= MAX_RAW_BYTES && channelActive()) {
            try { emit(this.__ssErpRule, JSON.parse(text)); } catch (_) {}
          }
        });
      return send.apply(this, arguments);
    };
    return true;
  }
  function install() {
    if (root.top !== root) return false;
    root.addEventListener('message', function (event) {
      var data = event.data;
      if (
        event.source !== root ||
        event.origin !== root.location.origin ||
        !data ||
        data.source !== BRIDGE_SOURCE ||
        data.type !== INIT
      )
        return;
      var page = canonicalPage();
      if (
        !page.productId ||
        data.productId !== page.productId ||
        data.platform !== page.platform ||
        data.generationKey !== page.generationKey
      )
        return;
      if (
        !/^[a-f0-9]{32}$/.test(String(data.nonce || '')) ||
        !Number.isSafeInteger(data.generation)
      )
        return;
      if (channel && data.generation <= channel.generation) return;
      channel = {
        nonce: data.nonce,
        generation: data.generation,
        generationKey: page.generationKey,
        createdAt: Date.now(),
      };
      sequence = 0;
      totalBytes = 0;
      installInterceptors();
    });
    return true;
  }

  var api = {
    canonicalPage: canonicalPage,
    matchRequest: matchRequest,
    readBoundedText: readBoundedText,
    responseMatchesRule: responseMatchesRule,
    project: project,
    install: install,
    constants: {
      MAX_RAW_BYTES: MAX_RAW_BYTES,
      MAX_CANDIDATE_BYTES: MAX_CANDIDATE_BYTES,
      MAX_ENTRIES: MAX_ENTRIES,
      MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
      TTL_MS: TTL_MS,
    },
  };
  if (root.window === root && root.document) install();
  return api;
});
