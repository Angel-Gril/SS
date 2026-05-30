'use client';

import { useRef, useState } from 'react';
import { Paperclip, X, Loader2, FileText, Image as ImageIcon, Archive, FileType } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

export interface Attachment {
  name: string;
  url: string;
  size?: number;
  mime?: string;
}

interface AnnouncementAttachmentsProps {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  maxCount?: number;
}

const ACCEPT_MIMES =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,text/plain';

export function AnnouncementAttachments({ value, onChange, maxCount = 10 }: AnnouncementAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    if (value.length + arr.length > maxCount) {
      toast({ title: `最多上传 ${maxCount} 个附件`, variant: 'destructive' });
      return;
    }

    setUploading(true);
    const next: Attachment[] = [];
    for (const file of arr) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const res = await api.post<Attachment>('/api/images/upload-attachment', {
          dataUrl,
          filename: file.name,
        });
        if (res.code === 1 && res.data?.url) {
          next.push(res.data);
        } else {
          toast({ title: `${file.name}：${res.msg || '上传失败'}`, variant: 'destructive' });
        }
      } catch (e: any) {
        toast({ title: `${file.name}：${e.message || '上传失败'}`, variant: 'destructive' });
      }
    }
    setUploading(false);
    if (next.length) {
      onChange([...value, ...next]);
      toast({ title: `已上传 ${next.length} 个附件` });
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">附件（{value.length}/{maxCount}）</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || value.length >= maxCount}
          onClick={() => fileInputRef.current?.click()}
          className="gap-1.5"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {uploading ? '上传中...' : '添加附件'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_MIMES}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {value.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded-md py-3 px-3 text-center">
          支持图片、PDF、Word、Excel、ZIP、TXT，单个文件最大 20MB
        </div>
      ) : (
        <ul className="space-y-1">
          {value.map((att, i) => (
            <li key={`${att.url}-${i}`} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
              <AttachmentIcon mime={att.mime} />
              <a
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-primary hover:underline"
                title={att.name}
              >
                {att.name}
              </a>
              {typeof att.size === 'number' && (
                <span className="text-xs text-muted-foreground shrink-0">{formatSize(att.size)}</span>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="移除"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentIcon({ mime }: { mime?: string }) {
  if (!mime) return <FileType className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (mime.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-blue-600 shrink-0" />;
  if (mime === 'application/pdf') return <FileText className="h-4 w-4 text-red-600 shrink-0" />;
  if (mime.includes('zip')) return <Archive className="h-4 w-4 text-amber-600 shrink-0" />;
  return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
