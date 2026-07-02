import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const templatePage = fs.readFileSync('apps/web/src/app/(dashboard)/admin/warehouse-templates/page.tsx', 'utf8');
const adminPickupPage = fs.readFileSync('apps/web/src/app/(dashboard)/admin/ozon-pickup-points/page.tsx', 'utf8');
const userPickupPage = fs.readFileSync('apps/web/src/app/(dashboard)/ozon-pickup-points/page.tsx', 'utf8');

for (const token of [
  'OZON 仓库物流模板',
  'OZON 发运点同步',
  'OZON 发运点查询',
  '国内收货地址',
]) {
  assert.match(sidebar, new RegExp(token), `sidebar should expose ${token}`);
}

for (const staleLabel of [
  "label: '仓库模板'",
  "label: '仓库指令'",
  "label: 'OZON 揽收点'",
  "label: '国内地址'",
]) {
  assert.doesNotMatch(sidebar, new RegExp(staleLabel), `sidebar should not expose stale label ${staleLabel}`);
}

assert.match(templatePage, /OZON 仓库物流模板/, 'template page should use the Ozon warehouse logistics template title');
assert.match(templatePage, /照填|复制|参考/, 'template page should position templates as user-facing fill/copy guidance');
assert.match(
  templatePage,
  /没有稳定公开的物流创建\/导入接口|不会直接写入 Ozon/,
  'template page should clarify it does not directly create Ozon logistics settings',
);

assert.match(adminPickupPage, /OZON 发运点同步/, 'admin pickup point page should be positioned as Ozon sync');
assert.match(userPickupPage, /OZON 发运点查询/, 'user pickup point page should be positioned as Ozon point lookup');

console.log('PASS web ozon logistics navigation');
