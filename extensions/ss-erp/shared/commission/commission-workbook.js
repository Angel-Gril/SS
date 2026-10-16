(function (root) {
  'use strict';
  var PREFIX = 'https://cdn.ozone.ru/s3/ozon-disk-api/global-education/ru/commissions/ozon-fees/comissions/';
  function requireValue(condition) { if (!condition) throw new Error('commission_workbook_invalid'); }
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function decode(value) {
    return String(value).replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, function (_, code) {
      if (code[0] === '#') {
        var point = code[1] === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        requireValue(point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff));
        return String.fromCodePoint(point);
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code];
    });
  }
  function attributes(xml) {
    var result = {}, match, pattern = /([\w:]+)="([^"]*)"/g;
    while ((match = pattern.exec(xml))) result[match[1]] = decode(match[2]);
    return result;
  }
  function xmlText(xml) {
    return text(Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), function (m) { return decode(m[1]); }).join(''));
  }
  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (var bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function archive(bytes) {
    requireValue(bytes instanceof Uint8Array && bytes.length >= 22 && bytes.length <= 3 * 1024 * 1024);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end -= 1) if (view.getUint32(end, true) === 0x06054b50) break;
    requireValue(end >= 0 && view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0);
    var count = view.getUint16(end + 10, true), position = view.getUint32(end + 16, true);
    requireValue(count > 0 && count <= 32 && count === view.getUint16(end + 8, true));
    var directoryEnd = position + view.getUint32(end + 12, true), total = 0, entries = new Map();
    requireValue(directoryEnd <= end);
    for (var index = 0; index < count; index += 1) {
      requireValue(position + 46 <= directoryEnd && view.getUint32(position, true) === 0x02014b50);
      var flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
      var compressed = view.getUint32(position + 20, true), expanded = view.getUint32(position + 24, true);
      var nameLength = view.getUint16(position + 28, true), extra = view.getUint16(position + 30, true), comment = view.getUint16(position + 32, true);
      requireValue(position + 46 + nameLength + extra + comment <= directoryEnd);
      var name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
      requireValue(!entries.has(name) && !name.includes('..') && !name.includes('\\') && !name.startsWith('/') && !(flags & 1));
      total += expanded;
      requireValue(expanded <= 12 * 1024 * 1024 && total <= 16 * 1024 * 1024 && expanded <= Math.max(compressed * 200, 1024));
      entries.set(name, { method: method, compressed: compressed, expanded: expanded, crc: view.getUint32(position + 16, true), offset: view.getUint32(position + 42, true) });
      position += 46 + nameLength + extra + comment;
    }
    requireValue(position === directoryEnd);
    return async function (name, optional) {
      var entry = entries.get(name);
      if (!entry && optional) return '';
      requireValue(entry && (entry.method === 0 || entry.method === 8) && entry.offset + 30 <= bytes.length);
      requireValue(view.getUint32(entry.offset, true) === 0x04034b50);
      var nameLength = view.getUint16(entry.offset + 26, true), extra = view.getUint16(entry.offset + 28, true);
      var start = entry.offset + 30 + nameLength + extra;
      requireValue(new TextDecoder().decode(bytes.subarray(entry.offset + 30, entry.offset + 30 + nameLength)) === name);
      requireValue(start + entry.compressed <= view.getUint32(end + 16, true));
      var data = bytes.subarray(start, start + entry.compressed);
      if (entry.method === 8) {
        var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        var chunks = [], length = 0;
        try {
          while (true) {
            var part = await reader.read(); if (part.done) break;
            length += part.value.length; requireValue(length <= entry.expanded);
            chunks.push(part.value);
          }
        } finally { await reader.cancel().catch(function () {}); }
        data = new Uint8Array(length); var offset = 0;
        chunks.forEach(function (chunk) { data.set(chunk, offset); offset += chunk.length; });
      }
      requireValue(data.length === entry.expanded && crc32(data) === entry.crc);
      var xml = new TextDecoder('utf-8', { fatal: true }).decode(data);
      requireValue(!/<!DOCTYPE|<!ENTITY/i.test(xml));
      return xml;
    };
  }
  function rows(xml, strings) {
    requireValue(!/<f\b/.test(xml));
    var result = [], seen = new Set();
    for (var row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      var number = Number(attributes(row[1]).r);
      requireValue(number > 0 && number <= 12500 && !seen.has(number)); seen.add(number);
      var values = [];
      for (var cell of row[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        var attrs = attributes(cell[1]), reference = /^([A-P])(\d+)$/.exec(attrs.r);
        requireValue(reference && Number(reference[2]) === number);
        var column = reference[1].charCodeAt(0) - 65, match = /<v\b[^>]*>([^<]*)<\/v>/.exec(cell[2]);
        var value = attrs.t === 'inlineStr' ? xmlText(cell[2]) : attrs.t === 's' ? strings[Number(match && match[1])]
          : match ? Number(match[1]) : '';
        requireValue(typeof value === 'string' || Number.isFinite(value));
        requireValue(typeof value !== 'string' || value.length <= 1024);
        values[column] = value;
      }
      result[number] = values;
    }
    return result;
  }
  function effectiveDate(value) {
    var m = /^Starts from (\d{2})\/(\d{2})\/(\d{4})$/.exec(text(value));
    requireValue(m);
    var date = m[3] + '-' + m[2] + '-' + m[1];
    requireValue(new Date(date).toISOString().slice(0, 10) === date && date <= new Date().toISOString().slice(0, 10));
    return date;
  }
  async function parse(bytes) {
    var read = archive(bytes), workbook = await read('xl/workbook.xml'), relationship = await read('xl/_rels/workbook.xml.rels');
    var sheet = Array.from(workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g), function (m) { return attributes(m[1]); }).find(function (s) { return s.name === 'Full ChinaHK'; });
    requireValue(sheet);
    var rel = Array.from(relationship.matchAll(/<Relationship\b([^>]*)\/?\s*>/g), function (m) { return attributes(m[1]); }).find(function (r) { return r.Id === sheet['r:id']; });
    requireValue(rel && /^worksheets\/sheet\d+\.xml$/.test(rel.Target) && rel.TargetMode !== 'External');
    var shared = await read('xl/sharedStrings.xml', true);
    var strings = Array.from(shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), function (m) { return xmlText(m[1]); });
    requireValue(strings.length <= 60000);
    var data = rows(await read('xl/' + rel.Target), strings), header = data[2] || [];
    requireValue(header[0] === 'DescriptiveType' && header[3] === 'DescriptiveCategory3' && header[6] === 'MP Category' && header[9] === 'Brand');
    ['RFBS', 'FBP'].forEach(function (scheme, schemeIndex) {
      ['0 - 1500', '1500.01 - 5000', '5000.01+'].forEach(function (band, bandIndex) {
        requireValue(header[10 + schemeIndex * 3 + bandIndex] === scheme + ' -> ' + band + ' -> Тариф, %');
      });
    });
    var from = effectiveDate((data[1] || [])[9]), rules = [], seen = new Map();
    data.slice(3).forEach(function (row) {
      if (!row || !row.some(function (value) { return value !== ''; })) return;
      requireValue(text(row[0]) && text(row[1]) && text(row[9]));
      var brand = row[9] === 'All' ? '' : text(row[9]);
      var bands = [0, 1, 2].map(function (index) {
        var rfbs = row[10 + index], fbp = row[13 + index];
        requireValue(typeof rfbs === 'number' && rfbs > 0 && rfbs <= 1 && typeof fbp === 'number' && fbp > 0 && fbp <= 1);
        return { minRUB: [0, 1500, 5000][index], maxRUB: [1500, 5000, 0][index],
          rfbs: Math.round(rfbs * 1000000) / 10000, fbp: Math.round(fbp * 1000000) / 10000 };
      });
      var key = JSON.stringify([row[0], row[3], brand]), serialized = JSON.stringify(bands);
      if (seen.has(key)) { requireValue(seen.get(key) === serialized); return; } seen.set(key, serialized);
      rules.push({ category: text(row[1]), group: text(row[4]), aliases: [text(row[0]), text(row[2])].filter(Boolean),
        brand: brand, typeSpecific: true, bands: bands });
    });
    requireValue(rules.length > 0 && rules.length <= 12000);
    return { rules: rules, effectiveFrom: from };
  }
  function attachment(payload) {
    var document = payload && payload.document;
    requireValue(document && document.status === 'active' && document.url === '/commissions/ozon-fees/commissions');
    requireValue(document.regionSettings && document.regionSettings.regions && document.regionSettings.regions.codes.includes('CHN'));
    requireValue(typeof document.contentJson === 'string' && document.contentJson.length <= 1024 * 1024);
    var content = JSON.parse(document.contentJson), found = new Set(), count = 0;
    function walk(node, depth) {
      requireValue(node && typeof node === 'object' && depth <= 30 && ++count <= 15000);
      (Array.isArray(node.marks) ? node.marks : []).forEach(function (mark) {
        if (mark.type !== 'link') return;
        var url = mark.attrs && mark.attrs.href;
        if (typeof url === 'string' && url.startsWith(PREFIX) && /^Tarifs_CN_\d{2}_\d{2}_\d{4}_\d+\.xlsx$/.test(url.slice(PREFIX.length))) found.add(url);
      });
      (Array.isArray(node.content) ? node.content : []).forEach(function (child) { walk(child, depth + 1); });
    }
    walk(content, 0); requireValue(found.size === 1);
    return { url: Array.from(found)[0], documentUpdated: text(document.updated) };
  }
  root.OZON_CALC_COMMISSION_WORKBOOK = { parse: parse, attachment: attachment };
}(typeof globalThis !== 'undefined' ? globalThis : this));
