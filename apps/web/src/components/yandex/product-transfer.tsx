'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { YandexCatalogView } from './catalog-view';
import { useSystemDialog } from '@/components/system-dialog-provider';

type Shop = { id: string; name: string; platform: string; status: string };
type Product = { id: string; title: string; sku?: string | null };
type Value = { parameterId: number; value: string; valueId?: number; unitId?: number };
type Offer = { offerId: string; name: string; description: string; vendor: string | null; marketCategoryId: number | null; barcodes: string[]; pictures: string[]; parameterValues: Value[] };
type Draft = { sourceProductId: string; offer: Offer; ready: boolean; missingFields: string[]; warnings: string[] };
type Preview = { drafts: Draft[]; readyCount: number; blockedCount: number; draftHash: string };
type Target = { sourceProductId: string; marketCategoryId?: number; name: string; description: string; vendor: string; barcodes: string[]; parameterValues: Value[] };
type Category = { id: number; name: string; path: string[] };
type Parameter = { id: number; name?: string; type: string; required: boolean; multivalue: boolean; allowCustomValues: boolean; values?: { id: number; value: string }[] | null; unit?: { defaultUnitId: number; units: { id: number; name?: string }[] } | null };
type Pending = { sourceShopId: string; productIds: string[]; targets: Target[]; confirm: true; idempotencyKey: string; expectedDraftHash: string };
const selectClass = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';
const missingName: Record<string, string> = { description: '商品描述', name: '商品标题', marketCategoryId: 'Yandex 类目', pictures: '商品图片', vendor: '品牌', barcodes: '真实条码', yandex_leaf_category: '选择有效的 Yandex 末级类目', name_russian: '俄文标题', description_russian: '俄文描述' };

function toTarget(draft: Draft): Target {
  return { sourceProductId: draft.sourceProductId, marketCategoryId: draft.offer.marketCategoryId ?? undefined, name: draft.offer.name, description: draft.offer.description, vendor: draft.offer.vendor ?? '', barcodes: draft.offer.barcodes, parameterValues: draft.offer.parameterValues ?? [] };
}

export function YandexProductTransfer({ shops }: { shops: Shop[] }) {
  const dialog = useSystemDialog();
  const [source, setSource] = useState(''), [target, setTarget] = useState('');
  const [products, setProducts] = useState<Product[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [offset, setOffset] = useState(0), [more, setMore] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [edits, setEdits] = useState<Target[]>([]), [checked, setChecked] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]), [categorySearch, setCategorySearch] = useState('');
  const [parameters, setParameters] = useState<Record<number, Parameter[]>>({});
  const [dictionarySearch, setDictionarySearch] = useState<Record<string, string>>({});
  const [showOptional, setShowOptional] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const generation = useRef(0);
  const key = `ss-erp-yandex-transfer:${target}`;
  useEffect(() => {
    generation.current += 1; setPreview(null); setEdits([]); setChecked(false); setCategories([]); setParameters({}); setError(''); setNotice(''); setBusy('');
    try { const raw = target ? sessionStorage.getItem(key) : null; setPending(raw ? JSON.parse(raw) : null); } catch { setPending(null); }
    return () => { generation.current += 1; };
  }, [source, target, key]);
  useEffect(() => { setProducts([]); setSelected([]); setOffset(0); setMore(false); }, [source]);
  const prefix = `/api/yandex-market/${encodeURIComponent(target)}`;
  const locked = busy === 'publish' || !!pending;

  async function action(name: string, fn: (current: () => boolean) => Promise<void>) {
    const version = ++generation.current; setBusy(name); setError(''); setNotice('');
    const current = () => generation.current === version;
    try { await fn(current); } catch (e) { if (current()) setError(e instanceof Error ? e.message : '操作失败'); }
    finally { if (current()) setBusy(''); }
  }
  function patch(id: string, value: Partial<Target>) { setEdits(rows => rows.map(row => row.sourceProductId === id ? { ...row, ...value } : row)); setChecked(false); setNotice(''); }

  async function loadProducts(nextOffset = 0) {
    await action('products', async current => {
      const r = await api.get<{ rows: Product[]; total?: number }>(`/api/shops/${encodeURIComponent(source)}/products?limit=50&offset=${nextOffset}&statusFilter=current`);
      if (!current()) return; if (r.code !== 1 || !r.data) throw new Error(r.msg || '读取 Ozon 商品失败');
      setProducts(r.data.rows); setOffset(nextOffset); setMore(r.data.total === undefined ? r.data.rows.length === 50 : nextOffset + r.data.rows.length < r.data.total);
    });
  }
  async function validate() {
    await action('preview', async current => {
      const r = await api.post<Preview>(`${prefix}/drafts/preview`, { sourceShopId: source, productIds: selected, targets: edits.filter(edit => selected.includes(edit.sourceProductId)) }, { timeoutMs: 180000 });
      if (!current()) return; if (r.code !== 1 || !r.data) throw new Error(r.msg || '预览失败');
      setPreview(r.data); setEdits(r.data.drafts.map(toTarget)); setChecked(true);
    });
  }
  async function loadCategories() {
    await action('categories', async current => {
      const r = await api.get<{ categories: Category[] }>(`${prefix}/categories`);
      if (!current()) return; if (r.code !== 1 || !r.data) throw new Error(r.msg || '类目读取失败'); setCategories(r.data.categories);
    });
  }
  async function selectCategory(productId: string, categoryId: number) {
    patch(productId, { marketCategoryId: categoryId || undefined, parameterValues: [] });
    if (!categoryId || parameters[categoryId]) return;
    await action('parameters', async current => {
      const r = await api.get<{ parameters: Parameter[] }>(`${prefix}/categories/${categoryId}/parameters`);
      if (!current()) return; if (r.code !== 1 || !r.data) throw new Error(r.msg || '类目特性读取失败'); setParameters(rows => ({ ...rows, [categoryId]: r.data!.parameters }));
    });
  }
  async function submit() {
    if (!pending && (!preview || !checked || preview.blockedCount)) return;
    if (!pending && !await dialog.confirm({ title: '提交 Yandex 商品目录', message: '将提交当前预览的商品内容。价格、库存和物流不会随本次目录提交同步。', confirmText: '确认提交' })) return;
    const request: Pending = pending ?? { sourceShopId: source, productIds: [...selected], targets: edits, confirm: true, idempotencyKey: crypto.randomUUID(), expectedDraftHash: preview!.draftHash };
    // Keep the original body before sending. A lost response never gets a new key.
    sessionStorage.setItem(key, JSON.stringify(request)); setPending(request);
    await action('publish', async current => {
      const r = await api.post<{ state: string }>(`${prefix}/offers/publish`, request, { timeoutMs: 180000 });
      if (!current()) return;
      const state = r.data?.state;
      if (state && !['SUCCEEDED', 'REJECTED'].includes(state)) { setNotice('平台结果尚未确认，请读取操作记录或核对原请求。'); return; }
      if (!state && (r.meta as { notDispatched?: boolean } | undefined)?.notDispatched !== true) {
        setNotice(r.msg || '请求结果未确认，请核对原请求。'); return;
      }
      sessionStorage.removeItem(key); setPending(null); setChecked(false);
      if (r.code !== 1 || state === 'REJECTED') throw new Error(r.msg || 'Yandex 拒绝商品目录更新');
      setNotice('目录请求已接受。请读取 Yandex 卡片状态，确认平台处理结果。');
    });
  }
  async function readOperations() {
    await action('operations', async current => {
      const r = await api.get<{ idempotencyKey: string; state: string; errorMessage?: string | null }[]>(`${prefix}/offers/publish-operations`);
      if (!current()) return; if (r.code !== 1 || !r.data) throw new Error(r.msg || '操作记录读取失败');
      const last = pending ? r.data.find(row => row.idempotencyKey === pending.idempotencyKey) : r.data[0];
      setNotice(last ? `最近提交：${last.state}${last.errorMessage ? ` · ${last.errorMessage}` : ''}` : '未找到本次提交记录。可用原请求核对，不会自动新建请求。');
      if (last && ['SUCCEEDED', 'REJECTED'].includes(last.state)) { sessionStorage.removeItem(key); setPending(null); setChecked(false); }
    });
  }

  return <div className="space-y-5">
    <div className="grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label htmlFor="yandex-target">目标 Yandex 店铺</Label><select id="yandex-target" className={selectClass} value={target} disabled={locked} onChange={e => setTarget(e.target.value)}><option value="">选择目标店铺</option>{shops.filter(shop => shop.platform === 'YANDEX' && shop.status === 'ACTIVE').map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></div><div className="space-y-1"><Label htmlFor="ozon-source">来源 Ozon 店铺</Label><select id="ozon-source" className={selectClass} value={source} disabled={locked} onChange={e => setSource(e.target.value)}><option value="">选择来源店铺</option>{shops.filter(shop => shop.platform === 'OZON' && shop.status === 'ACTIVE').map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></div></div>
    {target && <YandexCatalogView shopId={target} />}
    {source && <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">选择 Ozon 来源商品</h2><Button variant="outline" disabled={!!busy || locked} onClick={() => loadProducts()}>读取来源商品</Button></div>
      {!!products.length && <div className="max-h-64 overflow-auto rounded-md border">{products.map(product => <label key={product.id} className="flex items-center gap-2 border-b p-3 text-sm last:border-b-0"><input type="checkbox" aria-label={`选择 ${product.title}`} checked={selected.includes(product.id)} disabled={locked || !!busy || (!selected.includes(product.id) && selected.length >= 50)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, product.id] : ids.filter(id => id !== product.id)); setPreview(null); setEdits([]); setChecked(false); }} /><span className="min-w-0 flex-1 break-words">{product.title}</span></label>)}</div>}
      {!!products.length && <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" disabled={!offset || !!busy || locked} onClick={() => loadProducts(Math.max(0, offset - 50))}>上一页</Button><span className="text-xs text-muted-foreground">第 {offset / 50 + 1} 页 · 已选 {selected.length}/50</span><Button size="sm" variant="ghost" disabled={!more || !!busy || locked} onClick={() => loadProducts(offset + 50)}>下一页</Button></div>}
    </section>}
    {!!selected.length && <Button disabled={!target || !!busy || locked} variant="outline" onClick={validate}>{preview ? '重新校验草稿' : '生成草稿预览'}</Button>}
    {!!edits.length && <div className="space-y-4"><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy || locked} onClick={loadCategories}>读取 Yandex 类目</Button><Input aria-label="筛选 Yandex 类目" className="max-w-sm" value={categorySearch} onChange={e => setCategorySearch(e.target.value)} placeholder="按俄文名称筛选类目" /></div>
      {edits.map(edit => <fieldset key={edit.sourceProductId} disabled={locked || !!busy} className="min-w-0 space-y-3 rounded-md border p-4"><legend className="px-1 text-sm font-medium">{edit.name || '商品草稿'}</legend><div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`name-${edit.sourceProductId}`}>俄文标题</Label><Input id={`name-${edit.sourceProductId}`} value={edit.name} onChange={e => patch(edit.sourceProductId, { name: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor={`category-${edit.sourceProductId}`}>Yandex 类目</Label><select id={`category-${edit.sourceProductId}`} className={selectClass} value={edit.marketCategoryId ?? ''} onChange={e => selectCategory(edit.sourceProductId, Number(e.target.value))}><option value="">请选择末级类目</option>{[...categories.filter(category => category.id === edit.marketCategoryId), ...categories.filter(category => category.id !== edit.marketCategoryId && category.path.join(' / ').toLowerCase().includes(categorySearch.toLowerCase())).slice(0, 200)].map(category => <option key={category.id} value={category.id}>{category.path.join(' / ')}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor={`vendor-${edit.sourceProductId}`}>品牌</Label><Input id={`vendor-${edit.sourceProductId}`} value={edit.vendor} onChange={e => patch(edit.sourceProductId, { vendor: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor={`barcode-${edit.sourceProductId}`}>商品条码（多个用逗号分隔）</Label><Input id={`barcode-${edit.sourceProductId}`} value={edit.barcodes.join(',')} onChange={e => patch(edit.sourceProductId, { barcodes: e.target.value.split(/[,，\s]+/u).filter(Boolean) })} /></div>
      </div><div className="space-y-1"><Label htmlFor={`description-${edit.sourceProductId}`}>俄文描述</Label><textarea id={`description-${edit.sourceProductId}`} className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm" value={edit.description} onChange={e => patch(edit.sourceProductId, { description: e.target.value })} /></div>
      {!!edit.marketCategoryId && parameters[edit.marketCategoryId] && <Button type="button" size="sm" variant="ghost" onClick={() => setShowOptional(current => ({ ...current, [edit.sourceProductId]: !current[edit.sourceProductId] }))}>{showOptional[edit.sourceProductId] ? '收起选填属性' : '展开选填属性'}</Button>}
      {!!edit.marketCategoryId && parameters[edit.marketCategoryId]?.filter(parameter => parameter.required || showOptional[edit.sourceProductId] || edit.parameterValues.some(value => value.parameterId === parameter.id)).map(parameter => {
        const selectedValue = edit.parameterValues.find(value => value.parameterId === parameter.id);
        const dictionary = parameter.type === 'ENUM';
        const searchKey = `${edit.sourceProductId}:${parameter.id}`;
        const search = dictionarySearch[searchKey] ?? '';
        const chosen = edit.parameterValues.filter(value => value.parameterId === parameter.id).map(value => value.valueId);
        const visibleValues = [...(parameter.values ?? []).filter(value => chosen.includes(value.id)), ...(parameter.values ?? []).filter(value => !chosen.includes(value.id) && value.value.toLowerCase().includes(search.toLowerCase())).slice(0, 200)];
        const set = (value: string) => {
          const item = dictionary ? parameter.values?.find(option => String(option.id) === value) : undefined;
          patch(edit.sourceProductId, { parameterValues: [...edit.parameterValues.filter(v => v.parameterId !== parameter.id), ...(value ? [{ parameterId: parameter.id, value: item?.value ?? value, ...(item ? { valueId: item.id } : {}) }] : [])] });
        };
        return <div className="space-y-1" key={parameter.id}><Label htmlFor={`p-${edit.sourceProductId}-${parameter.id}`}>{parameter.name ?? parameter.id}{parameter.required ? ' *' : ''}{parameter.unit ? `（${parameter.unit.units.find(unit => unit.id === parameter.unit!.defaultUnitId)?.name ?? ''}）` : ''}</Label>
        {dictionary && (parameter.values?.length ?? 0) > 200 && <Input aria-label={`搜索 ${parameter.name ?? parameter.id}`} value={search} onChange={e => setDictionarySearch(current => ({ ...current, [searchKey]: e.target.value }))} placeholder="输入文字筛选可选值" />}
        {dictionary ? <select id={`p-${edit.sourceProductId}-${parameter.id}`} className={selectClass} multiple={parameter.multivalue} value={parameter.multivalue ? edit.parameterValues.filter(v => v.parameterId === parameter.id && v.valueId).map(v => String(v.valueId)) : selectedValue?.valueId ?? ''} onChange={e => {
          if (!parameter.multivalue) { set(e.target.value); return; }
          const ids = [...e.target.selectedOptions].map(option => Number(option.value));
          patch(edit.sourceProductId, { parameterValues: [...edit.parameterValues.filter(v => v.parameterId !== parameter.id), ...(parameter.values ?? []).filter(value => ids.includes(value.id)).map(value => ({ parameterId: parameter.id, valueId: value.id, value: value.value }))] });
        }}>{!parameter.multivalue && <option value="">请选择</option>}{visibleValues.map(value => <option key={value.id} value={value.id}>{value.value}</option>)}</select> : <Input id={`p-${edit.sourceProductId}-${parameter.id}`} value={selectedValue?.value ?? ''} onChange={e => set(e.target.value)} placeholder={parameter.type === 'BOOLEAN' ? 'true / false' : undefined} />}
        {dictionary && parameter.allowCustomValues && <Input aria-label={`${parameter.name ?? parameter.id} 自定义值`} value={edit.parameterValues.find(v => v.parameterId === parameter.id && !v.valueId)?.value ?? ''} placeholder="也可填写已确认的自定义值" onChange={e => patch(edit.sourceProductId, { parameterValues: [...edit.parameterValues.filter(v => v.parameterId !== parameter.id), ...(e.target.value ? [{ parameterId: parameter.id, value: e.target.value }] : [])] })} />}</div>;
      })}
      {preview?.drafts.find(draft => draft.sourceProductId === edit.sourceProductId)?.missingFields.map(field => <Badge key={field} variant="outline" className="mr-1 whitespace-normal">待补：{missingName[field] ?? field}</Badge>)}
      </fieldset>)}
    </div>}
    {preview && <div className="flex flex-wrap items-center gap-3"><span className="text-sm">{checked ? `字段完整 ${preview.readyCount} · 待补 ${preview.blockedCount}` : '内容已编辑，请重新校验'}</span><Button disabled={!checked || !!preview.blockedCount || !!busy || locked} onClick={submit}>提交 Yandex 商品目录</Button></div>}
    {busy && <p role="status" className="text-sm text-muted-foreground">正在{busy === 'publish' ? '提交，请勿关闭页面' : '读取或校验'}…</p>}
    {pending && <div className="flex flex-wrap items-center gap-2 rounded-md border p-3"><span className="text-sm">上次提交结果待确认</span><Button variant="outline" disabled={!!busy} onClick={submit}>核对原请求</Button><Button variant="outline" disabled={!!busy} onClick={readOperations}>读取操作记录</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
