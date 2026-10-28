type ItemInput = { id: number; count: number; requiredInstanceTypes?: string[] | null };
type BoxInput = { items: { id: number; fullCount: number; instances?: Record<string, string>[] }[] };

/** Editor checks only: the server independently validates ownership, quantities and platform rules. */
export function compileYandexBoxInput(items: ItemInput[], rows: Record<number, number>[], marks: Record<string, string>): BoxInput[] {
  if (!rows.length || rows.length > 100) throw Error('请填写 1–100 个箱子');
  const allowed = new Set(items.map(i => i.id)), offsets: Record<number, number> = {}, codes: Record<number, Record<string, string>[]> = {};
  const unique = new Set<string>();
  for (const row of rows) {
    for (const [id, count] of Object.entries(row)) if (!allowed.has(Number(id)) || !Number.isSafeInteger(count) || count < 0) throw Error('装箱数量须为非负整数，且只能包含当前订单商品');
    if (!Object.values(row).some(count => count > 0)) throw Error('请移除空箱，或为其填写商品数量');
  }
  for (const item of items) {
    if (rows.reduce((sum, row) => sum + (row[item.id] ?? 0), 0) !== item.count) throw Error(`商品 ${item.id} 的装箱数量合计须为 ${item.count}`);
    const entries = ['CIS', 'UIN', 'RNPT', 'GTD'].flatMap(kind => {
      const list = (marks[`${item.id}:${kind}`] ?? '').split('\n').map(s => s.trim()).filter(Boolean);
      if (item.requiredInstanceTypes?.includes(kind) && list.length !== item.count) throw Error(`商品 ${item.id} 需要 ${item.count} 份 ${kind} 标记`);
      return list.map(code => {
        if (unique.has(`${kind}:${code}`)) throw Error('商品标记不能重复');
        unique.add(`${kind}:${code}`); return { [kind.toLowerCase()]: code };
      });
    });
    if (entries.length > item.count) throw Error('标记数量超过商品件数，不能丢弃多余代码；请核对平台标记要求');
    codes[item.id] = entries;
  }
  return rows.map(row => ({ items: items.filter(item => (row[item.id] ?? 0) > 0).map(item => {
    const start = offsets[item.id] ?? 0, count = row[item.id]!; offsets[item.id] = start + count;
    const instances = codes[item.id]!.slice(start, start + count);
    return { id: item.id, fullCount: count, ...(instances.length ? { instances } : {}) };
  }) }));
}

export function yandexCommandOutcome(response: { code?: unknown; data?: { state?: string }; meta?: unknown } | null): 'SUCCEEDED' | 'REJECTED' | 'PENDING' {
  if (response?.code === 1 && response.data?.state === 'SUCCEEDED') return 'SUCCEEDED';
  if (response?.data?.state === 'REJECTED' || (response?.meta as { notDispatched?: boolean } | undefined)?.notDispatched === true) return 'REJECTED';
  return 'PENDING';
}
