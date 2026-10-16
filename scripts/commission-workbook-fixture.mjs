import { deflateRawSync } from 'node:zlib';

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function workbookFixture({ brand = 'All', extraRows = '', formula = false, future = false, external = false } = {}) {
  const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const textCell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  const header = ['DescriptiveType', 'ZH', 'EN', 'DescriptiveCategory3', 'ZH', 'EN', 'MP Category', 'ZH', 'EN', 'Brand',
    ...['RFBS', 'FBP'].flatMap(scheme => ['0 - 1500', '1500.01 - 5000', '5000.01+'].map(band => `${scheme} -> ${band} -> Тариф, %`))];
  const labels = ['Synthetic Vacuum', '测试吸尘器', 'Synthetic Vacuum', 'Appliances', '电器', 'Appliances', 'Electronics', '电子产品', 'Electronics', brand];
  const row3 = labels.map((v, i) => textCell(String.fromCharCode(65 + i) + '3', v)).join('')
    + [0.12, 0.14, 0.205, 0.11, 0.13, 0.195].map((v, i) => `<c r="${String.fromCharCode(75 + i)}3">${formula && i === 0 ? '<f>1+1</f>' : ''}<v>${v}</v></c>`).join('');
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Full ChinaHK" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData><row r="1">${textCell('J1', 'Starts from 01/12/' + (future ? '2099' : '2025'))}</row><row r="2">${header.map((v, i) => textCell(String.fromCharCode(65 + i) + '2', v)).join('')}</row><row r="3">${row3}</row>${extraRows}</sheetData></worksheet>`,
    ...(external ? { 'xl/externalLinks/externalLink1.xml': '<externalLink href="https://private.invalid/never-fetch"/>' } : {}),
  };
  const local = [], central = []; let offset = 0;
  for (const [filename, value] of Object.entries(files)) {
    const name = Buffer.from(filename), data = Buffer.from(value), compressed = deflateRawSync(data), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(name.length, 26);
    local.push(l, name, compressed);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name); offset += l.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function documentFixture(url = 'https://cdn.ozone.ru/s3/ozon-disk-api/global-education/ru/commissions/ozon-fees/comissions/Tarifs_CN_01_12_2025_1234567890.xlsx') {
  return { document: { status: 'active', url: '/commissions/ozon-fees/commissions', updated: '2026-01-02 00:00:00',
    regionSettings: { regions: { codes: ['CHN'] } }, contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'text', text: '普通类目表',
      marks: [{ type: 'link', attrs: { href: url } }] }, { type: 'text', text: 'WHD', marks: [{ type: 'link', attrs: {
        href: url.replace('Tarifs_CN_', 'China_WHD_'),
      } }] }] }) } };
}
