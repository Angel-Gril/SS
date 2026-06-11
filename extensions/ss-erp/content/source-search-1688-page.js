(function () {
  'use strict';

  var REQUEST_SOURCE = 'ss-erp-image-search-1688-bridge';
  var RESULT_SOURCE = 'ss-erp-image-search-1688-page';
  var runningTokens = {};

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (event.source !== window || data.source !== REQUEST_SOURCE) return;
    if (!data.token || !data.imageBase64 || runningTokens[data.token]) return;

    runningTokens[data.token] = true;
    uploadAndJump(data.token, data.imageBase64)
      .catch(function (error) {
        sendResult(data.token, { ok: false, error: error && error.message ? error.message : String(error) });
      })
      .finally(function () {
        delete runningTokens[data.token];
      });
  });

  async function uploadAndJump(token, imageBase64) {
    var response = await requestImageSearch(imageBase64);
    var imageIds = findImageIds(response);
    var imageId = imageIds[0] || '';
    if (!imageId) throw new Error('1688 未返回图片搜索 ID');

    var url = buildResultUrl(imageId, imageIds);
    sendResult(token, { ok: true, imageId: imageId, url: url });
    window.setTimeout(function () {
      window.location.href = url;
    }, 50);
  }

  async function requestImageSearch(imageBase64) {
    var data = buildUploadData(imageBase64);
    var nativeResponse = await requestMtopNative(data).catch(function () { return null; });
    if (findImageIds(nativeResponse).length > 0) return nativeResponse;

    var response = await requestMtopJsonp(data);
    if (isTokenExpired(response)) response = await requestMtopJsonp(data);
    return response;
  }

  function buildUploadData(imageBase64) {
    var params = {
      searchScene: 'imageEx',
      interfaceName: 'imageBase64ToImageId',
      'serviceParam.extendParam[imageBase64]': imageBase64,
      subChannel: 'pc_image_search_image_id'
    };
    return JSON.stringify({
      appId: 32517,
      params: JSON.stringify(params)
    });
  }

  function requestMtopNative(data) {
    return withTimeout(new Promise(function (resolve, reject) {
      var mtop = window.lib && window.lib.mtop;
      var request = (window.searchSpace && window.searchSpace.request) || (mtop && mtop.request);
      if (!request) {
        reject(new Error('1688 原生 MTOP 不可用'));
        return;
      }
      if (mtop) {
        mtop.config = mtop.config || {};
        mtop.config.prefix = 'h5api';
        mtop.config.mainDomain = '1688.com';
        mtop.config.subDomain = location.href.indexOf('__mtop_subdomain__=wapa') >= 0 ? 'wapa' : 'm';
      }
      request({
        api: 'mtop.relationrecommend.WirelessRecommend.recommend',
        ignoreLogin: true,
        prefix: 'h5api',
        data: {
          appId: 32517,
          params: JSON.parse(data).params
        },
        v: '2.0',
        ecode: 0,
        type: 'POST',
        dataType: 'jsonp',
        jsonpIncPrefix: 'search1688',
        timeout: 20000,
        trackerConfig: { requestCode: '32517_imageBase64ToImageId' }
      }).then(function (response) {
        resolve(response && response.data ? response.data : (response || {}));
      }).catch(reject);
    }), 8000, '1688 原生图片上传超时');
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        reject(new Error(message));
      }, ms);
      promise.then(function (value) {
        window.clearTimeout(timer);
        resolve(value);
      }).catch(function (error) {
        window.clearTimeout(timer);
        reject(error);
      });
    });
  }

  function requestMtopJsonp(data) {
    return new Promise(function (resolve, reject) {
      var appKey = '12574478';
      var api = 'mtop.relationrecommend.WirelessRecommend.recommend';
      var version = '2.0';
      var timestamp = String(Date.now());
      var token = getMtopToken();
      var sign = md5(token + '&' + timestamp + '&' + appKey + '&' + data);
      var callback = 'ssErpMtop_' + timestamp + '_' + Math.random().toString(36).slice(2);
      var url = new URL('https://h5api.m.1688.com/h5/' + api.toLowerCase() + '/' + version + '/');
      url.searchParams.set('jsv', '2.7.4');
      url.searchParams.set('appKey', appKey);
      url.searchParams.set('t', timestamp);
      url.searchParams.set('sign', sign);
      url.searchParams.set('api', api);
      url.searchParams.set('v', version);
      url.searchParams.set('type', 'jsonp');
      url.searchParams.set('dataType', 'jsonp');
      url.searchParams.set('timeout', '20000');
      url.searchParams.set('jsonpIncPrefix', 'search1688');
      url.searchParams.set('callback', callback);
      url.searchParams.set('data', data);

      var script = document.createElement('script');
      var timeout = window.setTimeout(function () {
        cleanup();
        reject(new Error('1688 图片上传接口超时'));
      }, 22000);

      window[callback] = function (payload) {
        cleanup();
        resolve(payload);
      };
      script.onerror = function () {
        cleanup();
        reject(new Error('1688 图片上传接口加载失败'));
      };
      script.src = url.toString();
      document.head.appendChild(script);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callback];
        script.remove();
      }
    });
  }

  function getMtopToken() {
    var match = document.cookie.match(/(?:^|;\s*)_m_h5_tk=([^;]+)/);
    var value = match ? decodeURIComponent(match[1]) : '';
    return value.split('_')[0] || '';
  }

  function isTokenExpired(response) {
    var ret = response && response.ret;
    var text = Array.isArray(ret) ? ret.join(',') : String(ret || '');
    return /FAIL_SYS.*TOKEN|FAIL_SYS_ILLEGAL_ACCESS|令牌/i.test(text);
  }

  function findImageIds(value) {
    var ids = [];
    var seen = {};

    function add(raw) {
      var text = String(raw || '').trim();
      if (!text) return;
      text.split(',').forEach(function (item) {
        var id = item.trim();
        if (id && !seen[id]) {
          seen[id] = true;
          ids.push(id);
        }
      });
    }

    function visit(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== 'object') return;
      Object.keys(node).forEach(function (key) {
        var val = node[key];
        if (key === 'imageId' || key === 'image_id' || key === 'imageIdList') {
          add(val);
        } else if (val && typeof val === 'object') {
          visit(val);
        }
      });
    }

    visit(value);
    return ids;
  }

  function buildResultUrl(imageId, imageIds) {
    var url = new URL('https://s.1688.com/youyuan/index.htm');
    url.searchParams.set('tab', 'imageSearch');
    url.searchParams.set('imageId', imageId);
    url.searchParams.set('imageIdList', imageIds.join(',') || imageId);
    url.searchParams.set('spm', 'a26352.13672862.imageUpload.i0');
    return url.toString();
  }

  function sendResult(token, payload) {
    var message = {
      source: RESULT_SOURCE,
      token: token
    };
    Object.keys(payload || {}).forEach(function (key) {
      message[key] = payload[key];
    });
    window.postMessage(message, location.origin);
  }

  function md5(input) {
    function add32(a, b) {
      return (a + b) & 0xffffffff;
    }
    function cmn(q, a, b, x, s, t) {
      return add32((add32(add32(a, q), add32(x, t)) << s) | (add32(add32(a, q), add32(x, t)) >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, t) {
      return cmn((b & c) | ((~b) & d), a, b, x, s, t);
    }
    function gg(a, b, c, d, x, s, t) {
      return cmn((b & d) | (c & (~d)), a, b, x, s, t);
    }
    function hh(a, b, c, d, x, s, t) {
      return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a, b, c, d, x, s, t) {
      return cmn(c ^ (b | (~d)), a, b, x, s, t);
    }
    function md5cycle(state, block) {
      var a = state[0];
      var b = state[1];
      var c = state[2];
      var d = state[3];

      a = ff(a, b, c, d, block[0], 7, -680876936);
      d = ff(d, a, b, c, block[1], 12, -389564586);
      c = ff(c, d, a, b, block[2], 17, 606105819);
      b = ff(b, c, d, a, block[3], 22, -1044525330);
      a = ff(a, b, c, d, block[4], 7, -176418897);
      d = ff(d, a, b, c, block[5], 12, 1200080426);
      c = ff(c, d, a, b, block[6], 17, -1473231341);
      b = ff(b, c, d, a, block[7], 22, -45705983);
      a = ff(a, b, c, d, block[8], 7, 1770035416);
      d = ff(d, a, b, c, block[9], 12, -1958414417);
      c = ff(c, d, a, b, block[10], 17, -42063);
      b = ff(b, c, d, a, block[11], 22, -1990404162);
      a = ff(a, b, c, d, block[12], 7, 1804603682);
      d = ff(d, a, b, c, block[13], 12, -40341101);
      c = ff(c, d, a, b, block[14], 17, -1502002290);
      b = ff(b, c, d, a, block[15], 22, 1236535329);

      a = gg(a, b, c, d, block[1], 5, -165796510);
      d = gg(d, a, b, c, block[6], 9, -1069501632);
      c = gg(c, d, a, b, block[11], 14, 643717713);
      b = gg(b, c, d, a, block[0], 20, -373897302);
      a = gg(a, b, c, d, block[5], 5, -701558691);
      d = gg(d, a, b, c, block[10], 9, 38016083);
      c = gg(c, d, a, b, block[15], 14, -660478335);
      b = gg(b, c, d, a, block[4], 20, -405537848);
      a = gg(a, b, c, d, block[9], 5, 568446438);
      d = gg(d, a, b, c, block[14], 9, -1019803690);
      c = gg(c, d, a, b, block[3], 14, -187363961);
      b = gg(b, c, d, a, block[8], 20, 1163531501);
      a = gg(a, b, c, d, block[13], 5, -1444681467);
      d = gg(d, a, b, c, block[2], 9, -51403784);
      c = gg(c, d, a, b, block[7], 14, 1735328473);
      b = gg(b, c, d, a, block[12], 20, -1926607734);

      a = hh(a, b, c, d, block[5], 4, -378558);
      d = hh(d, a, b, c, block[8], 11, -2022574463);
      c = hh(c, d, a, b, block[11], 16, 1839030562);
      b = hh(b, c, d, a, block[14], 23, -35309556);
      a = hh(a, b, c, d, block[1], 4, -1530992060);
      d = hh(d, a, b, c, block[4], 11, 1272893353);
      c = hh(c, d, a, b, block[7], 16, -155497632);
      b = hh(b, c, d, a, block[10], 23, -1094730640);
      a = hh(a, b, c, d, block[13], 4, 681279174);
      d = hh(d, a, b, c, block[0], 11, -358537222);
      c = hh(c, d, a, b, block[3], 16, -722521979);
      b = hh(b, c, d, a, block[6], 23, 76029189);
      a = hh(a, b, c, d, block[9], 4, -640364487);
      d = hh(d, a, b, c, block[12], 11, -421815835);
      c = hh(c, d, a, b, block[15], 16, 530742520);
      b = hh(b, c, d, a, block[2], 23, -995338651);

      a = ii(a, b, c, d, block[0], 6, -198630844);
      d = ii(d, a, b, c, block[7], 10, 1126891415);
      c = ii(c, d, a, b, block[14], 15, -1416354905);
      b = ii(b, c, d, a, block[5], 21, -57434055);
      a = ii(a, b, c, d, block[12], 6, 1700485571);
      d = ii(d, a, b, c, block[3], 10, -1894986606);
      c = ii(c, d, a, b, block[10], 15, -1051523);
      b = ii(b, c, d, a, block[1], 21, -2054922799);
      a = ii(a, b, c, d, block[8], 6, 1873313359);
      d = ii(d, a, b, c, block[15], 10, -30611744);
      c = ii(c, d, a, b, block[6], 15, -1560198380);
      b = ii(b, c, d, a, block[13], 21, 1309151649);
      a = ii(a, b, c, d, block[4], 6, -145523070);
      d = ii(d, a, b, c, block[11], 10, -1120210379);
      c = ii(c, d, a, b, block[2], 15, 718787259);
      b = ii(b, c, d, a, block[9], 21, -343485551);

      state[0] = add32(a, state[0]);
      state[1] = add32(b, state[1]);
      state[2] = add32(c, state[2]);
      state[3] = add32(d, state[3]);
    }
    function md5blk(text) {
      var blocks = [];
      for (var i = 0; i < 64; i += 4) {
        blocks[i >> 2] = text.charCodeAt(i)
          + (text.charCodeAt(i + 1) << 8)
          + (text.charCodeAt(i + 2) << 16)
          + (text.charCodeAt(i + 3) << 24);
      }
      return blocks;
    }
    function md51(text) {
      var utf8 = unescape(encodeURIComponent(text));
      var length = utf8.length;
      var state = [1732584193, -271733879, -1732584194, 271733878];
      var i;
      for (i = 64; i <= length; i += 64) {
        md5cycle(state, md5blk(utf8.substring(i - 64, i)));
      }
      var tail = Array(16).fill(0);
      var rest = utf8.substring(i - 64);
      for (i = 0; i < rest.length; i += 1) {
        tail[i >> 2] |= rest.charCodeAt(i) << ((i % 4) << 3);
      }
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        tail.fill(0);
      }
      tail[14] = length * 8;
      md5cycle(state, tail);
      return state;
    }
    function rhex(n) {
      var s = '';
      for (var j = 0; j < 4; j += 1) {
        s += ('0' + ((n >> (j * 8 + 4)) & 0x0f).toString(16)).slice(-1)
          + ('0' + ((n >> (j * 8)) & 0x0f).toString(16)).slice(-1);
      }
      return s;
    }
    return md51(String(input)).map(rhex).join('');
  }
})();
