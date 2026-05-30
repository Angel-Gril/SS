'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Save, ArrowLeft, ImageIcon, Trash2, Plus, Palette, RefreshCw, Upload, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api, apiUrl } from '@/lib/api';
import { getOzonAttrName } from '@/lib/ozon-attr-names';

interface ProductDetail {
  id: string;
  title: string;
  sku: string | null;
  offerId: string | null;
  platformProductId: string | null;
  description: string | null;
  price: string | null;
  oldPrice: string | null;
  currency: string;
  stock: number;
  images: string[] | null;
  attributes: any[] | null;
  status: string | null;
  visibility: string | null;
  shopName: string;
  shopId?: string;
  platform: string;
  updatedAt: string;
}

interface WatermarkTemplate {
  id: string;
  name: string;
  type: string;
  text: string | null;
  imageUrl: string | null;
  position: string;
  opacity: number;
  fontSize: number | null;
  fontColor: string | null;
  scale: number | null;
  isDefault: boolean;
}

type TabKey = 'basic' | 'attributes' | 'description' | 'media';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: '基本设置' },
  { key: 'attributes', label: '产品属性' },
  { key: 'description', label: '描述信息' },
  { key: 'media', label: '多媒体' },
];

export default function ProductEditPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [outdated, setOutdated] = useState(false);
  const [ozonUpdatedAt, setOzonUpdatedAt] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [editAttributes, setEditAttributes] = useState<{ id: number; name?: string; values: { value: string }[] }[]>([]);

  const [showWmDialog, setShowWmDialog] = useState(false);
  const [wmTemplates, setWmTemplates] = useState<WatermarkTemplate[]>([]);
  const [wmProcessing, setWmProcessing] = useState(false);
  const [wmSelectedTemplate, setWmSelectedTemplate] = useState('');

  useEffect(() => { fetchProduct(); loadWmTemplates(); }, [productId]);

  useEffect(() => {
    if (product && (!editAttributes || editAttributes.length === 0) && product.platformProductId && !refreshing) {
      refreshFromOzon(true);
    }
  }, [product?.id]);

  async function fetchProduct() {
    setLoading(true);
    const res = await api.get<ProductDetail>(`/api/products/${productId}/detail`);
    if (res.code === 1 && res.data) {
      setProduct(res.data);
      setEditTitle(res.data.title || '');
      setEditDescription(res.data.description || '');
      setEditImages(Array.isArray(res.data.images) ? res.data.images : []);
      setEditAttributes(Array.isArray(res.data.attributes) ? res.data.attributes : []);
    } else {
      toast({ title: '加载失败', description: res.msg, variant: 'destructive' });
    }
    setLoading(false);
  }

  async function loadWmTemplates() {
    const res = await api.get<WatermarkTemplate[]>('/api/watermark-templates');
    if (res.code === 1 && res.data) setWmTemplates(res.data);
  }

  async function refreshFromOzon(silent = false) {
    if (!product?.platformProductId) return;
    setRefreshing(true);
    const res = await api.post<{
      attributes: any[];
      images: string[];
      title?: string;
      description?: string;
      ozonUpdatedAt?: string;
    }>(`/api/products/${productId}/refresh-attributes`);
    setRefreshing(false);

    if (res.code === 1 && res.data) {
      setEditAttributes(Array.isArray(res.data.attributes) ? res.data.attributes : []);
      if (Array.isArray(res.data.images) && res.data.images.length) {
        setEditImages(res.data.images);
      }
      if (res.data.title) setEditTitle(res.data.title);
      if (res.data.description) setEditDescription(res.data.description);
      if (res.data.ozonUpdatedAt) {
        setOzonUpdatedAt(res.data.ozonUpdatedAt);
        const localTime = product?.updatedAt ? new Date(product.updatedAt).getTime() : 0;
        const ozonTime = new Date(res.data.ozonUpdatedAt).getTime();
        setOutdated(ozonTime > localTime + 60_000);
      }
      if (!silent) toast({ title: '已从 OZON 拉取最新数据' });
      setOutdated(false);
    } else if (!silent) {
      toast({ title: '刷新失败', description: res.msg, variant: 'destructive' });
    }
  }

  function addImage() {
    if (!newImageUrl.trim()) return;
    setEditImages([...editImages, newImageUrl.trim()]);
    setNewImageUrl('');
  }

  function removeImage(index: number) {
    setEditImages(editImages.filter((_, i) => i !== index));
  }

  function moveImage(index: number, direction: -1 | 1) {
    const newArr = [...editImages];
    const target = index + direction;
    if (target < 0 || target >= newArr.length) return;
    [newArr[index], newArr[target]] = [newArr[target]!, newArr[index]!];
    setEditImages(newArr);
  }

  async function handleLocalFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        toast({ title: `${file.name} 超过 20MB`, variant: 'destructive' });
        continue;
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.post<{ url: string }>(`/api/products/upload-file`, {
        file: base64,
        filename: file.name,
        shopId: product?.shopId,
      });
      if (res.code === 1 && res.data?.url) {
        uploaded.push(res.data.url);
      } else {
        toast({ title: `${file.name} 上传失败`, description: res.msg, variant: 'destructive' });
      }
    }
    setUploading(false);
    if (uploaded.length) {
      setEditImages([...editImages, ...uploaded]);
      toast({ title: `已上传 ${uploaded.length} 张图片` });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSave() {
    setSaving(true);
    const promises: Promise<any>[] = [];

    if (activeTab === 'basic' || activeTab === 'description') {
      promises.push(api.put(`/api/products/${productId}/attributes`, {
        title: editTitle,
        description: editDescription,
      }));
    }
    if (activeTab === 'attributes' && editAttributes.length) {
      promises.push(api.put(`/api/products/${productId}/attributes`, { attributes: editAttributes }));
    }
    if (activeTab === 'media') {
      promises.push(api.post(`/api/products/${productId}/images`, { images: editImages }));
    }

    const results = await Promise.all(promises);
    setSaving(false);
    const failed = results.find((r) => r.code !== 1);
    if (failed) {
      toast({ title: '保存失败', description: failed.msg, variant: 'destructive' });
    } else {
      toast({ title: '已保存' });
      fetchProduct();
    }
  }

  async function handleWatermarkReplace() {
    const tpl = wmTemplates.find((t) => t.id === wmSelectedTemplate);
    if (!tpl && !wmSelectedTemplate) {
      toast({ title: '请选择水印模板', variant: 'destructive' });
      return;
    }
    const config = tpl
      ? {
          type: tpl.type,
          text: tpl.text,
          imageUrl: tpl.imageUrl,
          position: tpl.position,
          opacity: tpl.opacity,
          fontSize: tpl.fontSize,
          fontColor: tpl.fontColor,
          scale: tpl.scale,
        }
      : { type: 'text' as const, text: 'SS ERP', position: 'bottom-right', opacity: 50 };

    setWmProcessing(true);
    const res = await api.post(`/api/products/${productId}/watermark-and-replace`, { config });
    setWmProcessing(false);
    if (res.code === 1) {
      toast({ title: '水印替换已提交' });
      setShowWmDialog(false);
      fetchProduct();
    } else {
      toast({ title: '处理失败', description: res.msg, variant: 'destructive' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>商品不存在或无权访问</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>返回</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── 页面头部：统一风格 ─── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight truncate max-w-lg">{product.title}</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-10">
            <Badge variant="secondary" className="mr-2">{product.platform}</Badge>
            SKU: {product.sku || '—'} / Offer: {product.offerId || '—'}
            {product.status && <Badge variant="outline" className="ml-2">{product.status}</Badge>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refreshFromOzon(false)} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            从 OZON 刷新
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </Button>
        </div>
      </div>

      {/* ─── 版本检测横幅 ─── */}
      {outdated && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">此商品可能不是最新版本</p>
            <p className="text-amber-700 dark:text-amber-300/80 text-xs mt-0.5">
              OZON 端更新于 {ozonUpdatedAt ? new Date(ozonUpdatedAt).toLocaleString('zh-CN') : '—'}，本地同步于 {new Date(product.updatedAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refreshFromOzon(false)} disabled={refreshing}>
            立即同步
          </Button>
        </div>
      )}

      {/* ─── Tab 切换：Button variant 风格 ─── */}
      <div className="flex items-center gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={activeTab === t.key ? 'default' : 'outline'}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* ─── 基本设置 ─── */}
      {activeTab === 'basic' && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <Label className="text-sm">商品标题</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><Label className="text-muted-foreground text-xs">价格</Label><p className="mt-1 font-medium">{product.price} {product.currency}</p></div>
              <div><Label className="text-muted-foreground text-xs">原价</Label><p className="mt-1">{product.oldPrice || '—'}</p></div>
              <div><Label className="text-muted-foreground text-xs">库存</Label><p className="mt-1">{product.stock}</p></div>
              <div><Label className="text-muted-foreground text-xs">店铺</Label><p className="mt-1">{product.shopName}</p></div>
              <div><Label className="text-muted-foreground text-xs">Product ID</Label><p className="mt-1 font-mono text-xs">{product.platformProductId || '—'}</p></div>
              <div><Label className="text-muted-foreground text-xs">可见性</Label><p className="mt-1">{product.visibility || '—'}</p></div>
              <div className="col-span-2"><Label className="text-muted-foreground text-xs">最近同步</Label><p className="mt-1 text-xs">{new Date(product.updatedAt).toLocaleString('zh-CN')}</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── 产品属性 ─── */}
      {activeTab === 'attributes' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">商品属性</span>
              <Badge variant="secondary">{editAttributes.length} 项</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {refreshing && editAttributes.length === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> 正在从 OZON 拉取属性...
              </div>
            ) : editAttributes.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center space-y-3">
                <p>暂无属性数据</p>
                <Button size="sm" variant="outline" onClick={() => refreshFromOzon(false)} disabled={refreshing}>
                  <RefreshCw className="h-3.5 w-3.5" /> 从 OZON 拉取
                </Button>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {editAttributes.map((attr, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-b-0">
                    <div className="w-40 shrink-0">
                      <span className="text-sm">{getOzonAttrName(attr)}</span>
                      <p className="text-[10px] text-muted-foreground">ID: {attr.id}</p>
                    </div>
                    <Input
                      value={attr.values?.[0]?.value || ''}
                      onChange={(e) => {
                        const newAttrs = [...editAttributes];
                        newAttrs[i] = { ...attr, values: [{ value: e.target.value }] };
                        setEditAttributes(newAttrs);
                      }}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── 描述信息 ─── */}
      {activeTab === 'description' && (
        <Card>
          <CardContent className="p-6">
            <Label className="text-sm">商品描述</Label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full min-h-[400px] mt-1.5 rounded-md border border-input bg-background p-3 text-sm font-mono"
              placeholder="商品详情描述（支持 HTML）"
            />
            <p className="text-xs text-muted-foreground mt-2">支持 HTML 标签，提交后由 OZON 渲染展示</p>
          </CardContent>
        </Card>
      )}

      {/* ─── 多媒体 ─── */}
      {activeTab === 'media' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm font-medium">图片管理</span>
                <Badge variant="secondary">{editImages.length} 张</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowWmDialog(true)}>
                <Palette className="h-3.5 w-3.5" /> 加水印
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {editImages.map((img, i) => (
                <div key={i} className="relative group border rounded-md overflow-hidden aspect-square bg-muted">
                  <img src={img.startsWith('/') ? apiUrl(img) : img} alt={`图${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    {i > 0 && (
                      <button onClick={() => moveImage(i, -1)} className="text-white bg-white/20 rounded p-1 text-xs hover:bg-white/40">前移</button>
                    )}
                    {i < editImages.length - 1 && (
                      <button onClick={() => moveImage(i, 1)} className="text-white bg-white/20 rounded p-1 text-xs hover:bg-white/40">后移</button>
                    )}
                    <button onClick={() => removeImage(i)} className="text-red-300 bg-white/20 rounded p-1 hover:bg-red-500/50">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {i === 0 && <Badge className="absolute top-1 left-1 text-[10px]">主图</Badge>}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleLocalFileUpload(e.target.files)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                本地上传
              </Button>
              <Input
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                placeholder="或输入图片 URL"
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && addImage()}
              />
              <Button size="sm" variant="outline" onClick={addImage}><Plus className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">支持多选本地文件，单张 ≤ 20MB</p>
          </CardContent>
        </Card>
      )}

      {/* ─── 水印对话框 ─── */}
      <Dialog open={showWmDialog} onOpenChange={setShowWmDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>一键加水印并替换</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">将对当前商品的所有图片添加水印，并提交到 OZON 替换原图</p>
            <div>
              <Label>选择水印模板</Label>
              <select
                value={wmSelectedTemplate}
                onChange={(e) => setWmSelectedTemplate(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1"
              >
                <option value="">— 请选择 —</option>
                {wmTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (默认)' : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWmDialog(false)}>取消</Button>
            <Button onClick={handleWatermarkReplace} disabled={wmProcessing || !wmSelectedTemplate}>
              {wmProcessing && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              开始处理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
