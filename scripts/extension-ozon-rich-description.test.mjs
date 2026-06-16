import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const publicFetcherScript = fs.readFileSync('extensions/ss-erp/shared/product-fetch/ozon-public-fetcher.js', 'utf8');

const sandbox = {
  console,
  globalThis: {},
  location: { hostname: 'www.ozon.ru' },
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(publicFetcherScript, sandbox, { filename: 'ozon-public-fetcher.js' });

assert.equal(typeof sandbox.OZON_PUBLIC_FETCHER.parseWidgetStates, 'function');

const richAnnotationJson = {
  blocks: [
    { title: 'Описание', content: [{ text: 'Коллекционная фигурка' }] },
    { content: [{ text: 'Высота 14 см' }] },
  ],
};

const result = sandbox.OZON_PUBLIC_FETCHER.parseWidgetStates(123456789, {
  widgetStates: {
    webProductHeading: JSON.stringify({ title: 'Фигурка тестовая' }),
    webGallery: JSON.stringify({
      videos: [{
        videoUrl: 'https://cdn.example.com/video/product-demo.mp4',
        coverUrl: 'https://cdn.example.com/video/product-demo-cover.jpg',
        title: 'Обзор товара',
      }],
    }),
    webRichAnnotation: JSON.stringify({
      richAnnotation: {
        children: [
          { content: 'Короткое описание' },
          { content: [{ value: 'Материал пластик' }] },
        ],
      },
      richAnnotationJson,
    }),
  },
});

assert.equal(result.ok, true);
assert.match(result.description, /Коллекционная фигурка|Короткое описание/);
assert.match(result.description, /Материал пластик|Высота 14 см/);
assert.equal(result.richDescriptionJson, JSON.stringify(richAnnotationJson));
assert.deepEqual(JSON.parse(JSON.stringify(result.sourceVideos)), [{
  url: 'https://cdn.example.com/video/product-demo.mp4',
  coverUrl: 'https://cdn.example.com/video/product-demo-cover.jpg',
  title: 'Обзор товара',
}]);

console.log('PASS Ozon rich description and video extraction');
