# 重量识别和面板优化 - 改动总结

## 改动日期
2025-05-24

## 改动文件
1. `extensions/ss-erp/background/collect-background.js`
2. `extensions/ss-erp/content/collect-content-script.js`
3. `extensions/ss-erp/content/ozon-panel.js`
4. `apps/server/src/routes/product.ts`

---

## 一、重量识别优化

### 问题
- 计算器面板依赖 DOM 正则识别重量，在页面语言变化（哈萨克语、白俄语）或 Google Translate 翻译后失效
- 数据面板只显示包装重量（attribute 4497），未显示产品净重（attribute 4383）
- 两个面板数据不一致，用户困惑

### 解决方案

#### 1. 后端数据提取（`collect-background.js`）
**新增字段**：
```javascript
result.productWeightGrams = null;  // attribute 4383 - 产品净重
result.weightGrams = null;         // attribute 4497 - 包装重量（已有）
```

**提取逻辑**：
```javascript
if (key === "4383") result.productWeightGrams = numericValue;
if (key === "4497") result.weightGrams = numericValue;
```

#### 2. 数据面板显示（`collect-content-script.js`）
**新增三行显示**：
- 产品净重：2020 g
- 包装重量：2274 g
- 计算用重量：2274 g (取大值)

**共享数据**：
```javascript
window.__OZON_INSIGHTS_SPECS__ = specs;  // 包含 productWeightGrams 和 weightGrams
```

#### 3. 计算器面板逻辑（`ozon-panel.js`）
**新的优先级**：
```
1. Seller API 共享数据（productWeightGrams / weightGrams 取大值）
2. data-state JSON 特征数据（语言无关）
3. aspects widget
4. specification summary 文本
5. DOM HTML 正则（最后手段）
```

**重量来源标注**：
- `seller-api`：显示"卖家API：净重 2020g / 包装 2274g，计算用 2274g（取大值）"
- `characteristics-state`：显示"特征数据 2020 g"
- `page-regex`：显示"页面识别 2020 g"

**新增字段到 product 对象**：
```javascript
{
  weightG: 2274,           // 计算用重量（取大值）
  weightSource: 'seller-api',
  productWeightG: 2020,    // 产品净重
  packageWeightG: 2274     // 包装重量
}
```

---

## 二、数据面板 UI 重构

### 问题
- 原面板固定在右下角，与计算器面板（右侧）位置冲突
- 占用中间商品图片区域

### 解决方案
**左侧悬浮抽屉式面板**：
- 默认收起：左侧边缘显示竖排 "📊 数据一览" 标签（宽度 44px）
- hover 自动展开：300ms 延迟展开为 340px 宽面板
- 离开自动收起：600ms 延迟收起
- 手动控制：点击标签展开，点击 "◀" 按钮收起

**样式特点**：
- `position: fixed; left: 0; top: 50%; transform: translateY(-50%)`
- `border-radius: 0 12px 12px 0`（右侧圆角）
- `transition: width 0.25s cubic-bezier(0.4,0,0.2,1)`（平滑动画）
- 内容区域 `max-height: 70vh; overflow-y: auto`（长列表可滚动）

**移除功能**：
- 删除拖拽移动（左侧固定位置更符合预期）
- 删除折叠/展开切换（改为 hover 自动展开）
- 删除关闭按钮（改为收起按钮）

---

## 三、ERP 仓库报错修复

### 问题
- 用户修改价格/库存时报错"仓库状态异常"，但 OZON 后台显示商品正常
- 原因：ERP 保存的 `warehouse_id` 已归档，但未自动同步最新仓库列表

### 解决方案（`apps/server/src/routes/product.ts`）
**遇到 `WAREHOUSE_WRONG_STATUS` 时自动重试**：
1. 调用 `client.getWarehouseList()` 刷新仓库列表
2. 更新数据库中的仓库状态
3. 查找第一个有效仓库（status in ['created', 'working', 'active']）
4. 用新仓库 ID 重试 `updateStock`
5. 成功返回"库存更新成功（已自动切换仓库）"
6. 失败返回"仓库状态异常，已尝试自动切换但未找到可用仓库"

**代码位置**：`product.ts:186-221`

---

## 四、测试验证

### 语法检查
```bash
node --check extensions/ss-erp/background/collect-background.js  ✓
node --check extensions/ss-erp/content/ozon-panel.js             ✓
node --check extensions/ss-erp/content/collect-content-script.js ✓
```

### 数据流验证
1. **后端提取** → `extractOzonSpecifications()` 返回 `productWeightGrams` 和 `weightGrams`
2. **数据面板** → `fillOzonPanel()` 设置 `window.__OZON_INSIGHTS_SPECS__`
3. **计算器面板** → `extractWeightFromPage()` 读取共享数据，`collectPageProduct()` 返回 `productWeightG` / `packageWeightG`
4. **显示逻辑** → `weightSourceText()` 根据 `weightSource` 显示不同来源标注

### 测试用例

| SKU        | 页面产品重量 | API 4383 | API 4497 | 计算器应显示 | 数据面板应显示                     |
|------------|--------------|----------|----------|--------------|-----------------------------------|
| 2885224294 | 70g          | 71g      | 71g      | 71g          | 净重 71g / 包装 71g / 计算 71g    |
| 286030186  | 22g          | -        | 40g      | 40g          | 净重 - / 包装 40g / 计算 40g      |
| 1011719445 | 2020g        | 2020g    | 2274g    | 2274g        | 净重 2020g / 包装 2274g / 计算 2274g |
| 4125916275 | 无           | -        | 300g     | 300g         | 净重 - / 包装 300g / 计算 300g    |

---

## 五、未完成功能（待规划）

### 3. 商品信息流页面注入悬浮窗
**需求**：在搜索/分类页面的每个商品卡片下方注入信息卡片

**实现要点**：
- 用 `MutationObserver` 监听商品列表容器 DOM 变化
- 提取商品卡片中的 SKU → 调用 Seller API → 注入信息卡片
- 用属性标记已处理的卡片避免重复

**参考**：企鹅店长用 `setInterval(500ms)` 轮询 + `pose="1"` 标记

### 4. 多 SKU 关联采集
**需求**：采集有变体的商品时，自动采集所有关联 SKU

**实现要点**：
- 从 `entrypoint-api.bx/page/json/v2` 获取页面 JSON
- 解析 `webAspects-*` widget 中的 `aspectModalInfo.link`
- 调用 `generateCombinations(aspects)` 生成所有变体组合
- 逐个请求变体页面获取完整数据
- 将关联 SKU 作为一组推送到 ERP

**已有基础**：
- `pickSkuItems()` 已能提取 SKU 列表
- `collectOzonViaApi()` 已调用 entrypoint-api

**缺失部分**：
- aspects widget 变体链接提取
- 批量请求变体数据
- 保持关联关系推送到 ERP

---

## 六、建议后续优化

1. **尺寸识别**：已添加 `extractDimensionsFromCharacteristicsState()`，但未在数据面板显示产品净尺寸（只显示包装尺寸）
2. **缓存机制**：`window.__OZON_INSIGHTS_SPECS__` 在页面刷新后丢失，可考虑用 `sessionStorage` 持久化
3. **错误提示**：数据面板加载失败时，应显示具体错误原因（当前只显示"读取 Ozon 数据失败"）
4. **性能优化**：`extractWeightFromCharacteristicsState()` 每次都遍历所有 characteristics，可缓存结果

---

## 七、浏览器翻译导致价格识别错误修复

### 问题
用户在俄语页面用浏览器自带翻译翻译成中文后，扩展显示的价格从 ¥111.04 变成 ¥10.63（错误）。

### 根因
`extractPriceBundle()` 函数中硬编码了俄语字符串搜索：
```javascript
var bankPrices = findPricesBefore('с Ozon Банком', 1);
var noBankPrices = findPricesBefore('без Ozon Банка', 2);
```

浏览器翻译后：
- "с Ozon Банком" → "与 Ozon 银行"
- "без Ozon Банка" → "没有 Ozon 银行"

代码还在搜索俄语字符串，找不到，导致价格识别逻辑走到 fallback 分支，从被翻译破坏的 DOM 文本中提取出错误价格。

### 解决方案（`ozon-panel.js`）
**优先使用 `data-state` JSON 数据**（不受浏览器翻译影响）：

```javascript
// Priority 1: structured data-state JSON (immune to browser translation)
var semantic = extractSemanticPricesFromDataState();

// Priority 2: text search (only as fallback, breaks when page is translated)
var bankPrices = findPricesBefore('с Ozon Банком', 1);
var noBankPrices = findPricesBefore('без Ozon Банка', 2);

// Use semantic prices if available, otherwise fall back to text search
var greenPriceValue = semantic.greenPrice || (bankPrices.length ? bankPrices[bankPrices.length - 1] : 0);
var blackPriceValue = semantic.blackPrice || (noBankPrices.length ? noBankPrices[noBankPrices.length - 1] : 0);

// If semantic data exists, trust it over text extraction
if (semantic.greenPrice > 0 || semantic.blackPrice > 0) {
  // Use semantic data
} else {
  // Fallback to text extraction only when semantic data is missing
}
```

**修改位置**：`ozon-panel.js:480-530`（两处重复函数定义都已修复）

### 测试验证

| 场景 | 页面语言 | 翻译状态 | 修复前 | 修复后 |
|------|---------|---------|--------|--------|
| 俄语页面 | 俄语 | 无翻译 | ¥111.04 ✓ | ¥111.04 ✓ |
| 中文页面 | 中文 | 无翻译 | ¥111.04 ✓ | ¥111.04 ✓ |
| 俄语→中文 | 俄语 | 浏览器翻译 | ¥10.63 ✗ | ¥111.04 ✓ |

---

## 八、部署检查清单

- [ ] 重新加载扩展（Chrome 扩展管理页面）
- [ ] 清除浏览器缓存
- [ ] 测试 4 个 SKU 用例（见上表）
- [ ] 验证数据面板 hover 展开/收起
- [ ] 验证计算器重量来源标注
- [ ] 测试 ERP 仓库报错自动重试（需要一个已归档仓库的商品）
- [ ] **测试浏览器翻译场景**：俄语页面 → 浏览器翻译成中文 → 验证价格识别正确
- [ ] 检查控制台无 JavaScript 错误
