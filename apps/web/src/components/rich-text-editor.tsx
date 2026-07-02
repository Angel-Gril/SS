'use client';

import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Image as ImageIcon, Heading1, Heading2, Quote, Undo, Redo } from 'lucide-react';
import { api } from '@/lib/api';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = 240 }: RichTextEditorProps) {
  const systemDialog = useSystemDialog();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const lastValueRef = useRef('');

  useEffect(() => {
    if (!editorRef.current) return;
    if (value === lastValueRef.current) return;
    editorRef.current.innerHTML = sanitizeHtml(value || '');
    lastValueRef.current = value || '';
  }, [value]);

  function emitChange() {
    if (!editorRef.current) return;
    const html = sanitizeHtml(editorRef.current.innerHTML);
    if (html !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = html;
    }
    lastValueRef.current = html;
    onChange(html);
  }

  function exec(command: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  }

  async function insertLink() {
    const url = await systemDialog.prompt({
      title: '插入链接',
      message: '请输入链接地址（必须以 http:// 或 https:// 开头）。',
      placeholder: 'https://example.com',
      confirmText: '插入链接',
    });
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast({ title: '链接必须以 http:// 或 https:// 开头', variant: 'destructive' });
      return;
    }
    exec('createLink', url);
  }

  async function handleImageInsert(file: File) {
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      toast({ title: '请选择图片文件', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await api.post<{ url: string }>('/api/images/upload-base64', {
        dataUrl,
        filename: file.name,
      });
      if (res.code === 1 && res.data?.url) {
        editorRef.current?.focus();
        document.execCommand('insertHTML', false, `<img src="${res.data.url}" alt="${escapeAttr(file.name)}" style="max-width:100%;height:auto" />`);
        emitChange();
      } else {
        toast({ title: res.msg || '上传失败', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: e.message || '上传失败', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleImageInsert(file);
          return;
        }
      }
    }
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      emitChange();
    }
  }

  return (
    <div className="rounded-md border border-input bg-background overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
        <ToolbarButton title="粗体" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="斜体" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="下划线" onClick={() => exec('underline')}><Underline className="h-3.5 w-3.5" /></ToolbarButton>
        <Divider />
        <ToolbarButton title="一级标题" onClick={() => exec('formatBlock', 'H2')}><Heading1 className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="二级标题" onClick={() => exec('formatBlock', 'H3')}><Heading2 className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="引用" onClick={() => exec('formatBlock', 'BLOCKQUOTE')}><Quote className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="正文" onClick={() => exec('formatBlock', 'P')}><span className="text-[10px] font-semibold">P</span></ToolbarButton>
        <Divider />
        <ToolbarButton title="无序列表" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="有序列表" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>
        <Divider />
        <ToolbarButton title="插入链接" onClick={insertLink}><LinkIcon className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title={uploading ? '上传中...' : '插入图片'} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton title="撤销" onClick={() => exec('undo')}><Undo className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="重做" onClick={() => exec('redo')}><Redo className="h-3.5 w-3.5" /></ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept={Array.from(ALLOWED_IMAGE_MIME).join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageInsert(file);
            e.target.value = '';
          }}
        />
      </div>
      <div
        ref={editorRef}
        contentEditable
        data-placeholder={placeholder || '在此输入公告内容...'}
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={onPaste}
        className="prose prose-sm dark:prose-invert max-w-none px-3 py-2.5 text-sm focus:outline-none [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-muted-foreground"
        style={{ minHeight }}
      />
    </div>
  );
}

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function ToolbarButton({ children, onClick, title, disabled }: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-border" />;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
