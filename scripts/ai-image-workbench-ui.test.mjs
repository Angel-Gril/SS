import assert from 'node:assert/strict';
import fs from 'node:fs';

const pageSource = fs.readFileSync(
  'apps/web/src/app/(dashboard)/image-processing/page.tsx',
  'utf8',
);
const componentSource = fs.readFileSync(
  'apps/web/src/components/ai-image-workbench.tsx',
  'utf8',
);
const source = `${pageSource}\n${componentSource}`;
const serverBootstrapSource = fs.readFileSync('apps/server/src/index.ts', 'utf8');

assert.match(source, /type Tab = 'watermark' \| 'resize' \| 'ai'/);
assert.match(source, /AI 生图\/改图/);
assert.match(source, /生成提示词/);
assert.match(source, /负面提示词/);
assert.match(source, /生成数量/);
assert.match(source, /图片尺寸/);

assert.match(source, /function resolveAssetUrl/);
assert.match(source, /api\.post<AiImageJob>\('\/api\/ai-images\/jobs'/);
assert.match(source, /api\.get<AiImageJob>\(`\/api\/ai-images\/jobs\/\$\{polledJobId\}`\)/);
assert.match(source, /api\.post<AiImageJob>\(`\/api\/ai-images\/jobs\/\$\{job\.id\}\/cancel`/);
assert.match(source, /api\.post<AiImageApplyResult>\(`\/api\/ai-images\/jobs\/\$\{job\.id\}\/apply`/);
assert.match(source, /setJob\(\(current\) =>/);
assert.match(source, /appliedMode: res\.data!\.mode/);
assert.doesNotMatch(source, /setInterval\(/);
assert.match(source, /let cancelled = false/);
assert.match(source, /window\.setTimeout\(pollJob, 2000\)/);
assert.match(source, /window\.clearTimeout\(timer\)/);
assert.match(source, /current\.id !== polledJobId \|\| TERMINAL\.has\(current\.status\)/);

assert.match(source, /useState<'append' \| 'replace'>\('append'\)/);
assert.match(source, /追加到现有图片/);
assert.match(source, /替换现有图片/);
assert.match(source, /替换会覆盖目标商品现有图片/);
assert.match(source, /默认使用“追加”/);
assert.match(source, /候选图片/);
assert.match(source, /targetDescription/);
assert.match(source, /取消任务/);

assert.match(serverBootstrapSource, /import\('\.\/workers\/ai-image-generation\.js'\)/);
assert.match(serverBootstrapSource, /startAiImageGenerationWorker\(\)/);

console.log('PASS AI image workbench UI contract');
