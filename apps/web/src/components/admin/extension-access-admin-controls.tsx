'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ACCESS_EXTRA_FLAGS, SOURCE_FEATURE_LABELS, SHOP_SCOPED_FEATURES, SOURCE_POLICY_KEY, TENANT_POLICY_KEY,
  parseSourcePolicy, parseTenantPolicy, prepareAccessSave, describeAccessChanges, buildOptionsPath, mergeOptions, initializeSourcePolicy, accessRegionLabel,
  type AccessConfigRow, type AccessOptions, type AccessRule, type AccessSaveItem, type SourcePolicy, type TenantPolicy,
} from './extension-access-state.mjs';

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const emptyOptions: AccessOptions = { owners: [], shops: [], devices: [], features: [], hasMore: { owners: false, shops: false, devices: false } };
const MODE_LABELS = { off: '关闭', pilot: '指定范围', global: '全部用户与店铺' };

function ChoiceList({ label, options, selected, onChange, empty }: {
  label: string; options: Array<{ id: string; label: string }>; selected: string[];
  onChange(ids: string[]): void; empty: string;
}) {
  const available = new Map(options.map(option => [option.id, option]));
  const ids = [...new Set([...selected, ...options.map(option => option.id)])];
  return <fieldset className="min-w-0 space-y-2 rounded-md border p-3">
    <legend className="px-1 text-sm font-medium">{label}</legend>
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {ids.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : ids.map(id => <label key={id} className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-primary" checked={selected.includes(id)}
          onChange={event => onChange(event.target.checked ? [...selected, id] : selected.filter(value => value !== id))} />
        <span className="min-w-0 break-all">{available.get(id)?.label || `${id}（已保存，本次查询未返回）`}</span>
      </label>)}
    </div>
  </fieldset>;
}

export function ExtensionAccessAdminControls() {
  const [rows, setRows] = useState<AccessConfigRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [source, setSource] = useState<SourcePolicy | null>(null);
  const [tenant, setTenant] = useState<TenantPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [options, setOptions] = useState<AccessOptions>(emptyOptions);
  const [catalog, setCatalog] = useState<AccessOptions>(emptyOptions);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [optionsRefresh, setOptionsRefresh] = useState(0);
  const [browseOwnerId, setBrowseOwnerId] = useState('');
  const [selectedFeature, setSelectedFeature] = useState('');
  const [pending, setPending] = useState<AccessSaveItem[] | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [initializeOpen, setInitializeOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const configRequest = useRef(0);
  const optionsRequest = useRef(0);

  async function loadConfig() {
    const requestId = ++configRequest.current;
    setLoading(true);
    setError('');
    try {
      const response = await api.get<AccessConfigRow[]>('/api/admin/system-config');
      if (requestId !== configRequest.current) return;
      if (response.code !== 1 || !Array.isArray(response.data)) throw new Error(response.msg || '配置读取失败');
      setRows(response.data);
      setDraft(Object.fromEntries(response.data.map(row => [row.key, row.value])));
      setSource(parseSourcePolicy(response.data.find(row => row.key === SOURCE_POLICY_KEY)?.value || '').value);
      setTenant(parseTenantPolicy(response.data.find(row => row.key === TENANT_POLICY_KEY)?.value || '').value);
      setConflict(false);
    } catch (cause) {
      if (requestId === configRequest.current) setError(cause instanceof Error ? cause.message : '配置读取失败，请重试');
    } finally {
      if (requestId === configRequest.current) setLoading(false);
    }
  }

  useEffect(() => { void loadConfig(); return () => { configRequest.current += 1; }; }, []);
  useEffect(() => { setHostname(window.location.hostname); }, []);

  useEffect(() => {
    const requestId = ++optionsRequest.current;
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    void api.get<AccessOptions>(buildOptionsPath(query, browseOwnerId ? [browseOwnerId] : []), { signal: controller.signal })
      .then(response => {
        if (requestId !== optionsRequest.current) return;
        if (response.code !== 1 || !response.data || !Array.isArray(response.data.features)) throw new Error(response.msg || '授权对象读取失败');
        setOptions(response.data);
        setCatalog(current => mergeOptions(current, response.data!));
        setSelectedFeature(current => current || response.data!.features[0]?.name || '');
      })
      .catch(cause => {
        if (requestId === optionsRequest.current && !controller.signal.aborted) {
          setOptions(emptyOptions);
          setOptionsError(cause instanceof Error ? cause.message : '授权对象读取失败');
        }
      })
      .finally(() => { if (requestId === optionsRequest.current) setOptionsLoading(false); });
    return () => { controller.abort(); optionsRequest.current += 1; };
  }, [query, browseOwnerId, optionsRefresh]);

  const managedKeys = [...catalog.features.map(feature => feature.configKey), ...ACCESS_EXTRA_FLAGS, SOURCE_POLICY_KEY, TENANT_POLICY_KEY];
  const managedDraft = Object.fromEntries(managedKeys.filter(key => key in draft).map(key => [key, draft[key]!]));
  const objectLabels = Object.fromEntries([
    ...catalog.owners.map(owner => [owner.id, owner.nickname || owner.accountCode || owner.id]),
    ...catalog.shops.map(shop => [shop.id, shop.name]),
    ...catalog.devices.map(device => [device.id, `设备 ${device.id.slice(-8)}`]),
  ]);
  const changes = describeAccessChanges(rows, managedDraft, objectLabels);
  const dirty = managedKeys.some(key => draft[key] !== undefined && draft[key] !== rows.find(row => row.key === key)?.value);
  const sourceError = parseSourcePolicy(draft[SOURCE_POLICY_KEY] || '').error;
  const tenantError = parseTenantPolicy(draft[TENANT_POLICY_KEY] || '').error;
  const currentRule: AccessRule = source?.features[selectedFeature] || { mode: 'off' };
  const shopScoped = SHOP_SCOPED_FEATURES.includes(selectedFeature);
  const ownerOptions = options.owners.map(owner => ({ id: owner.id, label: owner.nickname || owner.accountCode || owner.id }));
  const shopOptions = options.shops.map(shop => ({ id: shop.id, label: `${shop.name} · ${shop.platform}` }));
  const deviceOptions = options.devices.map(device => ({ id: device.id, label: `设备 ${device.id.slice(-8)} · ${device.shopIds.length} 家店铺` }));

  function setValue(key: string, value: string) { setDraft(current => ({ ...current, [key]: value })); setNotice(''); }
  function updateSource(rule: AccessRule) {
    if (!source) return;
    const next = { ...source, features: { ...source.features, [selectedFeature]: rule } };
    setSource(next);
    setValue(SOURCE_POLICY_KEY, JSON.stringify(next));
  }
  function updateDimension(key: 'ownerUserIds' | 'shopIds' | 'deviceSessionIds' | 'platforms', ids: string[]) {
    const next = { ...currentRule };
    if (ids.length) next[key] = ids; else delete next[key];
    updateSource(next);
  }
  function updateTenant(next: TenantPolicy) { setTenant(next); setValue(TENANT_POLICY_KEY, JSON.stringify(next)); }

  function previewSave() {
    try {
      const items = prepareAccessSave(rows, managedDraft, `admin-${crypto.randomUUID()}`);
      if (items.length) { setError(''); setPending(items); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '请检查访问范围'); }
  }

  async function confirmSave() {
    if (!pending || saving || conflict) return;
    setSaving(true);
    setError('');
    try {
      // Batch endpoint validates SUPER_ADMIN, every expectedRevision and the complete policies atomically.
      const response = await api.put('/api/admin/system-config/batch', { items: pending }, { timeoutMs: 30_000 });
      if (response.code !== 1) {
        if ((response as { errorCode?: string }).errorCode === 'system_config_revision_conflict') {
          setConflict(true);
          setError('服务器配置已被其他管理员修改。编辑内容已保留；请先重新读取并核对最新范围，再保存。');
        } else setError(response.msg || '保存失败，原配置未确认变更');
        setPending(null);
        return;
      }
      setPending(null);
      setNotice('访问配置已保存，正在读取服务器当前值。');
      setConflict(true);
      await loadConfig();
    } catch (cause) {
      setConflict(true);
      setPending(null);
      setError(`保存结果尚未确认，请重新读取服务器值后核对。编辑内容已保留。${cause instanceof Error ? ` ${cause.message}` : ''}`);
    } finally { setSaving(false); }
  }

  function toggle(row: AccessConfigRow) {
    const value = draft[row.key];
    return <label key={row.key} className="flex items-start justify-between gap-3 rounded-md border p-3">
      <span><span className="block text-sm font-medium">{row.label || row.key}</span>
        {row.description ? <span className="mt-1 block text-xs text-muted-foreground">{row.description}</span> : null}
        {!['true', 'false'].includes(value || '') ? <span className="text-xs text-destructive">开关值无效，未当作关闭处理</span> : null}</span>
      <input type="checkbox" role="switch" className="mt-1 accent-primary" checked={value === 'true'}
        disabled={!['true', 'false'].includes(value || '')} onChange={event => setValue(row.key, String(event.target.checked))} />
    </label>;
  }

  return <Card id="extension-access">
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 className="text-sm font-medium">扩展与托管访问</h2><Badge variant="secondary">{accessRegionLabel(hostname)}</Badge></div>
        <span className="text-xs text-muted-foreground group-open:hidden">展开</span><span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
      </summary>
      <CardContent className="space-y-5 border-t pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-xs text-muted-foreground">本页管理当前区域服务器的实际访问范围。扩展安装与功能授权分别生效；保存不会自动配对设备、生成图片或发布商品。</p>
          <Button type="button" variant="outline" size="sm" disabled={loading || saving} onClick={() => dirty || conflict ? setDiscardOpen(true) : void loadConfig()}><RefreshCw className="mr-1 h-3.5 w-3.5" />重新读取</Button>
        </div>
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        {error ? <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {loading ? <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />读取当前访问配置…</div> : <fieldset disabled={saving || conflict || optionsLoading} className="min-w-0 space-y-5 disabled:opacity-70">
          <section className="space-y-3 rounded-md border bg-muted/20 p-4">
            <h3 className="text-sm font-medium">查找授权对象</h3>
            <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setQuery(search); setOptionsRefresh(current => current + 1); }}>
              <Input aria-label="查找用户" placeholder="用户昵称、账号编号或 ID" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} className="max-w-sm" />
              <Button type="submit" size="sm" variant="outline" disabled={optionsLoading}>查找</Button>
            </form>
            <div className="space-y-1.5"><Label htmlFor="extension-access-browse-owner">查看该用户的店铺与设备</Label><select id="extension-access-browse-owner" className={selectClass} value={browseOwnerId} onChange={event => setBrowseOwnerId(event.target.value)}>
              <option value="">请选择用户（仅查看，不自动授权）</option>
              {catalog.owners.map(owner => <option value={owner.id} key={owner.id}>{owner.nickname || owner.accountCode || owner.id}</option>)}
            </select></div>
            {optionsLoading ? <p role="status" className="text-xs text-muted-foreground">正在读取可授权对象…</p> : null}
            {optionsError ? <p role="alert" className="text-xs text-destructive">{optionsError}</p> : null}
            {Object.values(options.hasMore).some(Boolean) ? <p className="text-xs text-muted-foreground">结果未全部显示，请输入更精确的用户条件，或分别选择用户查看店铺与设备。</p> : null}
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-medium">采集、草稿与上架范围</h3>
            {sourceError && !source ? <div className="space-y-3 rounded-md border border-destructive/30 p-3"><p role="alert" className="text-sm text-destructive">{sourceError}</p>
              {draft[SOURCE_POLICY_KEY] === '{}' ? <Button type="button" variant="outline" size="sm" onClick={() => setInitializeOpen(true)}>初始化关闭的访问范围</Button> : null}
            </div> : null}
            {source ? <>
              <div className="space-y-1.5"><Label htmlFor="extension-access-feature">要管理的功能</Label><select id="extension-access-feature" className={selectClass} value={selectedFeature} disabled={catalog.features.length === 0} onChange={event => setSelectedFeature(event.target.value)}>
                {catalog.features.map(feature => <option key={feature.name} value={feature.name}>{SOURCE_FEATURE_LABELS[feature.name] || feature.name}</option>)}
              </select></div>
              {catalog.features.find(feature => feature.name === selectedFeature) ? <>
                {rows.filter(row => row.key === catalog.features.find(feature => feature.name === selectedFeature)?.configKey).map(toggle)}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="extension-access-mode">开放范围</Label><select id="extension-access-mode" className={selectClass} value={currentRule.mode} onChange={event => {
                    const mode = event.target.value as AccessRule['mode'];
                    const stage = selectedFeature === 'SOURCE_CAPTURE_V2' && currentRule.stage ? { stage: currentRule.stage }
                      : selectedFeature === 'SOURCE_LISTING_WORKFLOW' && currentRule.listingStage ? { listingStage: currentRule.listingStage } : {};
                    updateSource(mode === 'off' ? { mode } : { mode, ...stage });
                  }}>
                    {Object.entries(MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></div>
                  {currentRule.mode !== 'off' && ['SOURCE_CAPTURE_V2', 'SOURCE_LISTING_WORKFLOW'].includes(selectedFeature) ? <div className="space-y-1.5"><Label htmlFor="extension-access-stage">工作流阶段</Label><select id="extension-access-stage" className={selectClass} value={currentRule.stage || currentRule.listingStage || ''} onChange={event => {
                    const next = { ...currentRule };
                    const key = selectedFeature === 'SOURCE_CAPTURE_V2' ? 'stage' : 'listingStage';
                    if (event.target.value) next[key] = event.target.value; else delete next[key];
                    updateSource(next);
                  }}><option value="">沿用服务端默认（仅新版）</option><option value="shadow_write">影子写入</option><option value="dual_read">双路读取</option><option value="v2_only">仅新版</option></select></div> : null}
                </div>
                {currentRule.mode === 'pilot' ? <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">同一维度内任选其一，不同维度之间必须同时匹配。留空表示该维度不限制。{shopScoped ? '此功能必须指定店铺，不能按设备会话限制。' : '至少选择一个限制维度。'}</p>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <ChoiceList label="用户" selected={currentRule.ownerUserIds || []} options={ownerOptions} onChange={ids => updateDimension('ownerUserIds', ids)} empty="先查找用户" />
                    <ChoiceList label="店铺" selected={currentRule.shopIds || []} options={shopOptions} onChange={ids => updateDimension('shopIds', ids)} empty="请先选择上方要查看的用户" />
                    {!shopScoped ? <ChoiceList label="设备会话" selected={currentRule.deviceSessionIds || []} options={deviceOptions} onChange={ids => updateDimension('deviceSessionIds', ids)} empty="请先选择上方要查看的用户" /> : null}
                    <ChoiceList label="平台" selected={currentRule.platforms || []} options={['1688', 'TAOBAO', 'TMALL', 'PDD', 'OZON'].map(id => ({ id, label: id }))} onChange={ids => updateDimension('platforms', ids)} empty="" />
                  </div>
                </div> : null}
              </> : null}
              {sourceError ? <p role="alert" className="text-sm text-destructive">当前选择尚不完整：指定范围至少需要一个维度；草稿、类目及发布功能必须指定店铺。</p> : null}
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看当前策略信息</summary><p className="mt-2 break-all">策略修订：{source.revision}</p><p>功能总开关与上述开放范围须同时允许。未识别的已有功能项保持原值，不自动删除。</p></details>
            </> : null}
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium">托管 AI 用户与能力</h3>
            {tenant ? <>
              <div className="space-y-1.5"><Label htmlFor="extension-access-tenant-mode">允许使用托管 AI 的用户</Label><select id="extension-access-tenant-mode" className={selectClass} value={tenant.mode || 'allowlist'} onChange={event => updateTenant(event.target.value === 'all' ? { ...tenant, mode: 'all', tenantIds: [] } : { ...tenant, mode: 'allowlist' })}>
                <option value="allowlist">指定用户</option><option value="all">全部用户</option>
              </select></div>
              {tenant.mode !== 'all' ? <ChoiceList label="托管 AI 用户" selected={tenant.tenantIds} options={ownerOptions} onChange={ids => updateTenant({ ...tenant, tenantIds: ids })} empty="未选择用户：不向任何用户开放托管 AI" /> : null}
              <p className="text-xs text-muted-foreground">用户范围还需与功能总开关、来源工作流范围、设备及店铺授权同时满足；不修改计价、余额、每日次数或 Provider 能力验证。</p>
            </> : <p role="alert" className="text-sm text-destructive">{tenantError}</p>}
            <div className="grid gap-3 lg:grid-cols-2">{rows.filter(row => ACCESS_EXTRA_FLAGS.includes(row.key)).map(toggle)}</div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">{dirty ? `${changes.length} 项待核对变更；保存前显示影响摘要。` : '当前值已读取，尚未修改开放范围。'}</p>
            <Button type="button" size="sm" disabled={!dirty || Boolean(sourceError) || Boolean(tenantError) || optionsLoading || Boolean(optionsError)} onClick={previewSave}><Save className="mr-1 h-3.5 w-3.5" />核对并保存访问配置</Button>
          </div>
        </fieldset>}
      </CardContent>
    </details>

    <Dialog open={pending !== null} onOpenChange={open => { if (!open && !saving) setPending(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>确认访问范围变更</DialogTitle><DialogDescription>目标：{accessRegionLabel(hostname)}。所有变更以同一批次和读取时的版本提交。</DialogDescription></DialogHeader>
        {changes.some(change => change.expands) ? <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">本次包含开启能力或扩大用户、店铺、设备范围。请确认选中的对象与“全部用户”设置。</p> : null}
        <ul className="space-y-3 text-sm">{changes.map((change, index) => <li key={index}><p className="font-medium">{change.label}{change.expands ? ' · 开放范围可能扩大' : ''}</p><p className="mt-1 break-words text-muted-foreground">{change.detail}</p></li>)}</ul>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setPending(null)}>返回修改</Button><Button disabled={saving} onClick={() => void confirmSave()}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}确认保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent>
      <DialogHeader><DialogTitle>重新读取服务器配置？</DialogTitle><DialogDescription>当前未保存的编辑将被服务器最新值替换。冲突发生后，请核对最新值再重新修改。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>保留编辑</Button><Button onClick={() => { setDiscardOpen(false); void loadConfig(); }}>放弃编辑并重新读取</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={initializeOpen} onOpenChange={setInitializeOpen}><DialogContent>
      <DialogHeader><DialogTitle>建立关闭的访问范围？</DialogTitle><DialogDescription>仅适用于尚未配置的空策略。此操作只准备编辑内容，所有功能范围保持关闭；仍需核对并保存才会写入服务器。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setInitializeOpen(false)}>取消</Button><Button onClick={() => {
        const next = initializeSourcePolicy(draft[SOURCE_POLICY_KEY] || '', true);
        if (next) { setSource(next); setValue(SOURCE_POLICY_KEY, JSON.stringify(next)); }
        setInitializeOpen(false);
      }}>准备关闭策略</Button></DialogFooter>
    </DialogContent></Dialog>
  </Card>;
}
