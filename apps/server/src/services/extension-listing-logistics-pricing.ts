import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SourceListingWorkflowService } from './source-listing-workflow.js';
import type { SourceListingWorkflowContextResolver } from './source-listing-workflow-context.js';
import type { ExtensionListingEditorBinding, ExtensionListingEditorIdentity } from './extension-listing-editor.js';
import type { LogisticsRuleDeviceRepository } from '../routes/logistics-rules.js';
import { evaluateOzonFrozenRuleMinor, ozonSellerFormulaSchema, ozonLogisticsScopeSchema,
  ozonServiceIdentitySchema, type OzonListingDraftCategory } from 'shared';
import { projectSourceListingSkuPackaging, SourceListingSkuPackagingError } from './source-listing-sku-packaging.js';

export interface ExtensionListingLogisticsIdentity extends ExtensionListingEditorIdentity { sessionId: string; scopes: string[] }
export interface ExtensionListingLogisticsSelection {
  assignmentId: string; companyId: string; warehouseId: string;
  originCountryUid: string; originCityUid: string; destinationCountryUid: string; destinationLocationUid: string;
}
export interface ExtensionListingLogisticsPricingOptions {
  workflow: Pick<SourceListingWorkflowService, 'getDraft'>;
  ownership: Pick<SourceListingWorkflowContextResolver, 'assertOwnedTarget'>;
  repository: Pick<LogisticsRuleDeviceRepository, 'listAssignmentsForDevice' | 'getEffectiveReleaseForDevice' | 'authorizeEffectiveReleaseDelivery'>;
  deploymentId: string;
  now?: () => Date;
  loadPricingHints?(input: { ownerUserId: string; shopId: string; category: OzonListingDraftCategory | null; now: Date }): Promise<{
    commission: { percent: number; source: string; fetchedAt: string; categoryId: number; typeId: number } | null;
    fx: { rate: number; source: string; fetchedAt: string } | null;
  }>;
}
export class ExtensionListingLogisticsPricingError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ExtensionListingLogisticsPricingError';
  }
}
function fail(code: string, status: number, message: string): never { throw new ExtensionListingLogisticsPricingError(code, status, message); }
const nonEmpty = z.string().trim().min(1).max(300);
const checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const assignmentSchema = z.object({ assignmentId: nonEmpty, shopId: nonEmpty, shopName: nonEmpty, companyId: nonEmpty,
  warehouseId: nonEmpty, warehouseName: nonEmpty, originCountryUid: nonEmpty, originCityUid: nonEmpty, originLabel: nonEmpty,
  destinationCountryUid: nonEmpty, destinationLocationUid: nonEmpty, destinationLabel: nonEmpty,
  releaseSequence: z.number().int().nonnegative(), effectiveReleaseAvailable: z.boolean() }).strip();
const uniqueKeys = z.array(nonEmpty).max(500).refine(keys => new Set(keys).size === keys.length);
const frozenScopeSchema = z.object({ deploymentId: nonEmpty, schemaMajor: z.literal(1), tenantId: nonEmpty, shopId: nonEmpty,
  warehouseId: nonEmpty, ozonCompanyId: nonEmpty, originCountryUid: nonEmpty, originCityUid: nonEmpty,
  destinationCountryUid: nonEmpty, destinationLocationUid: nonEmpty }).strip();
const routeEvidence = z.object({ stableServiceKey: nonEmpty, destinationCountryUid: nonEmpty, destinationLocationUid: nonEmpty }).strip();
const bundleSchema = z.object({
  scope: frozenScopeSchema,
  assignment: z.object({ id: nonEmpty, destinationCountryUid: nonEmpty, destinationLocationUid: nonEmpty }).strip(),
  manifest: z.object({ selectedServiceKeys: uniqueKeys, minimumExtensionVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    destination: z.object({ destinationCountryUid: nonEmpty, destinationLocationUid: nonEmpty }).strip() }).strip(),
  deliveryMethodBindings: z.array(z.object({ stableServiceKey: nonEmpty }).strip()).max(500),
  revisionPayload: z.object({ scope: ozonLogisticsScopeSchema,
    services: z.array(ozonServiceIdentitySchema).max(500), formulas: z.array(ozonSellerFormulaSchema).max(500),
    destinationEvidence: z.array(routeEvidence).max(5000),
    cityAvailabilityOverlays: z.array(z.object({ origin: z.object({ countryUid: nonEmpty, cityUid: nonEmpty }).strip(),
      destination: z.object({ countryUid: nonEmpty, locationUid: nonEmpty }).strip(),
      services: z.array(z.object({ stableServiceKey: nonEmpty, isDropOff: z.boolean(),
        clusterDeliverySpeeds: z.array(z.object({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative(), clusterName: nonEmpty }).strip()).max(500) }).strip()).max(500) }).strip()).max(1000),
  }).strip(),
}).strip();
const selectionKeys = ['assignmentId', 'companyId', 'warehouseId', 'originCountryUid', 'originCityUid', 'destinationCountryUid', 'destinationLocationUid'] as const;
const contractVersion = 'extension-listing-logistics-pricing/v1' as const;
const MAX_HINT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function fresh(value: string | undefined, now: Date): boolean {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) && timestamp <= now.getTime() && timestamp > now.getTime() - MAX_HINT_AGE_MS;
}
function sourceIsMeasured(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
    && !/fallback|unknown|manual|default/i.test(value);
}
function versionAtLeast(current: string | undefined, minimum: string): boolean {
  if (!current || !/^\d+\.\d+\.\d+$/u.test(current)) return false;
  const left = current.split('.').map(Number), right = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isSafeInteger(left[i]) || !Number.isSafeInteger(right[i])) return false;
    if (left[i] !== right[i]) return left[i]! > right[i]!;
  }
  return true;
}

export function createExtensionListingLogisticsPricingService(options: ExtensionListingLogisticsPricingOptions) {
  const clock = options.now || (() => new Date());
  function assertScope(identity: ExtensionListingLogisticsIdentity, scope: 'logistics:discover' | 'logistics:read') {
    if (!identity.sessionId || !Array.isArray(identity.scopes) || !identity.scopes.includes('listing:review')
      || !identity.scopes.includes(scope)) fail('logistics_scope_denied', 403, `当前设备没有 ${scope} 权限，请在 ERP 设备设置中确认授权并重新配对；仍可手工填写费用。`);
  }
  async function bound(identity: ExtensionListingLogisticsIdentity, binding: ExtensionListingEditorBinding) {
    if (identity.ownerUserId !== identity.actorUserId || !identity.allowedShopIds.includes(binding.shopId)) {
      fail('logistics_shop_denied', 403, '设备无权读取当前店铺物流定价');
    }
    const draft = await options.workflow.getDraft({ ownerUserId: identity.ownerUserId, draftId: binding.listingWorkflowId });
    if (draft.shopId !== binding.shopId || draft.sourceCaptureSnapshotId !== binding.snapshotId
      || draft.supplyGoodsId !== binding.supplyGoodsId || draft.revision !== binding.draftRevision || draft.draftVersion !== binding.draftVersion) {
      fail('logistics_context_stale', 409, '当前商品、SKU 或草稿版本已变化，请重新读取');
    }
    await options.ownership.assertOwnedTarget({ ownerUserId: identity.ownerUserId, shopId: draft.shopId, supplyGoodsId: draft.supplyGoodsId,
      sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, currentSourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, selectedSkuKeys: draft.selectedSkuKeys });
    return draft;
  }
  const currentDevice = (identity: ExtensionListingLogisticsIdentity, shopId: string) => ({
    sessionId: identity.sessionId, ownerUserId: identity.ownerUserId, allowedShopIds: [shopId],
  });
  async function assignments(identity: ExtensionListingLogisticsIdentity, shopId: string) {
    return z.array(assignmentSchema).max(500).parse(await options.repository.listAssignmentsForDevice(currentDevice(identity, shopId)))
      .filter(assignment => assignment.shopId === shopId);
  }
  async function hints(identity: ExtensionListingLogisticsIdentity, draft: Awaited<ReturnType<typeof bound>>, serverNow: Date) {
    const value = options.loadPricingHints ? await options.loadPricingHints({
      ownerUserId: identity.ownerUserId, shopId: draft.shopId, category: draft.category, now: serverNow,
    }) : null;
    const c = value?.commission, f = value?.fx;
    const commission = c && draft.category && c.categoryId === draft.category.categoryId && c.typeId === draft.category.typeId
      && typeof c.percent === 'number' && Number.isFinite(c.percent) && c.percent >= 0 && c.percent < 100
      && sourceIsMeasured(c.source) && fresh(c.fetchedAt, serverNow)
      ? { percent: c.percent, source: c.source, fetchedAt: c.fetchedAt, categoryId: c.categoryId, typeId: c.typeId } : null;
    const fx = f && typeof f.rate === 'number' && Number.isFinite(f.rate) && f.rate > 0 && f.rate <= 1000
      && sourceIsMeasured(f.source) && fresh(f.fetchedAt, serverNow)
      ? { rate: f.rate, source: f.source, fetchedAt: f.fetchedAt } : null;
    return { commission, fx, requiresManual: [...(!commission ? ['commissionPct'] : []), ...(!fx ? ['fxRate'] : [])] };
  }
  async function releaseFor(identity: ExtensionListingLogisticsIdentity, binding: ExtensionListingEditorBinding,
    selection: ExtensionListingLogisticsSelection, version?: string) {
    assertScope(identity, 'logistics:discover');
    assertScope(identity, 'logistics:read');
    const draft = await bound(identity, binding), serverNow = clock();
    const assignment = (await assignments(identity, draft.shopId)).find(candidate => candidate.assignmentId === selection.assignmentId);
    if (!assignment || selectionKeys.some(key => assignment[key] !== selection[key])) {
      fail('logistics_selection_stale', 409, '物流仓库或起讫地已变化，请重新选择当前店铺配置');
    }
    const release = await options.repository.getEffectiveReleaseForDevice({ ...currentDevice(identity, draft.shopId), assignmentId: assignment.assignmentId, now: serverNow });
    if (release.state === 'not_found') fail('logistics_release_not_found', 404, '当前店铺没有可用的已发布物流规则');
    if (release.state === 'gone') fail('logistics_assignment_revoked', 410, '该物流配置已撤销，请重新读取');
    const expectedScope = { deploymentId: options.deploymentId, schemaMajor: 1, tenantId: identity.ownerUserId,
      shopId: draft.shopId, warehouseId: selection.warehouseId, ozonCompanyId: selection.companyId,
      originCountryUid: selection.originCountryUid, originCityUid: selection.originCityUid,
      destinationCountryUid: selection.destinationCountryUid, destinationLocationUid: selection.destinationLocationUid };
    const parsed = bundleSchema.safeParse(release.bundle);
    if (!parsed.success || release.assignmentId !== assignment.assignmentId || !checksum.safeParse(release.effectiveChecksum).success
      || !checksum.safeParse(release.contentChecksum).success || !release.releaseId || !release.scopeKey
      || !Number.isSafeInteger(release.releaseSequence) || release.releaseSequence < 1) {
      fail('logistics_release_invalid', 409, '已发布物流规则格式不完整，请联系管理员重新核验');
    }
    const bundle = parsed.data, revision = bundle.revisionPayload;
    const revisionExpected = { ...expectedScope, erpWarehouseId: expectedScope.warehouseId };
    if (Object.entries(expectedScope).some(([key, value]) => bundle.scope[key as keyof typeof expectedScope] !== value)
      || Object.entries(revisionExpected).filter(([key]) => key !== 'warehouseId').some(([key, value]) => revision.scope[key as keyof typeof revision.scope] !== value)
      || bundle.assignment.id !== assignment.assignmentId
      || bundle.assignment.destinationCountryUid !== selection.destinationCountryUid
      || bundle.assignment.destinationLocationUid !== selection.destinationLocationUid
      || bundle.manifest.destination.destinationCountryUid !== selection.destinationCountryUid
      || bundle.manifest.destination.destinationLocationUid !== selection.destinationLocationUid) {
      fail('logistics_release_scope_mismatch', 409, '已发布物流规则与当前店铺、仓库或起讫地不一致');
    }
    if (!freshRelease(release.validUntil, serverNow)) fail('logistics_release_expired', 409, '物流规则验证已过期，不能自动填写运费；请管理员重新验证发布');
    if (!versionAtLeast(version, release.minExtensionVersion) || !versionAtLeast(version, bundle.manifest.minimumExtensionVersion)) {
      fail('logistics_upgrade_required', 426, '扩展版本过低，请先更新扩展再读取物流规则');
    }
    const serviceKeys = revision.services.map(item => item.stableServiceKey), formulaKeys = revision.formulas.map(item => item.stableServiceKey);
    if (new Set(serviceKeys).size !== serviceKeys.length || new Set(formulaKeys).size !== formulaKeys.length) {
      fail('logistics_release_invalid', 409, '已发布物流方式存在重复映射，请联系管理员核验');
    }
    const boundKeys = new Set(bundle.deliveryMethodBindings.map(item => item.stableServiceKey));
    const destinationKeys = new Set(revision.destinationEvidence.filter(item => item.destinationCountryUid === selection.destinationCountryUid
      && item.destinationLocationUid === selection.destinationLocationUid).map(item => item.stableServiceKey));
    const availableKeys = new Set(revision.cityAvailabilityOverlays.filter(item => item.origin.countryUid === selection.originCountryUid
      && item.origin.cityUid === selection.originCityUid && item.destination.countryUid === selection.destinationCountryUid
      && item.destination.locationUid === selection.destinationLocationUid).flatMap(item => item.services.filter(service => service.clusterDeliverySpeeds.length > 0).map(service => service.stableServiceKey)));
    const eligibleKeys = bundle.manifest.selectedServiceKeys.filter(key => serviceKeys.includes(key) && formulaKeys.includes(key)
      && boundKeys.has(key) && destinationKeys.has(key) && availableKeys.has(key));
    return { draft, serverNow, release, bundle, eligibleKeys, selection };
  }
  async function authorize(identity: ExtensionListingLogisticsIdentity, binding: ExtensionListingEditorBinding, context: Awaited<ReturnType<typeof releaseFor>>) {
    const serverNow = clock();
    if (!freshRelease(context.release.validUntil, serverNow)) fail('logistics_release_expired', 409, '物流规则已过期，请重新读取');
    const delivery = await options.repository.authorizeEffectiveReleaseDelivery({ ...currentDevice(identity, context.draft.shopId),
      assignmentId: context.release.assignmentId, releaseId: context.release.releaseId, effectiveChecksum: context.release.effectiveChecksum,
      scopeKey: context.release.scopeKey, now: serverNow });
    if (delivery.state === 'not_found') fail('logistics_release_not_found', 404, '物流配置授权已失效');
    if (delivery.state === 'gone') fail('logistics_assignment_revoked', 410, '物流配置授权已撤销，请重新读取');
    if (!freshRelease(delivery.authorizationValidUntil, serverNow)) fail('logistics_authorization_expired', 409, '设备物流授权已过期，请重新配对');
    await bound(identity, binding);
    return { authorizationValidUntil: delivery.authorizationValidUntil, validUntil: context.release.validUntil };
  }
  function freshRelease(validUntil: string, serverNow: Date) { return Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) > serverNow.getTime(); }
  return {
    async scopes(identity: ExtensionListingLogisticsIdentity, binding: ExtensionListingEditorBinding) {
      assertScope(identity, 'logistics:discover');
      const draft = await bound(identity, binding);
      const choices = await assignments(identity, draft.shopId);
      const pricingHints = await hints(identity, draft, clock());
      let packaging = null;
      try { packaging = projectSourceListingSkuPackaging(draft); } catch (error) { if (!(error instanceof SourceListingSkuPackagingError)) throw error; }
      await bound(identity, binding);
      return { contractVersion, binding, selectedSkuKeys: sourceListingEditorSkuKeysForDraft(draft), packaging: packaging || [], assignments: choices, hints: pricingHints, requiresSelection: true };
    },
    async services(identity: ExtensionListingLogisticsIdentity, binding: ExtensionListingEditorBinding, selection: ExtensionListingLogisticsSelection, version?: string) {
      const context = await releaseFor(identity, binding, selection, version);
      const services = context.eligibleKeys.map(key => {
        const identity = context.bundle.revisionPayload.services.find(item => item.stableServiceKey === key)!;
        const formula = context.bundle.revisionPayload.formulas.find(item => item.stableServiceKey === key)!;
        return { stableServiceKey: key, providerId: identity.providerId, displayName: formula.calculationRule.displayName,
          deliveryVariant: identity.deliveryVariant, deliveryPromise: formula.calculationRule.deliveryPromise };
      });
      const pricingHints = await hints(identity, context.draft, context.serverNow);
      const authorization = await authorize(identity, binding, context);
      return { contractVersion, binding, selection, releaseId: context.release.releaseId, releaseSequence: context.release.releaseSequence,
        effectiveChecksum: context.release.effectiveChecksum, services, hints: pricingHints, ...authorization, requiresSelection: true };
    },
    async quote(identity: ExtensionListingLogisticsIdentity, input: { binding: ExtensionListingEditorBinding; selection: ExtensionListingLogisticsSelection; releaseId: string; effectiveChecksum: string; stableServiceKey: string; items: Array<{ skuKey: string; declaredPriceMinor: number; hasBattery: boolean }> }, version?: string) {
      const context = await releaseFor(identity, input.binding, input.selection, version);
      if (context.release.releaseId !== input.releaseId || context.release.effectiveChecksum !== input.effectiveChecksum) fail('logistics_release_stale', 409, '物流规则已更新，请重新读取方式并计算预览');
      if (!context.eligibleKeys.includes(input.stableServiceKey)) fail('logistics_service_unavailable', 422, '该物流方式不在当前店铺的已发布可用路线中');
      if (!Array.isArray(input.items) || input.items.length !== sourceListingEditorSkuKeysForDraft(context.draft).length
        || new Set(input.items.map(item => item.skuKey)).size !== input.items.length
        || input.items.some(item => !sourceListingEditorSkuKeysForDraft(context.draft).includes(item.skuKey)
          || !Number.isSafeInteger(item.declaredPriceMinor) || item.declaredPriceMinor <= 0 || item.declaredPriceMinor > 1_000_000_000 || typeof item.hasBattery !== 'boolean')) {
        fail('logistics_quote_input_invalid', 400, '报价必须覆盖当前所选 SKU，并明确每个 SKU 的正数 CNY 申报价和电池状态');
      }
      let packaging;
      try { packaging = projectSourceListingSkuPackaging(context.draft); } catch (error) {
        if (!(error instanceof SourceListingSkuPackagingError)) throw error;
        fail('logistics_packaging_required', 422, '请先核实并保存当前 SKU 的包装重量与长宽高');
      }
      if (!packaging) fail('logistics_packaging_required', 422, '请先核实并保存当前 SKU 的包装重量与长宽高');
      const formula = context.bundle.revisionPayload.formulas.find(item => item.stableServiceKey === input.stableServiceKey)!;
      const matchedRuleDigest = createHash('sha256').update(JSON.stringify(formula)).digest('hex');
      const items = sourceListingEditorSkuKeysForDraft(context.draft).map(skuKey => {
        const item = input.items.find(item => item.skuKey === skuKey)!, pack = packaging.find(item => item.skuKey === skuKey)!;
        const shippingMinor = evaluateOzonFrozenRuleMinor(formula, { origin: { countryUid: input.selection.originCountryUid, cityUid: input.selection.originCityUid },
          destination: { countryUid: input.selection.destinationCountryUid, locationUid: input.selection.destinationLocationUid },
          currency: 'CNY', declaredPriceMinor: item.declaredPriceMinor, batteryInput: item.hasBattery,
          package: { weight: { value: pack.weightG, unit: 'g' }, dimensions: { length: pack.lengthMm, width: pack.widthMm, height: pack.heightMm, unit: 'mm' } } });
        if (shippingMinor === null || !Number.isSafeInteger(shippingMinor) || shippingMinor < 0 || shippingMinor > 1_000_000_000) {
          fail('logistics_quote_unavailable', 422, '当前 SKU 的价格、电池、包装或重量不匹配该物流方式，请调整输入或选择其他方式');
        }
        return { skuKey, declaredPriceMinor: item.declaredPriceMinor, shippingMinor, packingMinor: 0, totalLogisticsMinor: shippingMinor,
          shippingCostMinor: shippingMinor, shippingCostCny: shippingMinor / 100,
          matchedBand: { priceRangeCNY: formula.calculationRule.conditions.priceRangeCNY, priceRangeRUB: formula.calculationRule.conditions.priceRangeRUB }, matchedRuleDigest };
      });
      const pricingHints = await hints(identity, context.draft, context.serverNow);
      const authorization = await authorize(identity, input.binding, context);
      return { contractVersion, binding: input.binding, selection: input.selection, releaseId: context.release.releaseId, effectiveChecksum: context.release.effectiveChecksum,
        stableServiceKey: input.stableServiceKey, source: 'ERP_PUBLISHED_FORMULA' as const, currency: 'CNY' as const, items, hints: pricingHints, ...authorization,
        requiresPricePreview: true, writesDraft: false };
    },
  };
}
export type ExtensionListingLogisticsPricingService = ReturnType<typeof createExtensionListingLogisticsPricingService>;
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';
