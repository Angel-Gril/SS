'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Eye, Image as ImageIcon, Palette, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface WatermarkTemplate {
  id: string;
  name: string;
  type: 'text' | 'image';
  text: string | null;
  imageUrl: string | null;
  position: string;
  opacity: number;
  fontSize: number | null;
  fontColor: string | null;
  scale: number | null;
  isDefault: boolean;
  shopId: string | null;
  createdAt: string;
}

const POSITION_OPTIONS = [
  { value: 'bottom-right', label: '右下角' },
  { value: 'bottom-left', label: '左下角' },
  { value: 'top-right', label: '右上角' },
  { value: 'top-left', label: '左上角' },
  { value: 'center', label: '居中' },
  { value: 'tile', label: '平铺' },
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

type Tab = 'watermark' | 'resize';

export default function ImageProcessingPage() {
  const [activeTab, setActiveTab] = useState<Tab>('watermark');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ImageIcon className="h-6 w-6" /> 图片处理
        </h1>
        <p className="text-sm text-muted-foreground mt-1">水印添加、批量改分辨率等图片处理功能</p>
      </div>

      <div className="border-b flex gap-1">
        <button
          onClick={() => setActiveTab('watermark')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === 'watermark' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Palette className="h-4 w-4 inline mr-1" /> 水印模板
        </button>
        <button
          onClick={() => setActiveTab('resize')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === 'resize' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Maximize2 className="h-4 w-4 inline mr-1" /> 批量改分辨率
        </button>
      </div>

      {activeTab === 'watermark' ? <WatermarkPanel /> : <ResizePanel />}
    </div>
  );
}

function WatermarkPanel() {
  const [templates, setTemplates] = useState<WatermarkTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<WatermarkTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSourceUrl, setPreviewSourceUrl] = useState('');

  const [form, setForm] = useState({
    name: '',
    type: 'text' as 'text' | 'image',
    text: '',
    imageUrl: '',
    position: 'bottom-right',
    opacity: 50,
    fontSize: 24,
    fontColor: '#ffffff',
    scale: 25,
    isDefault: false,
    shopId: '',
  });

  useEffect(() => { fetchTemplates(); }, []);

  async function fetchTemplates() {
    setLoading(true);
    const res = await api.get<WatermarkTemplate[]>('/api/watermark-templates');
    if (res.code === 1 && res.data) setTemplates(res.data);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', type: 'text', text: '', imageUrl: '', position: 'bottom-right', opacity: 50, fontSize: 24, fontColor: '#ffffff', scale: 25, isDefault: false, shopId: '' });
    setPreviewUrl(null);
    setShowDialog(true);
  }

  function openEdit(t: WatermarkTemplate) {
    setEditing(t);
    setForm({
      name: t.name,
      type: t.type,
      text: t.text || '',
      imageUrl: t.imageUrl || '',
      position: t.position,
      opacity: t.opacity,
      fontSize: t.fontSize || 24,
      fontColor: t.fontColor || '#ffffff',
      scale: t.scale || 25,
      isDefault: t.isDefault,
      shopId: t.shopId || '',
    });
    setPreviewUrl(null);
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast({ title: '请输入模板名称', variant: 'destructive' }); return; }
    if (form.type === 'text' && !form.text.trim()) { toast({ title: '请输入水印文字', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = { ...form, shopId: form.shopId || null };
    const res = editing
      ? await api.put(`/api/watermark-templates/${editing.id}`, payload)
      : await api.post('/api/watermark-templates', payload);
    setSaving(false);
    if (res.code === 1) {
      toast({ title: editing ? '更新成功' : '创建成功' });
      setShowDialog(false);
      fetchTemplates();
    } else {
      toast({ title: '保存失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此模板？')) return;
    const res = await api.delete(`/api/watermark-templates/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); fetchTemplates(); }
  }

  async function handlePreview() {
    if (!previewSourceUrl.trim()) { toast({ title: '请输入预览图片URL', variant: 'destructive' }); return; }
    setPreviewLoading(true);
    const config = {
      type: form.type,
      text: form.text || undefined,
      imageUrl: form.imageUrl || undefined,
      position: form.position,
      opacity: form.opacity,
      fontSize: form.fontSize,
    };
    const res = await api.post<{ previewUrl: string }>('/api/images/preview-watermark', { url: previewSourceUrl, config });
    setPreviewLoading(false);
    if (res.code === 1 && res.data) {
      setPreviewUrl(`${API_BASE}${res.data.previewUrl}`);
    } else {
      toast({ title: '预览失败', description: res.msg, variant: 'destructive' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> 新建模板</Button>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Palette className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>暂无水印模板，点击右上角新建</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <Card key={t.id} className="relative">
              {t.isDefault && <Badge className="absolute top-2 right-2" variant="default">默认</Badge>}
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="secondary">{t.type === 'text' ? '文字' : '图片'}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>位置: {POSITION_OPTIONS.find((p) => p.value === t.position)?.label || t.position}</p>
                  <p>透明度: {t.opacity}%</p>
                  {t.type === 'text' && <p>文字: {t.text}</p>}
                  {t.fontSize && <p>字号: {t.fontSize}px</p>}
                  {t.shopId && <p>绑定店铺: {t.shopId}</p>}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(t)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> 编辑
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> 删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑水印模板' : '新建水印模板'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div>
                <Label>模板名称</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：店铺A水印" />
              </div>
              <div>
                <Label>水印类型</Label>
                <div className="flex gap-2 mt-1">
                  <Button size="sm" variant={form.type === 'text' ? 'default' : 'outline'} onClick={() => setForm({ ...form, type: 'text' })}>文字水印</Button>
                  <Button size="sm" variant={form.type === 'image' ? 'default' : 'outline'} onClick={() => setForm({ ...form, type: 'image' })}>图片水印</Button>
                </div>
              </div>
              {form.type === 'text' ? (
                <>
                  <div>
                    <Label>水印文字</Label>
                    <Input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="如：店铺名称" />
                  </div>
                  <div>
                    <Label>字号 ({form.fontSize}px)</Label>
                    <input type="range" min={12} max={120} value={form.fontSize} onChange={(e) => setForm({ ...form, fontSize: Number(e.target.value) })} className="w-full" />
                  </div>
                  <div>
                    <Label>字体颜色</Label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={form.fontColor} onChange={(e) => setForm({ ...form, fontColor: e.target.value })} className="h-8 w-12 rounded border" />
                      <Input value={form.fontColor} onChange={(e) => setForm({ ...form, fontColor: e.target.value })} className="flex-1" />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label>水印图片URL</Label>
                    <Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
                  </div>
                  <div>
                    <Label>缩放比例 ({form.scale}%)</Label>
                    <input type="range" min={5} max={80} value={form.scale} onChange={(e) => setForm({ ...form, scale: Number(e.target.value) })} className="w-full" />
                  </div>
                </>
              )}
              <div>
                <Label>位置</Label>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  {POSITION_OPTIONS.map((p) => (
                    <button key={p.value} onClick={() => setForm({ ...form, position: p.value })} className={`text-xs py-1.5 px-2 rounded border transition-colors ${form.position === p.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>透明度 ({form.opacity}%)</Label>
                <input type="range" min={5} max={100} value={form.opacity} onChange={(e) => setForm({ ...form, opacity: Number(e.target.value) })} className="w-full" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                <Label htmlFor="isDefault">设为默认模板</Label>
              </div>
              <div>
                <Label>绑定店铺ID（可选）</Label>
                <Input value={form.shopId} onChange={(e) => setForm({ ...form, shopId: e.target.value })} placeholder="留空表示通用模板" />
              </div>
            </div>

            <div className="space-y-3">
              <Label>实时预览</Label>
              <div className="flex gap-2">
                <Input value={previewSourceUrl} onChange={(e) => setPreviewSourceUrl(e.target.value)} placeholder="输入一张图片URL来预览效果" className="flex-1" />
                <Button size="sm" onClick={handlePreview} disabled={previewLoading}>
                  {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="border rounded-md bg-muted/30 min-h-[200px] flex items-center justify-center overflow-hidden">
                {previewUrl ? (
                  <img src={previewUrl} alt="水印预览" className="max-w-full max-h-[300px] object-contain" />
                ) : (
                  <p className="text-sm text-muted-foreground">输入图片URL后点击预览</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">提示：可使用已采集商品的图片URL进行预览</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editing ? '保存修改' : '创建模板'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ResizeResult {
  source: string;
  resized?: string;
  uploaded?: string;
  error?: string;
  size?: { w: number; h: number };
}

function ResizePanel() {
  const [urlsText, setUrlsText] = useState('');
  const [width, setWidth] = useState('1200');
  const [height, setHeight] = useState('');
  const [quality, setQuality] = useState('90');
  const [uploadToCdn, setUploadToCdn] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ResizeResult[]>([]);

  async function handleResize() {
    const urls = urlsText.split(/\s+/).filter((u) => u.trim().startsWith('http'));
    if (urls.length === 0) {
      toast({ title: '请粘贴至少一个图片 URL', variant: 'destructive' });
      return;
    }
    if (!width && !height) {
      toast({ title: '请至少指定宽度或高度', variant: 'destructive' });
      return;
    }
    setProcessing(true);
    setResults([]);
    const res = await api.post<{ results: ResizeResult[] }>('/api/images/batch-resize', {
      urls,
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      quality: Number(quality) || 90,
      uploadToCdn,
    });
    setProcessing(false);
    if (res.code === 1 && res.data) {
      setResults(res.data.results);
      const successCount = res.data.results.filter((r) => !r.error).length;
      toast({ title: `已处理 ${successCount}/${res.data.results.length} 张` });
    } else {
      toast({ title: '处理失败', description: res.msg, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><span className="font-medium">批量改分辨率</span></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>图片 URL 列表（一行一个或空格分隔）</Label>
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={6}
              placeholder="https://example.com/img1.jpg&#10;https://example.com/img2.jpg"
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>宽度 (px)</Label>
              <Input type="number" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="1200" />
            </div>
            <div>
              <Label>高度 (px)</Label>
              <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="留空按比例" />
            </div>
            <div>
              <Label>JPEG 质量</Label>
              <Input type="number" min={50} max={100} value={quality} onChange={(e) => setQuality(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="uploadCdn" checked={uploadToCdn} onChange={(e) => setUploadToCdn(e.target.checked)} />
            <Label htmlFor="uploadCdn">同时上传到存储后端（OZON CDN / OSS）</Label>
          </div>

          <Button onClick={handleResize} disabled={processing}>
            {processing && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            开始处理
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader><span className="font-medium">处理结果（{results.length} 张）</span></CardHeader>
          <CardContent className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="border rounded p-2 text-xs space-y-1">
                <div className="text-muted-foreground truncate">源: {r.source}</div>
                {r.error ? (
                  <div className="text-destructive">失败: {r.error}</div>
                ) : (
                  <>
                    {r.size && <div>尺寸: {r.size.w}×{r.size.h}</div>}
                    {r.resized && (
                      <div className="flex items-center gap-2">
                        <span>本地:</span>
                        <a href={`${API_BASE}${r.resized}`} target="_blank" rel="noreferrer" className="text-primary truncate">{r.resized}</a>
                      </div>
                    )}
                    {r.uploaded && (
                      <div className="flex items-center gap-2">
                        <span>CDN:</span>
                        <a href={r.uploaded} target="_blank" rel="noreferrer" className="text-primary truncate">{r.uploaded}</a>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
