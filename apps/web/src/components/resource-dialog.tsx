'use client';

import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onSave: () => void | Promise<void>;
  saving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
}

/**
 * 通用资源编辑对话框
 * 封装对话框的通用布局和保存/取消逻辑
 */
export function ResourceDialog({
  open,
  onOpenChange,
  title,
  children,
  onSave,
  saving = false,
  saveLabel = '保存',
  cancelLabel = '取消',
}: ResourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {cancelLabel}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
