'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDot,
  Loader2,
  MapPin,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Store,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type ApiResponse } from '@/lib/api';
import {
  buildBindingProbeDecisionPath,
  buildBindingProbePath,
  buildBindingProbeStatusPath,
  buildOfficialCitiesPath,
  buildOfficialCountriesPath,
  buildOfficialDestinationsPath,
  buildOriginBindingConfirmPath,
  buildScopeBootstrapPath,
  buildScopeBootstrapWorkspacePath,
  normalizeScopeBootstrapOperationResult,
  resolveProbeDisplayStatus,
} from './scope-bootstrap-state.mjs';

type JsonRecord = Record<string, unknown>;
type ProbeDecision = 'confirm' | 'reject';
type BusyAction =
  | 'workspace'
  | 'candidate'
  | 'probe'
  | 'probe-status'
  | 'probe-decision'
  | 'locations'
  | 'cities'
  | 'origin'
  | null;

interface ScopeBootstrapCompletion {
  channelId: string;
  assignmentId: string;
}

interface ScopeBootstrapWorkbenchProps {
  onCompleted?: (result: ScopeBootstrapCompletion) => void | Promise<void>;
}

interface WorkspaceFilters {
  bootstrapId?: string;
  tenantId?: string;
  shopId?: string;
  warehouseId?: string;
}

const BOOTSTRAP_CHECKPOINT_KEY = 'ss-erp.logistics.scope-bootstrap-id';
const SELECT_CLASS =
  'h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function entity(value: unknown): JsonRecord | null {
  const candidate = record(value);
  return Object.keys(candidate).length > 0 ? candidate : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function entityId(value: JsonRecord | null, ...keys: string[]): string {
  if (!value) return '';
  for (const key of keys) {
    const found = text(value[key]);
    if (found) return found;
  }
  return '';
}

function entityStatus(value: JsonRecord | null): string {
  return text(value?.status).toUpperCase();
}

function optionLabel(value: JsonRecord): string {
  return (
    text(value.label) ||
    text(value.name) ||
    text(value.displayName) ||
    text(value.locationName) ||
    text(value.id) ||
    '-'
  );
}

function relationId(value: JsonRecord, key: string): string {
  return text(value[key]) || text(record(value.scope)[key]);
}

function catalogRecords(source: JsonRecord, key: string): JsonRecord[] | null {
  const catalog = record(source.catalog);
  if (Array.isArray(catalog[key])) return records(catalog[key]);
  if (Array.isArray(source[key])) return records(source[key]);
  return null;
}

function responseCode(response: ApiResponse<unknown>): string {
  return text(record((response as unknown as JsonRecord).error).code) || 'REQUEST_FAILED';
}

function directoryRecords(value: unknown): JsonRecord[] {
  const source = record(value);
  return records(source.records || source.items || source.rows);
}

function normalizedName(value: JsonRecord): string {
  return `${optionLabel(value)} ${text(value.countryName)} ${text(value.regionName)}`.toLowerCase();
}

function isChina(value: JsonRecord): boolean {
  const name = normalizedName(value);
  return name.includes('china') || name.includes('中国') || name.includes('китай');
}

function isXiamen(value: JsonRecord): boolean {
  const name = normalizedName(value);
  return name.includes('xiamen') || name.includes('厦门') || name.includes('сямэнь');
}

function isMoscow(value: JsonRecord): boolean {
  const name = normalizedName(value);
  return name.includes('moscow') || name.includes('莫斯科') || name.includes('москва');
}

function locationUid(value: JsonRecord): string {
  return text(value.uid) || text(value.locationUid) || text(value.id);
}

function blockerLabel(value: JsonRecord): string {
  return text(value.message) || text(value.label) || text(value.code) || '未知阻断';
}

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' {
  if (['VERIFIED', 'CONFIRMED', 'READY', 'ACTIVE', 'COMPLETED'].includes(status)) return 'success';
  if (['REJECTED', 'FAILED', 'EXPIRED', 'BLOCKED'].includes(status)) return 'destructive';
  if (['PENDING', 'SUBMITTED', 'CAPTURED', 'CANDIDATE'].includes(status)) return 'warning';
  return 'secondary';
}

function StepStatus({ complete, active }: { complete: boolean; active?: boolean }) {
  if (complete) return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />;
  if (active) return <CircleDot className="h-4 w-4 text-primary" aria-hidden />;
  return <CircleDot className="h-4 w-4 text-muted-foreground/50" aria-hidden />;
}

export function ScopeBootstrapWorkbench({ onCompleted }: ScopeBootstrapWorkbenchProps) {
  const [tenants, setTenants] = useState<JsonRecord[]>([]);
  const [shops, setShops] = useState<JsonRecord[]>([]);
  const [warehouses, setWarehouses] = useState<JsonRecord[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<JsonRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedShopId, setSelectedShopId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [selectedDeliveryMethodId, setSelectedDeliveryMethodId] = useState('');
  const [bootstrap, setBootstrap] = useState<JsonRecord | null>(null);
  const [probe, setProbe] = useState<JsonRecord | null>(null);
  const [companyBinding, setCompanyBinding] = useState<JsonRecord | null>(null);
  const [originBinding, setOriginBinding] = useState<JsonRecord | null>(null);
  const [generatedChannel, setGeneratedChannel] = useState<JsonRecord | null>(null);
  const [generatedAssignment, setGeneratedAssignment] = useState<JsonRecord | null>(null);
  const [blockers, setBlockers] = useState<JsonRecord[]>([]);
  const [countries, setCountries] = useState<JsonRecord[]>([]);
  const [cities, setCities] = useState<JsonRecord[]>([]);
  const [destinations, setDestinations] = useState<JsonRecord[]>([]);
  const [selectedCountryUid, setSelectedCountryUid] = useState('');
  const [selectedCityUid, setSelectedCityUid] = useState('');
  const [selectedDestinationUid, setSelectedDestinationUid] = useState('');
  const [busy, setBusy] = useState<BusyAction>('workspace');
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState('正在读取可恢复的试点作用域');
  const [error, setError] = useState('');
  const [probeDecision, setProbeDecision] = useState<ProbeDecision | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [originConfirmOpen, setOriginConfirmOpen] = useState(false);
  const [originReason, setOriginReason] = useState('厦门试点作用域已核对');
  const workspaceRequest = useRef(0);

  const bootstrapId = entityId(bootstrap, 'bootstrapId', 'id');
  const probeId = entityId(probe, 'probeId', 'id');
  const companyBindingId = entityId(companyBinding, 'companyBindingId', 'id');
  const channelId = entityId(generatedChannel, 'channelId', 'id');
  const assignmentId = entityId(generatedAssignment, 'assignmentId', 'id');
  const bootstrapStatus = entityStatus(bootstrap);
  const probeStatus = resolveProbeDisplayStatus(probe);
  const companyStatus = entityStatus(companyBinding);
  const originStatus = entityStatus(originBinding);
  const candidateLocked = Boolean(bootstrapId);
  const companyVerified = companyStatus === 'VERIFIED' || companyStatus === 'CONFIRMED';
  const scopeComplete = Boolean(
    selectedTenantId && selectedShopId && selectedWarehouseId && selectedDeliveryMethodId,
  );
  const probeReviewable = ['SUBMITTED', 'CAPTURED', 'READY_FOR_REVIEW'].includes(probeStatus);
  const generated = Boolean(channelId && assignmentId);

  const visibleShops = shops.filter((item) => {
    const tenantId = relationId(item, 'tenantId');
    return !selectedTenantId || !tenantId || tenantId === selectedTenantId;
  });
  const visibleWarehouses = warehouses.filter((item) => {
    const shopId = relationId(item, 'shopId');
    return !selectedShopId || !shopId || shopId === selectedShopId;
  });
  const visibleDeliveryMethods = deliveryMethods.filter((item) => {
    const warehouseId = relationId(item, 'warehouseId');
    return !selectedWarehouseId || !warehouseId || warehouseId === selectedWarehouseId;
  });
  const pilotCountries = countries.filter(isChina);
  const pilotCities = cities.filter(isXiamen);
  const pilotDestinations = destinations.filter(isMoscow);
  const selectedCountry = countries.find((item) => locationUid(item) === selectedCountryUid) || null;
  const selectedCity = cities.find((item) => locationUid(item) === selectedCityUid) || null;
  const selectedDestination =
    destinations.find((item) => locationUid(item) === selectedDestinationUid) || null;
  const exactPilotLocations = Boolean(
    selectedCountry && isChina(selectedCountry) &&
      selectedCity && isXiamen(selectedCity) &&
      selectedDestination && isMoscow(selectedDestination),
  );

  function hydrateWorkspace(value: unknown) {
    const source = record(value);
    const nextTenants = catalogRecords(source, 'tenants');
    const nextShops = catalogRecords(source, 'shops');
    const nextWarehouses = catalogRecords(source, 'warehouses');
    const nextMethods = catalogRecords(source, 'deliveryMethods');
    if (nextTenants) setTenants(nextTenants);
    if (nextShops) setShops(nextShops);
    if (nextWarehouses) setWarehouses(nextWarehouses);
    if (nextMethods) setDeliveryMethods(nextMethods);

    const normalized = normalizeScopeBootstrapOperationResult(source);
    const nextBootstrap = entity(normalized.bootstrap);
    const nextProbe = entity(normalized.probe);
    const nextCompany = entity(normalized.companyBinding);
    const nextOrigin = entity(normalized.originBinding);
    const nextChannel = entity(normalized.channel);
    const nextAssignment = entity(normalized.assignment);
    if (nextBootstrap) {
      setBootstrap(nextBootstrap);
      const nestedScope = record(nextBootstrap.openApiScope || nextBootstrap.scope);
      const openApiScope = Object.keys(nestedScope).length > 0
        ? nestedScope : nextBootstrap;
      setSelectedTenantId((current) => text(openApiScope.tenantId) || current);
      setSelectedShopId((current) => text(openApiScope.shopId) || current);
      setSelectedWarehouseId((current) => text(openApiScope.warehouseId) || current);
      setSelectedDeliveryMethodId((current) => text(openApiScope.deliveryMethodId) || current);
    }
    if (nextProbe) setProbe(nextProbe);
    if (nextCompany) setCompanyBinding(nextCompany);
    if (nextOrigin) setOriginBinding(nextOrigin);
    if (nextChannel) setGeneratedChannel(nextChannel);
    if (nextAssignment) setGeneratedAssignment(nextAssignment);
    const normalizedBlockers = records(normalized.blockers);
    const nextBlockers = normalizedBlockers.length > 0
      ? normalizedBlockers
      : records(nextBootstrap?.blockers);
    setBlockers(nextBlockers);
  }

  async function readWorkspace(filters: WorkspaceFilters = {}, quiet = false) {
    const requestId = ++workspaceRequest.current;
    setBusy('workspace');
    setError('');
    try {
      const response = await api.get<JsonRecord>(buildScopeBootstrapWorkspacePath(filters));
      if (requestId !== workspaceRequest.current) return;
      if (response.code !== 1 || !response.data) {
        throw new Error(`${response.msg || '读取失败'} (${responseCode(response)})`);
      }
      hydrateWorkspace(response.data);
      if (!quiet) setMessage(filters.bootstrapId ? '已恢复试点作用域进度' : '试点目录已更新');
    } catch (caught) {
      if (requestId !== workspaceRequest.current) return;
      setError(caught instanceof Error ? caught.message : '读取试点目录失败');
    } finally {
      if (requestId === workspaceRequest.current) {
        setBusy(null);
        setInitialized(true);
      }
    }
  }

  useEffect(() => {
    const savedBootstrapId = localStorage.getItem(BOOTSTRAP_CHECKPOINT_KEY) || '';
    void readWorkspace(savedBootstrapId ? { bootstrapId: savedBootstrapId } : {}, true);
  }, []);

  async function perform<T>(
    action: Exclude<BusyAction, 'workspace' | null>,
    label: string,
    operation: () => Promise<ApiResponse<T>>,
  ): Promise<T | null> {
    setBusy(action);
    setError('');
    try {
      const response = await operation();
      if (response.code !== 1 || response.data === undefined) {
        throw new Error(`${response.msg || `${label}失败`} (${responseCode(response)})`);
      }
      return response.data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label}失败`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function refreshCatalog(filters: WorkspaceFilters) {
    await readWorkspace(filters, true);
  }

  async function createCandidate() {
    if (!scopeComplete || candidateLocked) return;
    const data = await perform('candidate', '创建 bootstrap candidate', () =>
      api.post<JsonRecord>(buildScopeBootstrapPath(), {
        tenantId: selectedTenantId,
        shopId: selectedShopId,
        warehouseId: selectedWarehouseId,
        deliveryMethodId: selectedDeliveryMethodId,
      }),
    );
    if (!data) return;
    const source = record(data);
    const normalized = normalizeScopeBootstrapOperationResult(source);
    const nextBootstrap = entity(normalized.bootstrap);
    if (!nextBootstrap) return;
    setBootstrap(nextBootstrap);
    setBlockers(records(normalized.blockers).length ? records(normalized.blockers) : records(nextBootstrap.blockers));
    const nextBootstrapId = entityId(nextBootstrap, 'bootstrapId', 'id');
    if (nextBootstrapId) {
      localStorage.setItem(BOOTSTRAP_CHECKPOINT_KEY, nextBootstrapId);
      setMessage('OpenAPI bootstrap candidate 已创建，等待 company probe');
      await readWorkspace({ bootstrapId: nextBootstrapId }, true);
    }
  }

  async function issueProbe() {
    if (!bootstrapId) return;
    const data = await perform('probe', '签发 company probe', () =>
      api.post<JsonRecord>(buildBindingProbePath(), { bootstrapId }),
    );
    if (!data) return;
    const source = record(data);
    const normalized = normalizeScopeBootstrapOperationResult(source);
    if (normalized.probe) setProbe(normalized.probe);
    setMessage('company probe 已签发，等待扩展提交证据');
  }

  async function refreshProbe() {
    if (!probeId) return;
    const data = await perform('probe-status', '读取 company probe', () =>
      api.get<JsonRecord>(buildBindingProbeStatusPath(probeId)),
    );
    if (!data) return;
    const source = record(data);
    const normalized = normalizeScopeBootstrapOperationResult(source);
    if (normalized.probe) setProbe(normalized.probe);
    if (normalized.companyBinding) setCompanyBinding(normalized.companyBinding);
    setMessage('company probe 状态已更新');
  }

  async function submitProbeDecision() {
    if (!probeId || !probeDecision || decisionReason.trim().length < 5) return;
    const data = await perform('probe-decision', '提交 company probe 决定', () =>
      api.post<JsonRecord>(buildBindingProbeDecisionPath(probeId, probeDecision), {
        reason: decisionReason.trim(),
      }),
    );
    if (!data) return;
    const normalized = normalizeScopeBootstrapOperationResult(data);
    if (normalized.probe) setProbe(normalized.probe);
    if (normalized.companyBinding) setCompanyBinding(normalized.companyBinding);
    setProbeDecision(null);
    setDecisionReason('');
    setMessage(probeDecision === 'confirm' ? 'company binding 已确认' : 'company probe 已拒绝');
    await readWorkspace({ bootstrapId }, true);
  }

  async function loadCities(countryUid: string) {
    if (!countryUid) {
      setCities([]);
      setSelectedCityUid('');
      return;
    }
    const data = await perform('cities', '读取 Official 城市', () =>
      api.get<JsonRecord>(buildOfficialCitiesPath(countryUid)),
    );
    if (!data) return;
    const nextCities = directoryRecords(data);
    setCities(nextCities);
    const xiamen = nextCities.find(isXiamen);
    setSelectedCityUid(xiamen ? locationUid(xiamen) : '');
  }

  async function loadOfficialLocations() {
    if (!companyVerified) return;
    setBusy('locations');
    setError('');
    try {
      const [countriesResponse, destinationsResponse] = await Promise.all([
        api.get<JsonRecord>(buildOfficialCountriesPath()),
        api.get<JsonRecord>(buildOfficialDestinationsPath()),
      ]);
      if (countriesResponse.code !== 1 || !countriesResponse.data) {
        throw new Error(`${countriesResponse.msg || '国家目录读取失败'} (${responseCode(countriesResponse)})`);
      }
      if (destinationsResponse.code !== 1 || !destinationsResponse.data) {
        throw new Error(`${destinationsResponse.msg || '目的地目录读取失败'} (${responseCode(destinationsResponse)})`);
      }
      const nextCountries = directoryRecords(countriesResponse.data);
      const nextDestinations = directoryRecords(destinationsResponse.data);
      setCountries(nextCountries);
      setDestinations(nextDestinations);
      const china = nextCountries.find(isChina);
      const moscow = nextDestinations.find(isMoscow);
      setSelectedCountryUid(china ? locationUid(china) : '');
      setSelectedDestinationUid(moscow ? locationUid(moscow) : '');
      setMessage('Official 地址目录已加载，请核对 China / Xiamen 与 Russia / Moscow');
      if (china) await loadCities(locationUid(china));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Official 地址目录读取失败');
    } finally {
      setBusy(null);
    }
  }

  async function confirmOrigin() {
    if (!bootstrapId || !companyBindingId || !exactPilotLocations || originReason.trim().length < 5) {
      return;
    }
    const data = await perform('origin', '确认试点作用域', () =>
      api.post<JsonRecord>(buildOriginBindingConfirmPath(bootstrapId), {
        companyBindingId,
        officialLocation: {
          countryUid: selectedCountryUid,
          countryLabel: optionLabel(selectedCountry!),
          cityUid: selectedCityUid,
          cityLabel: optionLabel(selectedCity!),
          countryCode: text(selectedCountry?.countryCode) || 'CN',
        },
        destination: {
          countryUid: text(selectedDestination?.countryUid),
          countryLabel: text(selectedDestination?.countryName) || 'Russia',
          locationUid: selectedDestinationUid,
          locationLabel: optionLabel(selectedDestination!),
          countryCode: text(selectedDestination?.countryCode) || 'RU',
        },
        reason: originReason.trim(),
      }),
    );
    if (!data) return;
    const normalized = normalizeScopeBootstrapOperationResult(data);
    const nextOrigin = entity(normalized.originBinding);
    const nextChannel = entity(normalized.channel);
    const nextAssignment = entity(normalized.assignment);
    if (nextOrigin) setOriginBinding(nextOrigin);
    if (nextChannel) setGeneratedChannel(nextChannel);
    if (nextAssignment) setGeneratedAssignment(nextAssignment);
    setBlockers(records(normalized.blockers));
    setOriginConfirmOpen(false);
    setMessage('试点作用域已确认，Channel 与 Russia / Moscow Assignment 已生成');
    const nextChannelId = entityId(nextChannel, 'channelId', 'id');
    const nextAssignmentId = entityId(nextAssignment, 'assignmentId', 'id');
    if (nextChannelId && nextAssignmentId) {
      await onCompleted?.({ channelId: nextChannelId, assignmentId: nextAssignmentId });
    }
  }

  function resetCheckpoint() {
    localStorage.removeItem(BOOTSTRAP_CHECKPOINT_KEY);
    setBootstrap(null);
    setProbe(null);
    setCompanyBinding(null);
    setOriginBinding(null);
    setGeneratedChannel(null);
    setGeneratedAssignment(null);
    setBlockers([]);
    setCountries([]);
    setCities([]);
    setDestinations([]);
    setSelectedCountryUid('');
    setSelectedCityUid('');
    setSelectedDestinationUid('');
    setMessage('本机检查点已清除，可建立新的 bootstrap candidate');
    setError('');
  }

  return (
    <section aria-labelledby="scope-bootstrap-title" className="border-y bg-muted/10 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" aria-hidden />
            <h2 id="scope-bootstrap-title" className="text-base font-semibold">试点作用域</h2>
            <Badge variant={generated ? 'success' : candidateLocked ? 'warning' : 'secondary'}>
              {generated ? '已生成' : candidateLocked ? '建立中' : '未建立'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">厦门仓库试点 · China / Xiamen → Russia / Moscow</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {candidateLocked && (
            <Button type="button" size="sm" variant="ghost" onClick={resetCheckpoint} disabled={busy !== null}>重新建立</Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void readWorkspace(
                bootstrapId
                  ? { bootstrapId }
                  : { tenantId: selectedTenantId, shopId: selectedShopId, warehouseId: selectedWarehouseId },
              );
            }}
            disabled={busy !== null}
          >
            {busy === 'workspace' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            刷新状态
          </Button>
        </div>
      </div>

      <ol className="mt-4 grid border-y text-xs sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: '作用域候选', complete: candidateLocked, active: !candidateLocked },
          { label: 'company probe', complete: companyVerified, active: candidateLocked && !companyVerified },
          { label: 'Official 发运地', complete: originStatus === 'VERIFIED' || generated, active: companyVerified && !generated },
          { label: 'Channel / Assignment', complete: generated, active: Boolean(originBinding) && !generated },
        ].map((step, index) => (
          <li
            key={step.label}
            className="flex min-w-0 items-center gap-2 border-b px-3 py-2 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 2xl:border-b-0 2xl:border-r 2xl:last:border-r-0"
          >
            <StepStatus complete={step.complete} active={step.active} />
            <span className="font-mono text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 truncate font-medium" title={step.label}>{step.label}</span>
          </li>
        ))}
      </ol>

      {!initialized ? (
        <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />读取试点目录
        </div>
      ) : (
        <>
          <div className="grid gap-3 py-4 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="scope-bootstrap-tenant">ERP 租户</Label>
              <select
                id="scope-bootstrap-tenant"
                className={SELECT_CLASS}
                value={selectedTenantId}
                disabled={candidateLocked || busy !== null}
                onChange={(event) => {
                  const tenantId = event.target.value;
                  setSelectedTenantId(tenantId);
                  setSelectedShopId('');
                  setSelectedWarehouseId('');
                  setSelectedDeliveryMethodId('');
                  void refreshCatalog(tenantId ? { tenantId } : {});
                }}
              >
                <option value="">选择租户</option>
                {tenants.map((item) => {
                  const id = entityId(item, 'tenantId', 'id');
                  return <option key={id} value={id}>{optionLabel(item)}</option>;
                })}
              </select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="scope-bootstrap-shop">Ozon 店铺</Label>
              <select
                id="scope-bootstrap-shop"
                className={SELECT_CLASS}
                value={selectedShopId}
                disabled={!selectedTenantId || candidateLocked || busy !== null}
                onChange={(event) => {
                  const shopId = event.target.value;
                  setSelectedShopId(shopId);
                  setSelectedWarehouseId('');
                  setSelectedDeliveryMethodId('');
                  void refreshCatalog({ tenantId: selectedTenantId, shopId });
                }}
              >
                <option value="">选择 Ozon 店铺</option>
                {visibleShops.map((item) => {
                  const id = entityId(item, 'shopId', 'id');
                  return <option key={id} value={id}>{optionLabel(item)}</option>;
                })}
              </select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="scope-bootstrap-warehouse">ERP 仓库</Label>
              <select
                id="scope-bootstrap-warehouse"
                className={SELECT_CLASS}
                value={selectedWarehouseId}
                disabled={!selectedShopId || candidateLocked || busy !== null}
                onChange={(event) => {
                  const warehouseId = event.target.value;
                  setSelectedWarehouseId(warehouseId);
                  setSelectedDeliveryMethodId('');
                  void refreshCatalog({ tenantId: selectedTenantId, shopId: selectedShopId, warehouseId });
                }}
              >
                <option value="">选择已同步仓库</option>
                {visibleWarehouses.map((item) => {
                  const id = entityId(item, 'warehouseId', 'id');
                  return <option key={id} value={id}>{optionLabel(item)}</option>;
                })}
              </select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="scope-bootstrap-method">发运方式</Label>
              <select
                id="scope-bootstrap-method"
                className={SELECT_CLASS}
                value={selectedDeliveryMethodId}
                disabled={!selectedWarehouseId || candidateLocked || busy !== null}
                onChange={(event) => setSelectedDeliveryMethodId(event.target.value)}
              >
                <option value="">选择 Ozon 发运方式</option>
                {visibleDeliveryMethods.map((item) => {
                  const id = entityId(item, 'deliveryMethodId', 'id');
                  return <option key={id} value={id}>{optionLabel(item)}</option>;
                })}
              </select>
            </div>
          </div>

          <div className="grid gap-6 border-t pt-4 xl:grid-cols-2">
            <section aria-labelledby="bootstrap-candidate-heading" className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <h3 id="bootstrap-candidate-heading" className="text-sm font-semibold">OpenAPI bootstrap candidate</h3>
                </div>
                <Badge variant={statusVariant(bootstrapStatus)}>{bootstrapStatus || '未创建'}</Badge>
              </div>
              <dl className="grid gap-x-4 gap-y-2 border-y py-3 text-xs sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-muted-foreground">Bootstrap</dt><dd className="mt-0.5 break-all font-mono">{bootstrapId || '-'}</dd></div>
                <div className="min-w-0"><dt className="text-muted-foreground">发运方式</dt><dd className="mt-0.5 break-all font-mono">{selectedDeliveryMethodId || '-'}</dd></div>
              </dl>
              <Button type="button" onClick={() => void createCandidate()} disabled={!scopeComplete || candidateLocked || busy !== null}>
                {busy === 'candidate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                创建 candidate
              </Button>
            </section>

            <section aria-labelledby="bootstrap-probe-heading" className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <h3 id="bootstrap-probe-heading" className="text-sm font-semibold">company probe</h3>
                </div>
                <Badge variant={statusVariant(probeStatus)}>{probeStatus || '未签发'}</Badge>
              </div>
              <dl className="grid gap-x-4 gap-y-2 border-y py-3 text-xs sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-muted-foreground">Probe</dt><dd className="mt-0.5 break-all font-mono">{probeId || '-'}</dd></div>
                <div className="min-w-0"><dt className="text-muted-foreground">到期时间</dt><dd className="mt-0.5 break-all">{text(probe?.expiresAt) || '-'}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void issueProbe()}
                  disabled={!bootstrapId || busy !== null || (Boolean(probeId) && !['REJECTED', 'EXPIRED', 'FAILED'].includes(probeStatus))}
                >
                  {busy === 'probe' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  签发 probe
                </Button>
                <Button type="button" variant="outline" onClick={() => void refreshProbe()} disabled={!probeId || busy !== null}>
                  {busy === 'probe-status' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  查看 probe
                </Button>
                <Button type="button" size="sm" onClick={() => setProbeDecision('confirm')} disabled={!probeReviewable || busy !== null}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden />确认
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => setProbeDecision('reject')} disabled={!probeReviewable || busy !== null}>
                  <XCircle className="h-4 w-4" aria-hidden />拒绝
                </Button>
              </div>
            </section>
          </div>

          <section aria-labelledby="bootstrap-origin-heading" className="mt-5 space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                <h3 id="bootstrap-origin-heading" className="text-sm font-semibold">Official 发运地与目的地</h3>
                <Badge variant={exactPilotLocations ? 'success' : 'secondary'}>{exactPilotLocations ? '精确命中' : '待选择'}</Badge>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadOfficialLocations()} disabled={!companyVerified || busy !== null}>
                {busy === 'locations' || busy === 'cities' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                读取 Official 地址
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-[1fr_1fr_1.2fr_auto] 2xl:items-end">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="scope-origin-country">始发国家 · China</Label>
                <select
                  id="scope-origin-country"
                  className={SELECT_CLASS}
                  value={selectedCountryUid}
                  disabled={!companyVerified || pilotCountries.length === 0 || busy !== null}
                  onChange={(event) => {
                    setSelectedCountryUid(event.target.value);
                    setSelectedCityUid('');
                    void loadCities(event.target.value);
                  }}
                >
                  <option value="">选择 Official 国家</option>
                  {pilotCountries.map((item) => <option key={locationUid(item)} value={locationUid(item)}>{optionLabel(item)}</option>)}
                </select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="scope-origin-city">始发城市 · Xiamen</Label>
                <select id="scope-origin-city" className={SELECT_CLASS} value={selectedCityUid} disabled={!selectedCountryUid || pilotCities.length === 0 || busy !== null} onChange={(event) => setSelectedCityUid(event.target.value)}>
                  <option value="">选择 Official 城市</option>
                  {pilotCities.map((item) => <option key={locationUid(item)} value={locationUid(item)}>{optionLabel(item)}</option>)}
                </select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="scope-destination">发布目的地 · Russia / Moscow</Label>
                <select id="scope-destination" className={SELECT_CLASS} value={selectedDestinationUid} disabled={!companyVerified || pilotDestinations.length === 0 || busy !== null} onChange={(event) => setSelectedDestinationUid(event.target.value)}>
                  <option value="">选择 Official 目的地</option>
                  {pilotDestinations.map((item) => <option key={locationUid(item)} value={locationUid(item)}>{text(item.countryName) || 'Russia'} / {optionLabel(item)}</option>)}
                </select>
              </div>
              <Button type="button" onClick={() => setOriginConfirmOpen(true)} disabled={!companyBindingId || !exactPilotLocations || generated || busy !== null}>
                <Route className="h-4 w-4" aria-hidden />确认作用域
              </Button>
            </div>
          </section>

          <section aria-labelledby="bootstrap-result-heading" className="mt-5 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-muted-foreground" aria-hidden />
                <h3 id="bootstrap-result-heading" className="text-sm font-semibold">生成的发布作用域</h3>
              </div>
              <Badge variant={generated ? 'success' : blockers.length ? 'destructive' : 'secondary'}>
                {generated ? '可进入采集' : blockers.length ? `${blockers.length} 项阻断` : '尚未生成'}
              </Badge>
            </div>
            <dl className="mt-3 grid gap-x-5 gap-y-3 border-y py-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0"><dt className="text-muted-foreground">Company binding</dt><dd className="mt-0.5 break-all font-mono">{companyBindingId || '-'}</dd></div>
              <div className="min-w-0"><dt className="text-muted-foreground">Origin binding</dt><dd className="mt-0.5 break-all font-mono">{entityId(originBinding, 'originBindingId', 'id') || '-'}</dd></div>
              <div className="min-w-0"><dt className="text-muted-foreground">Channel</dt><dd className="mt-0.5 break-all font-mono">{channelId || '-'}</dd></div>
              <div className="min-w-0"><dt className="text-muted-foreground">Russia / Moscow Assignment</dt><dd className="mt-0.5 break-all font-mono">{assignmentId || '-'}</dd></div>
            </dl>
          </section>

          {blockers.length > 0 && (
            <div className="mt-4 border-l-2 border-destructive/60 bg-destructive/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden />当前阻断</div>
              <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                {blockers.map((item, index) => <li key={`${text(item.code)}:${index}`} className="min-w-0 break-words">{blockerLabel(item)}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      <div aria-live="polite" aria-atomic="true" className="mt-3 min-h-5 text-xs">
        {error ? (
          <span className="inline-flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /><span className="break-words">{error}</span></span>
        ) : (
          <span className="text-muted-foreground">{message}</span>
        )}
      </div>

      <Dialog open={Boolean(probeDecision)} onOpenChange={(open) => {
        if (!open && busy !== 'probe-decision') {
          setProbeDecision(null);
          setDecisionReason('');
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认 company probe 决定</DialogTitle>
            <DialogDescription>
              {probeDecision === 'reject' ? '拒绝后该 probe 进入终态，需要重新签发并提交证据。' : '确认后 company_id 将固化为已验证绑定，不能由前端直接填写。'}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 border-y py-3 text-xs sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-muted-foreground">Probe</dt><dd className="mt-0.5 break-all font-mono">{probeId || '-'}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">当前状态</dt><dd className="mt-0.5">{probeStatus || '-'}</dd></div>
          </dl>
          <div className="space-y-1.5">
            <Label htmlFor="scope-probe-decision-reason">审核原因</Label>
            <Input id="scope-probe-decision-reason" value={decisionReason} maxLength={500} onChange={(event) => setDecisionReason(event.target.value)} placeholder="至少 5 个字符" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProbeDecision(null)} disabled={busy === 'probe-decision'}>取消</Button>
            <Button type="button" variant={probeDecision === 'reject' ? 'destructive' : 'default'} onClick={() => void submitProbeDecision()} disabled={decisionReason.trim().length < 5 || busy === 'probe-decision'}>
              {busy === 'probe-decision' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {probeDecision === 'reject' ? '确认拒绝' : '确认绑定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={originConfirmOpen} onOpenChange={(open) => {
        if (busy !== 'origin') setOriginConfirmOpen(open);
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>确认试点作用域</DialogTitle>
            <DialogDescription>确认后将创建已验证发运地绑定、Channel 和 Russia / Moscow Assignment。</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 border-y py-3 text-xs sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-muted-foreground">Official 发运地</dt><dd className="mt-0.5 break-words font-medium">{selectedCountry ? optionLabel(selectedCountry) : '-'} / {selectedCity ? optionLabel(selectedCity) : '-'}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">Official 目的地</dt><dd className="mt-0.5 break-words font-medium">{selectedDestination ? `${text(selectedDestination.countryName) || 'Russia'} / ${optionLabel(selectedDestination)}` : '-'}</dd></div>
          </dl>
          <div className="space-y-1.5">
            <Label htmlFor="scope-origin-reason">确认原因</Label>
            <Input id="scope-origin-reason" value={originReason} maxLength={500} onChange={(event) => setOriginReason(event.target.value)} placeholder="至少 5 个字符" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOriginConfirmOpen(false)} disabled={busy === 'origin'}>取消</Button>
            <Button type="button" onClick={() => void confirmOrigin()} disabled={!exactPilotLocations || originReason.trim().length < 5 || busy === 'origin'}>
              {busy === 'origin' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              确认并生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
