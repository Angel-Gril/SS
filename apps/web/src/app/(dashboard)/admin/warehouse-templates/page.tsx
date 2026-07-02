'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Star, Warehouse, Truck, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface WarehouseTemplate {
  id: string;
  name: string;
  warehouseType: string;
  phone: string;
  countryCode: string;
  city: string | null;
  street: string | null;
  zipCode: string | null;
  building: string | null;
  block: string | null;
  latitude: number | null;
  longitude: number | null;
  minWorkingDays: number;
  workingDays: string[];
  workingHourFrom: string;
  workingHourTo: string;
  holidays: Array<{ day: string; isWorking: boolean; from?: string; to?: string }> | null;
  returnPolicy: string;
  returnCarrier: string | null;
  returnAddressSameAsWarehouse: boolean;
  returnPhoneSameAsWarehouse: boolean;
  returnRecipient: string | null;
  returnMethod: string | null;
  returnZipCode: string | null;
  firstMileType: string;
  dropOffPointId: string | null;
  cutInTime: number;
  timeslotId: number;
  returnPointId: string | null;
  isKgt: boolean;
  warehouseOptions: any;
  deliveryMethodPayload: any;
  isRecommended: boolean;
  createdAt: string;
}

const ALL_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const DAY_LABELS: Record<string, string> = {
  MONDAY: '周一', TUESDAY: '周二', WEDNESDAY: '周三',
  THURSDAY: '周四', FRIDAY: '周五', SATURDAY: '周六', SUNDAY: '周日',
};
const COUNTRIES = [
  { code: 'CN', label: '中国 China' },
  { code: 'RU', label: '俄罗斯 Russia' },
  { code: 'KZ', label: '哈萨克斯坦 Kazakhstan' },
  { code: 'BY', label: '白俄罗斯 Belarus' },
];
const RETURN_CARRIERS = ['IML', 'CDEK', 'OZON Логистика', 'PickPoint', 'EMS', 'Boxberry'];
const PREP_DAYS = [1, 2, 3, 4, 5, 7, 10, 14];

export default function WarehouseTemplatesPage() {
  const systemDialog = useSystemDialog();
  const [list, setList] = useState<WarehouseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WarehouseTemplate | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get<WarehouseTemplate[]>('/api/admin/warehouse/templates');
    if (res.code === 1 && res.data) setList(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OZON 仓库物流模板</h1>
          <p className="text-muted-foreground mt-1">
            维护 Ozon 仓库/物流方式照填模板。Ozon 后台没有稳定公开的物流创建/导入接口，这里不会直接写入 Ozon；用户按模板复制或参考后在 Ozon 后台配置。
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowDialog(true); }}><Plus className="h-4 w-4 mr-1" />新增模板</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">模板列表（{list.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : list.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无模板，点击右上角新增照填模板</p>
          ) : (
            <div className="space-y-2">
              {list.map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {t.warehouseType === 'aggregator' ? <Warehouse className="h-4 w-4 text-blue-600" /> : <Truck className="h-4 w-4 text-green-600" />}
                      <span className="font-medium">{t.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {t.warehouseType === 'aggregator' ? 'Ozon Partners' : t.warehouseType === 'fbs' ? 'rFBS（自送/第三方）' : '自送/第三方'}
                      </Badge>
                      {t.isRecommended && <Badge className="bg-orange-500"><Star className="h-3 w-3 mr-1" />推荐</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                      <span>电话: {t.phone}</span>
                      {t.city && <span>城市: {t.city}</span>}
                      <span>备货: {t.minWorkingDays}天</span>
                      <span>退货: {t.returnPolicy === 'destroy' ? '销毁' : `发回(${t.returnCarrier || '-'})`}</span>
                      <span>工作日: {(t.workingDays || []).map((d) => DAY_LABELS[d] || d).join('/')}</span>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(t); setShowDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                    const confirmed = await systemDialog.confirm({
                      title: '删除仓库模板',
                      message: '确认删除该模板？',
                      confirmText: '删除',
                      tone: 'destructive',
                    });
                    if (!confirmed) return;
                    const res = await api.delete(`/api/admin/warehouse/templates/${t.id}`);
                    if (res.code === 1) { toast({ title: '已删除' }); load(); }
                    else toast({ title: res.msg || '删除失败', variant: 'destructive' });
                  }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showDialog && (
        <TemplateDialog
          template={editing}
          onClose={() => setShowDialog(false)}
          onSuccess={() => { setShowDialog(false); load(); }}
        />
      )}
    </div>
  );
}

interface FormState {
  name: string;
  warehouseType: string;
  isRecommended: boolean;
  phone: string;
  countryCode: string;
  city: string;
  street: string;
  zipCode: string;
  building: string;
  block: string;
  latitude: string;
  longitude: string;
  minWorkingDays: string;
  workingDays: string[];
  workingHourFrom: string;
  workingHourTo: string;
  holidays: Array<{ day: string; isWorking: boolean }>;
  returnPolicy: string;
  returnCarrier: string;
  returnAddressSameAsWarehouse: boolean;
  returnPhoneSameAsWarehouse: boolean;
  returnRecipient: string;
  returnMethod: string;
  returnZipCode: string;
  firstMileType: string;
  dropOffPointId: string;
  cutInTime: string;
  timeslotId: string;
  returnPointId: string;
  isKgt: boolean;
  optComment: string;
  optCourierPhones: string;
  optAutoAssembly: boolean;
  optWaybillEnabled: boolean;
  deliveryMethodJson: string;
}

function getInitialForm(t: WarehouseTemplate | null): FormState {
  if (!t) return {
    name: '', warehouseType: 'fbs', isRecommended: false,
    phone: '', countryCode: 'CN', city: '', street: '', zipCode: '', building: '', block: '',
    latitude: '', longitude: '',
    minWorkingDays: '5',
    workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    workingHourFrom: '09:00', workingHourTo: '18:00', holidays: [],
    returnPolicy: 'send_back', returnCarrier: 'IML',
    returnAddressSameAsWarehouse: true, returnPhoneSameAsWarehouse: true,
    returnRecipient: '', returnMethod: 'COURIER', returnZipCode: '',
    firstMileType: 'DROP_OFF', dropOffPointId: '', cutInTime: '0', timeslotId: '0', returnPointId: '',
    isKgt: false, optComment: '', optCourierPhones: '', optAutoAssembly: true, optWaybillEnabled: true,
    deliveryMethodJson: '',
  };
  const opts = t.warehouseOptions || {};
  return {
    name: t.name, warehouseType: t.warehouseType || 'fbs', isRecommended: t.isRecommended,
    phone: t.phone, countryCode: t.countryCode || 'CN',
    city: t.city || '', street: t.street || '', zipCode: t.zipCode || '',
    building: t.building || '', block: t.block || '',
    latitude: t.latitude != null ? String(t.latitude) : '',
    longitude: t.longitude != null ? String(t.longitude) : '',
    minWorkingDays: String(t.minWorkingDays || 5),
    workingDays: t.workingDays || ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    workingHourFrom: t.workingHourFrom || '09:00',
    workingHourTo: t.workingHourTo || '18:00',
    holidays: (t.holidays || []).map((h) => ({ day: h.day, isWorking: h.isWorking })),
    returnPolicy: t.returnPolicy || 'send_back',
    returnCarrier: t.returnCarrier || 'IML',
    returnAddressSameAsWarehouse: t.returnAddressSameAsWarehouse ?? true,
    returnPhoneSameAsWarehouse: t.returnPhoneSameAsWarehouse ?? true,
    returnRecipient: t.returnRecipient || '',
    returnMethod: t.returnMethod || 'COURIER',
    returnZipCode: t.returnZipCode || '',
    firstMileType: t.firstMileType || 'DROP_OFF',
    dropOffPointId: t.dropOffPointId || '',
    cutInTime: String(t.cutInTime ?? 0),
    timeslotId: String(t.timeslotId ?? 0),
    returnPointId: t.returnPointId || '',
    isKgt: t.isKgt || false,
    optComment: opts.comment || '',
    optCourierPhones: (opts.courier_phones || []).join(', '),
    optAutoAssembly: opts.is_auto_assembly ?? true,
    optWaybillEnabled: opts.is_waybill_enabled ?? true,
    deliveryMethodJson: t.deliveryMethodPayload ? JSON.stringify(t.deliveryMethodPayload, null, 2) : '',
  };
}

const STEPS = [
  { key: 1, label: '仓库信息' },
  { key: 2, label: '仓库参数' },
  { key: 3, label: '退货' },
];

// __CONTINUE_HERE__

function TemplateDialog({ template, onClose, onSuccess }: { template: WarehouseTemplate | null; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<FormState>(getInitialForm(template));
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [shopId, setShopId] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    // 找一个可用的 OZON 店铺，用于后续调 drop-off / return-point 搜索接口
    api.get<any[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) {
        const shops = Array.isArray(res.data) ? res.data : (res.data as any).rows || [];
        const ozonShop = shops.find((s: any) => s.platform === 'OZON' && s.status === 'ACTIVE');
        if (ozonShop) setShopId(ozonShop.id);
      }
    });
  }, []);

  function toggleDay(day: string) {
    set({ workingDays: form.workingDays.includes(day) ? form.workingDays.filter((d) => d !== day) : [...form.workingDays, day] });
  }

  async function handleSubmit() {
    let deliveryMethodPayload: any = undefined;
    if (form.deliveryMethodJson.trim()) {
      try { deliveryMethodPayload = JSON.parse(form.deliveryMethodJson); }
      catch { toast({ title: '物流方式 JSON 格式错误', variant: 'destructive' }); return; }
    }
    const body = {
      name: form.name,
      warehouseType: form.warehouseType,
      isRecommended: form.isRecommended,
      phone: form.phone,
      countryCode: form.countryCode,
      city: form.city || undefined,
      street: form.street || undefined,
      zipCode: form.zipCode || undefined,
      building: form.building || undefined,
      block: form.block || undefined,
      latitude: parseFloat(form.latitude) || undefined,
      longitude: parseFloat(form.longitude) || undefined,
      minWorkingDays: parseInt(form.minWorkingDays) || 5,
      workingDays: form.workingDays,
      workingHourFrom: form.workingHourFrom,
      workingHourTo: form.workingHourTo,
      holidays: form.holidays,
      returnPolicy: form.returnPolicy,
      returnCarrier: form.returnCarrier || undefined,
      returnAddressSameAsWarehouse: form.returnAddressSameAsWarehouse,
      returnPhoneSameAsWarehouse: form.returnPhoneSameAsWarehouse,
      returnRecipient: form.returnRecipient || undefined,
      returnMethod: form.returnMethod || undefined,
      returnZipCode: form.returnZipCode || undefined,
      firstMileType: form.firstMileType,
      dropOffPointId: form.dropOffPointId || undefined,
      cutInTime: parseInt(form.cutInTime) || 0,
      timeslotId: parseInt(form.timeslotId) || 0,
      returnPointId: form.returnPointId || undefined,
      isKgt: form.isKgt,
      warehouseOptions: {
        comment: form.optComment || undefined,
        courier_phones: form.optCourierPhones ? form.optCourierPhones.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        is_auto_assembly: form.optAutoAssembly,
        is_waybill_enabled: form.optWaybillEnabled,
      },
      deliveryMethodPayload,
    };
    setSubmitting(true);
    const res = template
      ? await api.put(`/api/admin/warehouse/templates/${template.id}`, body)
      : await api.post('/api/admin/warehouse/templates', body);
    setSubmitting(false);
    if (res.code === 1) { toast({ title: template ? '已更新' : '已创建' }); onSuccess(); }
    else toast({ title: res.msg || '保存失败', variant: 'destructive' });
  }

  function next() {
    // 步骤校验
    if (step === 1) {
      if (!form.name || !form.phone || !form.city || !form.street || !form.zipCode) {
        toast({ title: '请填写仓库名称、电话和地址', variant: 'destructive' }); return;
      }
    }
    setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s));
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? '编辑 Ozon 仓库物流模板' : '新增 Ozon 仓库物流模板'}</DialogTitle>
        </DialogHeader>

        {/* Stepper 头 */}
        <div className="flex items-center gap-2 py-2">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md ${step === s.key ? 'bg-foreground text-background' : step > s.key ? 'text-muted-foreground' : 'bg-muted'}`}>
                {step > s.key ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs font-mono">{s.key}</span>}
                <span className="text-sm">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* 模板基础（每步都需要） */}
        <div className="grid grid-cols-2 gap-3 pb-3 border-b">
          <div className="space-y-1.5">
            <Label>模板名称 *</Label>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="如：标准跨境rFBS仓库" />
          </div>
          <div className="space-y-1.5">
            <Label>仓库类型</Label>
            <select className="w-full h-9 rounded-md border px-3 text-sm" value={form.warehouseType} onChange={(e) => set({ warehouseType: e.target.value })}>
              <option value="fbs">rFBS（自送/第三方快递）</option>
              <option value="aggregator">Ozon Partners（送到代收点）</option>
            </select>
          </div>
        </div>

        {step === 1 && <Step1WarehouseInfo form={form} set={set} shopId={shopId} />}
        {step === 2 && <Step2Params form={form} set={set} toggleDay={toggleDay} />}
        {step === 3 && <Step3Returns form={form} set={set} shopId={shopId} />}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          {step > 1 && <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}><ChevronLeft className="h-4 w-4 mr-1" />上一步</Button>}
          {step < 3 && <Button onClick={next}>下一步<ChevronRight className="h-4 w-4 ml-1" /></Button>}
          {step === 3 && (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存模板'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// __STEP1__

function Step1WarehouseInfo({ form, set, shopId }: { form: FormState; set: (p: Partial<FormState>) => void; shopId: string | null }) {
  const [searching, setSearching] = useState(false);
  const [points, setPoints] = useState<any[]>([]);

  async function searchByAddress() {
    if (!shopId) {
      toast({ title: '需要至少一个已连接的 OZON 店铺才能搜索代收点', variant: 'destructive' });
      return;
    }
    const fullAddr = [form.city, form.street, form.building].filter(Boolean).join(' ');
    if (!fullAddr) { toast({ title: '请先填写城市和街道' }); return; }
    setSearching(true);
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    const res = await api.post<any[]>(`/api/shops/${shopId}/drop-off-points/search`, {
      address: fullAddr,
      ...(Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)
        ? { coordinates: { latitude, longitude } }
        : {}),
      types: ['PPZ'],
    });
    setSearching(false);
    if (res.code === 1 && res.data) {
      setPoints(res.data);
      if (res.data.length === 0) toast({ title: '未找到匹配的代收点，请检查地址' });
    } else {
      toast({ title: res.msg || '搜索失败', variant: 'destructive' });
    }
  }

  function selectPoint(p: any) {
    const coords = p.coordinates || {};
    set({
      latitude: String(coords.latitude || ''),
      longitude: String(coords.longitude || ''),
      dropOffPointId: String(p.id || ''),
    });
    if (p.address_details) {
      const ad = p.address_details;
      set({
        city: ad.city || form.city,
        street: ad.street || form.street,
        zipCode: ad.zip_code || form.zipCode,
      });
    }
    toast({ title: '已匹配代收点', description: p.name || p.address });
  }

  return (
    <div className="space-y-5 py-3">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">联系方式</legend>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label>联系电话 *</Label>
            <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+86 183 3039 9396" />
          </div>
          <div className="space-y-1.5">
            <Label>国家</Label>
            <select className="w-full h-9 rounded-md border px-3 text-sm" value={form.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-semibold">地址</legend>
          <Button size="sm" variant="outline" onClick={searchByAddress} disabled={searching || !shopId}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            按地址搜索 OZON 代收点
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>城市 *</Label>
            <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="如：Xiamen" />
          </div>
          <div className="space-y-1.5">
            <Label>邮政编码 *</Label>
            <Input value={form.zipCode} onChange={(e) => set({ zipCode: e.target.value })} placeholder="如：361000" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>街道 *</Label>
          <Input value={form.street} onChange={(e) => set({ street: e.target.value })} placeholder="如：Hai cang qu, hai hong lu 86 hao" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>楼号</Label>
            <Input value={form.building} onChange={(e) => set({ building: e.target.value })} placeholder="如：1430" />
          </div>
          <div className="space-y-1.5">
            <Label>栋号（非必须）</Label>
            <Input value={form.block} onChange={(e) => set({ block: e.target.value })} />
          </div>
        </div>

        {points.length > 0 && (
          <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
            <div className="px-3 py-2 text-xs font-medium bg-muted/50 sticky top-0">匹配到 {points.length} 个代收点，点击选择</div>
            {points.slice(0, 20).map((p, i) => (
              <div key={i} className={`px-3 py-2 text-xs cursor-pointer hover:bg-muted/30 ${form.dropOffPointId === String(p.id) ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`} onClick={() => selectPoint(p)}>
                <div className="font-medium">{p.name || `代收点 #${p.id}`}</div>
                <div className="text-muted-foreground">{p.address || '-'}</div>
                {p.coordinates && <div className="text-muted-foreground">坐标: {p.coordinates.latitude?.toFixed(4)}, {p.coordinates.longitude?.toFixed(4)}</div>}
              </div>
            ))}
          </div>
        )}

        {(form.latitude || form.longitude) && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
            已定位坐标: ({form.latitude}, {form.longitude})
            {form.dropOffPointId && ` · 代收点 ID: ${form.dropOffPointId}`}
          </div>
        )}
      </fieldset>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.isRecommended} onChange={(e) => set({ isRecommended: e.target.checked })} className="h-4 w-4 rounded" />
        <span className="text-sm">设为推荐模板</span>
      </label>
    </div>
  );
}

// __STEP2__

function Step2Params({ form, set, toggleDay }: { form: FormState; set: (p: Partial<FormState>) => void; toggleDay: (d: string) => void }) {
  function toggleHoliday(day: string, isWorking: boolean) {
    const existing = form.holidays.find((h) => h.day === day);
    if (existing) {
      set({ holidays: form.holidays.map((h) => h.day === day ? { ...h, isWorking } : h) });
    } else {
      set({ holidays: [...form.holidays, { day, isWorking }] });
    }
  }
  function removeHoliday(day: string) {
    set({ holidays: form.holidays.filter((h) => h.day !== day) });
  }
  function addHolidayRow() {
    const today = new Date().toISOString().slice(0, 10);
    if (form.holidays.some((h) => h.day === today)) return;
    set({ holidays: [...form.holidays, { day: today, isWorking: false }] });
  }

  return (
    <div className="space-y-5 py-3">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">订单准备时间</legend>
        <p className="text-xs text-muted-foreground">完成订单备货并送至接收点所需的时间。买家更愿意选不需要等太长时间的商品。</p>
        <div className="space-y-1.5 max-w-xs">
          <Label>备货时间</Label>
          <select className="w-full h-9 rounded-md border px-3 text-sm" value={form.minWorkingDays} onChange={(e) => set({ minWorkingDays: e.target.value })}>
            {PREP_DAYS.map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">工作日</legend>
        <div className="flex flex-wrap gap-2">
          {ALL_DAYS.map((day) => {
            const checked = form.workingDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`text-xs px-3 py-1.5 rounded-md border ${checked ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-input hover:bg-muted'}`}
              >
                {DAY_LABELS[day]}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label>开始时间</Label>
            <Input type="time" value={form.workingHourFrom} onChange={(e) => set({ workingHourFrom: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>结束时间</Label>
            <Input type="time" value={form.workingHourTo} onChange={(e) => set({ workingHourTo: e.target.value })} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-semibold">节假日工作时间表</legend>
          <Button size="sm" variant="outline" onClick={addHolidayRow}><Plus className="h-3 w-3 mr-1" />添加日期</Button>
        </div>
        <p className="text-xs text-muted-foreground">为特定日期单独标记工作日 / 非工作日（覆盖默认工作日规则）。</p>
        {form.holidays.length === 0 ? (
          <div className="text-xs text-muted-foreground border rounded p-3 text-center">暂无节假日设置（按默认工作日规则计算）</div>
        ) : (
          <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
            {form.holidays.map((h) => (
              <div key={h.day} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Input type="date" value={h.day} onChange={(e) => {
                  set({ holidays: form.holidays.map((x) => x.day === h.day ? { ...x, day: e.target.value } : x) });
                }} className="w-40" />
                <select className="h-8 rounded-md border px-2 text-xs" value={h.isWorking ? '1' : '0'} onChange={(e) => toggleHoliday(h.day, e.target.value === '1')}>
                  <option value="1">工作日</option>
                  <option value="0">非工作日</option>
                </select>
                <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto" onClick={() => removeHoliday(h.day)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      {form.warehouseType === 'aggregator' && (
        <fieldset className="space-y-3 border rounded-lg p-4">
          <legend className="text-sm font-semibold px-2">Ozon Partners 配置</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>首公里类型</Label>
              <select className="w-full h-9 rounded-md border px-3 text-sm" value={form.firstMileType} onChange={(e) => set({ firstMileType: e.target.value })}>
                <option value="DROP_OFF">DROP_OFF（自送到代收点）</option>
                <option value="PICK_UP">PICK_UP（上门取件）</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>cut_in_time（截单偏移分钟）</Label>
              <Input type="number" value={form.cutInTime} onChange={(e) => set({ cutInTime: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>timeslot_id</Label>
              <Input type="number" value={form.timeslotId} onChange={(e) => set({ timeslotId: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>return_point_id</Label>
              <Input value={form.returnPointId} onChange={(e) => set({ returnPointId: e.target.value })} placeholder="可选" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isKgt} onChange={(e) => set({ isKgt: e.target.checked })} className="h-4 w-4 rounded" />
            <span className="text-sm">大件商品 (KGT)</span>
          </label>
        </fieldset>
      )}

      <fieldset className="space-y-3 border rounded-lg p-4">
        <legend className="text-sm font-semibold px-2">仓库选项 (options)</legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>备注 (comment)</Label>
            <Input value={form.optComment} onChange={(e) => set({ optComment: e.target.value })} placeholder="可选" />
          </div>
          <div className="space-y-1.5">
            <Label>快递员电话（逗号分隔）</Label>
            <Input value={form.optCourierPhones} onChange={(e) => set({ optCourierPhones: e.target.value })} placeholder="+7(999)..." />
          </div>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.optAutoAssembly} onChange={(e) => set({ optAutoAssembly: e.target.checked })} className="h-4 w-4 rounded" />
            <span className="text-sm">自动组装 (is_auto_assembly)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.optWaybillEnabled} onChange={(e) => set({ optWaybillEnabled: e.target.checked })} className="h-4 w-4 rounded" />
            <span className="text-sm">运单启用 (is_waybill_enabled)</span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}

// __STEP3__

function Step3Returns({ form, set, shopId }: { form: FormState; set: (p: Partial<FormState>) => void; shopId: string | null }) {
  const [searching, setSearching] = useState(false);
  const [returnPoints, setReturnPoints] = useState<any[]>([]);

  async function searchReturnPoints() {
    if (!shopId) { toast({ title: '需要已连接的 OZON 店铺', variant: 'destructive' }); return; }
    setSearching(true);
    const res = await api.post<any[]>(`/api/shops/${shopId}/return-points/search`, {
      address: form.city || '',
      countryCode: form.countryCode,
      types: ['PVZ'],
      limit: 50,
    });
    setSearching(false);
    if (res.code === 1 && res.data) setReturnPoints(res.data);
  }

  return (
    <div className="space-y-5 py-3">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">退货至 OZON 取货点</legend>
        <p className="text-xs text-muted-foreground">对于买家送至 OZON 取货点的退货，将进行销毁处理或委托合作方寄送回您的仓库。</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => set({ returnPolicy: 'destroy' })}
            className={`text-left border rounded-lg p-4 ${form.returnPolicy === 'destroy' ? 'border-blue-500 bg-blue-50/50' : 'border-input hover:bg-muted/30'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">销毁</span>
              <Badge variant="secondary" className="text-xs">免费</Badge>
            </div>
            <p className="text-xs text-muted-foreground">当场销毁商品 — 节省逆向物流费</p>
          </button>
          <button
            type="button"
            onClick={() => set({ returnPolicy: 'send_back' })}
            className={`text-left border rounded-lg p-4 ${form.returnPolicy === 'send_back' ? 'border-blue-500 bg-blue-50/50' : 'border-input hover:bg-muted/30'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">将其发回</span>
            </div>
            <p className="text-xs text-muted-foreground">OZON 合作伙伴从取货点取货，并将其运送至您的仓库</p>
          </button>
        </div>

        {form.returnPolicy === 'send_back' && (
          <div className="space-y-3 border-l-2 border-blue-200 pl-4 mt-3">
            <div className="space-y-1.5">
              <Label>退货承运商</Label>
              <select className="w-full h-9 rounded-md border px-3 text-sm" value={form.returnCarrier} onChange={(e) => set({ returnCarrier: e.target.value })}>
                {RETURN_CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">请前往承运商官网完成注册以便接收退货</p>
            </div>
            <div className="space-y-1.5">
              <Label>退货方式</Label>
              <select className="w-full h-9 rounded-md border px-3 text-sm" value={form.returnMethod} onChange={(e) => set({ returnMethod: e.target.value })}>
                <option value="COURIER">COURIER（快递上门）</option>
                <option value="POST">POST（邮政邮寄）</option>
              </select>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">与买家协议退货</legend>
        <p className="text-xs text-muted-foreground">协商退货过程中，买家通过邮政或第三方物流将商品寄往您的仓库。审核通过后，系统将向买家发送含您地址和电话的寄送说明。</p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">退货仓库地址</Label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.returnAddressSameAsWarehouse} onChange={(e) => set({ returnAddressSameAsWarehouse: e.target.checked })} className="h-4 w-4 rounded" />
              <span>与您的仓库地址一致</span>
            </label>
          </div>
          {form.returnAddressSameAsWarehouse ? (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
              {[form.zipCode, form.countryCode, form.city, form.street, form.building].filter(Boolean).join(', ') || '（请回到第一步填写仓库地址）'}
            </div>
          ) : (
            <Input value={form.returnZipCode} onChange={(e) => set({ returnZipCode: e.target.value })} placeholder="退货邮政编码" />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">用于接收退货的仓库联系电话</Label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.returnPhoneSameAsWarehouse} onChange={(e) => set({ returnPhoneSameAsWarehouse: e.target.checked })} className="h-4 w-4 rounded" />
              <span>与仓库电话号码相符</span>
            </label>
          </div>
          {form.returnPhoneSameAsWarehouse && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">{form.phone || '（未填写仓库电话）'}</div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>退货收件人（公司名或姓名）</Label>
          <Input value={form.returnRecipient} onChange={(e) => set({ returnRecipient: e.target.value })} placeholder="如：李勃帆" />
          <p className="text-xs text-muted-foreground">用户应用此模板时可覆盖填写自己的收件人</p>
        </div>
      </fieldset>

      {shopId && (
        <fieldset className="space-y-2">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-semibold">参考：OZON 退货点列表</legend>
            <Button size="sm" variant="outline" onClick={searchReturnPoints} disabled={searching}>
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              搜索退货点
            </Button>
          </div>
          {returnPoints.length > 0 && (
            <div className="border rounded-md max-h-32 overflow-y-auto divide-y">
              {returnPoints.slice(0, 20).map((p, i) => (
                <div key={i} className="px-3 py-2 text-xs">
                  <div className="font-medium">{p.name || `#${p.id}`} <span className="text-muted-foreground ml-2">{p.carrier || ''}</span></div>
                  <div className="text-muted-foreground">{p.address}</div>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
