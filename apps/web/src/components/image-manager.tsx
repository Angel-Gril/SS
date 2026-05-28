'use client';

import { useRef, useState } from 'react';
import { Upload, Trash2, Loader2, ImageIcon, Droplets, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

export interface ImageManagerProps {
  images: string[];
  onChange: (next: string[]) => void;
  shopId?: string;
  // 用于水印：每个 itemId 必须唯一，避免水印结果文件冲突
  itemId: string;
  // 用户的水印模板列表（可选传入），不传则不显示水印按钮
  watermarkTemplates?: Array<{ id: string; name: string; config: any }>;
  maxCount?: number;
  className?: string;
}

type WatermarkTemplate = { id: string; name: string; config: any };

export function ImageManager({
  images,
  onChange,
  shopId,
  itemId,
  watermarkTemplates,
  maxCount = 30,
  className,
}: ImageManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [watermarking, setWatermarking] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    if (images.length + arr.length > maxCount) {
      toast({ title: `最多上传 ${maxCount} 张`, variant: 'destructive' });
      return;
    }
    setUploading(true);
    const uploaded: string[] = [];
    for (const file of arr) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const res = await api.post<{ url: string; backend: string }>('/api/images/upload-base64', {
          dataUrl,
          filename: file.name,
          shopId,
        });
        if (res.code === 1 && res.data?.url) {
          uploaded.push(res.data.url);
        } else {
          toast({ title: `${file.name} 上传失败：${res.msg}`, variant: 'destructive' });
        }
      } catch (e: any) {
        toast({ title: `${file.name} 上传失败：${e.message}`, variant: 'destructive' });
      }
    }
    setUploading(false);
    if (uploaded.length) {
      onChange([...images, ...uploaded]);
      toast({ title: `已上传 ${uploaded.length} 张` });
    }
  }

  async function handleApplyWatermark(template: WatermarkTemplate) {
    setShowTemplatePicker(false);
    if (images.length === 0) {
      toast({ title: '没有图片可加水印', variant: 'destructive' });
      return;
    }
    // 把 WatermarkTemplate 平铺字段映射为后端 WatermarkConfig
    const config = (template as any).config || {
      type: (template as any).type || 'text',
      text: (template as any).text,
      imageUrl: (template as any).imageUrl,
      position: (template as any).position || 'bottom-right',
      opacity: (template as any).opacity ?? 50,
      fontSize: (template as any).fontSize,
      fontColor: (template as any).fontColor,
      scale: (template as any).scale,
    };
    setWatermarking(true);
    try {
      const res = await api.post<{ results: Array<{ source: string; watermarked: string; uploaded?: string; error?: string }> }>(
        '/api/images/upload-watermarked',
        { sourceUrls: images, itemId, config, uploadToCdn: true, shopId },
      );
      if (res.code === 1 && res.data?.results) {
        const newUrls = res.data.results.map((r) => r.uploaded || r.watermarked || r.source);
        const errors = res.data.results.filter((r) => r.error);
        onChange(newUrls);
        if (errors.length) {
          toast({ title: `${errors.length} 张水印失败：${errors[0]!.error?.slice(0, 80)}`, variant: 'destructive' });
        } else {
          toast({ title: `已加水印 ${newUrls.length} 张` });
        }
      } else {
        toast({ title: res.msg || '水印失败', variant: 'destructive' });
      }
    } catch (e: any) {
      // 服务端 500 时 e.message 通常是 HTTP 错误码，把后端 response.message 拿出来更有用
      const detail = e?.response?.data?.message || e?.response?.data?.msg || e?.message || '未知错误';
      toast({ title: `水印失败：${detail}`, variant: 'destructive' });
    }
    setWatermarking(false);
  }

  function handleRemove(idx: number) {
    onChange(images.filter((_, i) => i !== idx));
  }

  function handleDragStart(idx: number) {
    setDraggingIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (draggingIdx === null || draggingIdx === idx) return;
    const next = [...images];
    const [moved] = next.splice(draggingIdx, 1);
    next.splice(idx, 0, moved!);
    onChange(next);
    setDraggingIdx(idx);
  }

  function handleDragEnd() {
    setDraggingIdx(null);
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || watermarking || images.length >= maxCount}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span className="ml-1">本地上传</span>
        </Button>

        {watermarkTemplates && watermarkTemplates.length > 0 && (
          <div className="relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowTemplatePicker((v) => !v)}
              disabled={watermarking || uploading || images.length === 0}
            >
              {watermarking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Droplets className="h-3.5 w-3.5" />}
              <span className="ml-1">加水印</span>
            </Button>
            {showTemplatePicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTemplatePicker(false)} />
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-zinc-900 border border-border rounded-md shadow-lg py-1 min-w-[180px] z-50">
                  {watermarkTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleApplyWatermark(tpl)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-foreground"
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {images.length}/{maxCount} 张 · 拖拽排序
        </span>
      </div>

      {images.length === 0 ? (
        <div className="border-2 border-dashed rounded-md py-8 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">暂无图片，点击「本地上传」添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {images.map((url, idx) => (
            <div
              key={url + idx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`relative group border rounded overflow-hidden bg-muted ${draggingIdx === idx ? 'opacity-40' : ''}`}
            >
              <img src={url} alt="" className="w-full h-20 object-cover" />
              <div className="absolute top-0.5 left-0.5 bg-black/50 text-white text-[10px] px-1 rounded">
                {idx === 0 ? '主图' : idx + 1}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="absolute top-0.5 right-0.5 p-1 bg-black/50 hover:bg-destructive rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除"
              >
                <Trash2 className="h-3 w-3 text-white" />
              </button>
              <div className="absolute bottom-0.5 left-0.5 p-0.5 bg-black/50 rounded opacity-0 group-hover:opacity-100">
                <GripVertical className="h-3 w-3 text-white" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


