const SOURCE_DATA_ISSUE_LABELS: Record<string, string> = {
  missing_source_images: '缺图片',
  missing_purchase_price: '缺采购价',
  missing_sku_items: '缺SKU',
  missing_description: '缺描述',
  missing_attributes: '缺属性',
};

export function sourceDataIssueLabels(issues?: string[]) {
  return (issues || []).map((issue) => SOURCE_DATA_ISSUE_LABELS[issue] || issue);
}

export function sourceDataIssueText(issues?: string[]) {
  return sourceDataIssueLabels(issues).join(' / ');
}
