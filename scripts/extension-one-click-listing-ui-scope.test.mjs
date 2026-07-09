import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const productContent = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const listOverlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

function functionSlice(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const productQuickDock = functionSlice(productContent, 'renderOzonQuickActions');
const productWorkbench = functionSlice(productContent, 'showOzonSkuWorkbench');
const listQuickDock = functionSlice(listOverlay, 'ensureListQuickActions');
const listWorkbench = functionSlice(listOverlay, 'openListSkuWorkbench');


test('product detail quick dock keeps profit calculator separate and removes selection-data entry points', () => {
  assert.match(productQuickDock, /data-role="quick-open-workbench"/);
  assert.match(productQuickDock, /data-role="quick-profit"/);
  assert.match(productQuickDock, /quick-profit[\s\S]{0,500}openOzonProfitCalculatorFromQuickAction\(\)/);
  assert.doesNotMatch(productQuickDock, /data-role="quick-open-insights"/);
  assert.match(productQuickDock, /data-role="quick-selection-settings"[\s\S]*设置选品/);
  assert.match(productQuickDock, /quick-selection-settings[\s\S]*openExtensionSettingsPage\("selection"\)/);
  assert.doesNotMatch(productContent, /选品数据|SS ERP 选品数据工作台/);
});

test('product detail one-click workbench is listing-only', () => {
  assert.match(productContent, /SS ERP 一键上架工作台/);
  assert.match(productWorkbench, /data-role="publish-workbench"[\s\S]*一键上架选中商品/);
  assert.doesNotMatch(productContent, /SS ERP 利润测算工作台|SS ERP 选品数据工作台/);
  assert.doesNotMatch(productWorkbench, /data-role="workbench-view"|data-mode="data"|data-mode="profit"/);
  assert.doesNotMatch(productWorkbench, /<input[^>]+data-role="cost-cny"/);
  assert.doesNotMatch(productWorkbench, /<input[^>]+data-role="logistics-fee-cny"/);
  assert.doesNotMatch(productWorkbench, /<input[^>]+data-role="commission-rate"/);
});

test('list page quick dock keeps profit calculator separate and removes selection-data entry points', () => {
  assert.match(listQuickDock, /data-role="quick-open-workbench"/);
  assert.match(listQuickDock, /data-role="quick-profit"/);
  assert.match(listQuickDock, /quick-profit[\s\S]{0,500}openProfitCalculatorFromQuickAction\(\)/);
  assert.doesNotMatch(listOverlay, /data-role="quick-open-insights"/);
  assert.match(listQuickDock, /data-role="quick-selection-settings"[\s\S]*设置选品/);
  assert.match(listQuickDock, /quick-selection-settings[\s\S]*showProductSelectionRulesModal\(\)/);
});

test('list page one-click workbench is listing-only', () => {
  assert.match(listOverlay, /SS ERP 一键上架工作台/);
  assert.match(listWorkbench, /data-role="publish-workbench"[\s\S]*一键上架选中商品/);
  assert.doesNotMatch(listOverlay, /SS ERP 利润测算工作台|SS ERP 选品数据工作台/);
  assert.doesNotMatch(listWorkbench, /data-role="workbench-view"|data-mode="data"|data-mode="profit"/);
  assert.match(listWorkbench, /data-role="row-filter"[\s\S]*仅规则命中/);
  assert.match(listOverlay, /rowFilter\.startsWith\('rule:'\)[\s\S]*matchedRules\.some/);
  assert.match(listOverlay, /key:\s*'selection'|label:\s*'选品'/);
  assert.doesNotMatch(listWorkbench, /data-role="save-workbench-data"|data-role="add-selected-workbench-skus-to-pool"|data-role="delete-selected-workbench-skus"|data-role="export-workbench-skus"/);
  assert.doesNotMatch(listWorkbench, /<input[^>]+data-role="cost-cny"|<input[^>]+data-role="logistics-fee-cny"|<input[^>]+data-role="commission-rate"/);
});
