import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createProductVisionTransport } from '../src/services/product-vision-transport.js';
import {
  PRODUCT_VISION_PROMPT,
  productVisionDescriptionSchema,
} from '../src/services/product-vision-workbench.js';

// Standalone, operator-authorized diagnostic. It never registers an app route,
// writes runtime flags, persists business data or retries an uncertain POST.
async function run() {
  if (process.env.PRODUCT_VISION_REAL_CALIBRATION !== 'authorized-synthetic-only')
    throw Error('Explicit synthetic calibration authorization is required');
  dotenv.config({ path: '/opt/ss-erp/current/.env.staging', quiet: true });
  const filename = (await readdir('./dist')).find((name) =>
    /^system-config-schema-.*\.js$/u.test(name),
  );
  if (!filename) throw Error('Runtime config owner unavailable');
  const runtimeConfigPath = './dist/' + filename;
  const configOwner = (await import(runtimeConfigPath)) as {
    getConfig: (key: string) => Promise<unknown>;
  };
  const existingProvider = await configOwner.getConfig('ai_image_provider'),
    existingOrigin = String(await configOwner.getConfig('ai_image_base_url'));
  if (
    existingProvider !== 'dashscope-wanx' ||
    new URL(existingOrigin).origin !== 'https://dashscope.aliyuncs.com'
  )
    throw Error('Approved official credential origin does not match');
  const apiKey = String((await configOwner.getConfig('ai_image_api_key')) || '');
  if (!apiKey) throw Error('Approved official credential unavailable');
  const config = {
    provider: 'custom' as const,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-plus',
    apiKey,
    timeoutMs: 120000,
  };
  const samples = [
    {
      id: 'storage-box',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="650"><rect width="700" height="650" fill="#f2f2f2"/><rect x="140" y="170" width="420" height="320" rx="35" fill="#4294d4"/><rect x="140" y="150" width="420" height="80" rx="28" fill="#7bc4f0"/><rect x="235" y="140" width="230" height="40" rx="16" fill="#245578"/><rect x="275" y="285" width="150" height="65" rx="20" fill="#214c73"/></svg>`,
    },
    {
      id: 'red-shirt',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="650"><rect width="700" height="650" fill="white"/><path d="M260 145 L160 190 L100 330 L205 365 L238 302 L238 530 L462 530 L462 302 L495 365 L600 330 L540 190 L440 145 Q350 220 260 145" fill="#da3333"/><path d="M272 145 Q350 224 428 145" fill="none" stroke="#a01818" stroke-width="14"/><path d="M270 260H430M270 325H430M270 390H430" stroke="#ffffff" stroke-width="22"/></svg>`,
    },
  ];
  const analyze = createProductVisionTransport(),
    results = [];
  for (const sample of samples) {
    const buffer = await sharp(Buffer.from(sample.svg)).jpeg({ quality: 86 }).toBuffer();
    const started = Date.now();
    const response = await analyze({
      config,
      prompt: PRODUCT_VISION_PROMPT,
      images: [{ mimeType: 'image/jpeg', buffer }],
    });
    const parsed = productVisionDescriptionSchema.safeParse(JSON.parse(response.text));
    if (!parsed.success) throw Error('Live model output does not meet the visual JSON contract');
    results.push({
      id: sample.id,
      inputSha256: createHash('sha256').update(buffer).digest('hex'),
      outputSha256: createHash('sha256').update(response.text).digest('hex'),
      visualDescription: parsed.data,
      usage: response.usage,
      elapsedMs: Date.now() - started,
    });
    process.stdout.write(
      JSON.stringify({
        kind: 'synthetic-vision-calibration',
        model: config.model,
        result: results.at(-1),
        providerPosts: results.length,
        ozonWrites: 0,
        productionChanges: 0,
      }) + '\n',
    );
  }
  process.stdout.write(
    JSON.stringify({
      kind: 'synthetic-vision-calibration-complete',
      providerPosts: results.length,
      samples: results.length,
      ozonWrites: 0,
      productionChanges: 0,
    }) + '\n',
  );
}
run()
  .then(() => process.exit(0))
  .catch(() => {
    process.stderr.write(
      'Synthetic calibration failed; no automatic retry. Keep the original outcome for diagnosis.\n',
    );
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1000);
  });
