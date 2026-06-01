import assert from 'node:assert/strict';

const helper = await import('../extensions/ss-erp/shared/currency/price-currency.js');
const api = helper.default || helper.SS_ERP_PRICE_CURRENCY || globalThis.SS_ERP_PRICE_CURRENCY;

assert.ok(api, 'price currency helper should be exported');

const cases = [
  ['50,16 ¥', 'RUB', { price: '50.16', currency: 'CNY' }],
  ['50.16 CNY', 'RUB', { price: '50.16', currency: 'CNY' }],
  ['￥50.16', 'RUB', { price: '50.16', currency: 'CNY' }],
  ['50.16 RMB', 'RUB', { price: '50.16', currency: 'CNY' }],
  ['Итого в CNY', 'RUB', { price: null, currency: 'CNY' }],
  ['309 ₽', null, { price: '309', currency: 'RUB' }],
  ['12 345 ₸', null, { price: '12345', currency: 'KZT' }],
  ['1 234,56 BYN', null, { price: '1234.56', currency: 'BYN' }],
];

for (const [text, fallback, expected] of cases) {
  const actual = api.parsePriceWithCurrency(text, fallback);
  assert.deepEqual(actual, expected, `${text} should parse as ${JSON.stringify(expected)}`);
}

assert.equal(api.detectCurrencyFromText('Сумма в CNY приблизительная', 'RUB'), 'CNY');
assert.equal(api.detectCurrencyFromText('цена 1 299 руб.', null), 'RUB');
assert.equal(api.fallbackCurrencyByHost('www.ozon.kz'), 'KZT');
assert.equal(api.fallbackCurrencyByHost('www.ozon.by'), 'BYN');
assert.equal(api.fallbackCurrencyByHost('www.ozon.ru'), 'RUB');

console.log('PASS ozon price currency parsing');
