import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const publicFetcherScript = fs.readFileSync('extensions/ss-erp/shared/product-fetch/ozon-public-fetcher.js', 'utf8');

const sandbox = {
  console,
  globalThis: {},
  location: { hostname: 'www.ozon.ru' },
  URL,
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

const contentOnlyRich = sandbox.OZON_PUBLIC_FETCHER.parseWidgetStates(123456790, {
  widgetStates: {
    webProductHeading: JSON.stringify({ title: 'Скатерть тестовая' }),
    webDescription: JSON.stringify({
      content: [{
        blocks: [
          { text: { content: 'Описание из content.blocks' } },
          { image: { src: 'https://cdn.example.com/rich-content-block.jpg' } },
        ],
      }],
    }),
  },
});

assert.equal(contentOnlyRich.ok, true);
assert.match(contentOnlyRich.description, /Описание из content\.blocks/);
assert.equal(contentOnlyRich.richDescriptionJson, JSON.stringify({
  content: [{
    blocks: [
      { text: { content: 'Описание из content.blocks' } },
      { image: { src: 'https://cdn.example.com/rich-content-block.jpg' } },
    ],
  }],
}));

const fetchedUrls = [];
const slugRichAnnotationJson = {
  content: [{
    blocks: [
      { text: { content: 'Описание со второй страницы' } },
      { img: { src: 'https://cdn.example.com/rich-image.jpg' } },
    ],
  }],
};

const originalFetch = sandbox.fetch;
sandbox.fetch = async (url) => {
  fetchedUrls.push(String(url));
  const decodedUrl = decodeURIComponent(String(url));
  const body = decodedUrl.includes('layout_page_index=2')
    ? {
      widgetStates: {
        'webDescription-1': JSON.stringify({
          richAnnotationJson: slugRichAnnotationJson,
        }),
      },
    }
    : {
      widgetStates: {
        webProductHeading: JSON.stringify({ title: '6 Рафия ручной работыдекор на стену для интерьера' }),
        webGallery: JSON.stringify({ images: ['https://cdn.example.com/main.jpg'] }),
      },
    };
  return {
    ok: true,
    json: async () => body,
  };
};

const fetched = await sandbox.OZON_PUBLIC_FETCHER.fetchOzonProduct(1616509508, {
  sourceUrl: 'https://www.ozon.ru/product/6-rafiya-ruchnoy-rabotydekor-na-stenu-dlya-interera-1616509508/?at=test',
});

assert.equal(fetched.ok, true);
assert.match(fetched.description, /Описание со второй страницы/);
assert.equal(fetched.richDescriptionJson, JSON.stringify(slugRichAnnotationJson));
assert.ok(
  fetchedUrls.some((url) => {
    const decodedUrl = decodeURIComponent(url);
    return decodedUrl.includes('6-rafiya-ruchnoy-rabotydekor-na-stenu-dlya-interera-1616509508') && decodedUrl.includes('layout_page_index=2');
  }),
  'expected rich description fetch to use the full Ozon product slug path',
);
sandbox.fetch = originalFetch;

console.log('PASS Ozon rich description and video extraction');
