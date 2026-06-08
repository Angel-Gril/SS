const SOURCE_DATA_ISSUE_LABELS: Record<string, string> = {
  missing_source_images: '缺图片',
  missing_source_product_id: '缺货源商品ID',
  missing_purchase_price: '缺采购价',
  missing_sku_items: '缺货源 SKU',
  missing_source_sku_ids: '缺货源 SKU ID',
  missing_description: '缺描述',
  missing_attributes: '缺属性',
};

export function sourceDataIssueLabels(issues?: string[]) {
  return (issues || []).map((issue) => SOURCE_DATA_ISSUE_LABELS[issue] || issue);
}

export function sourceDataIssueText(issues?: string[]) {
  return sourceDataIssueLabels(issues).join(' / ');
}
