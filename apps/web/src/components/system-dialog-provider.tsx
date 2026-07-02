'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
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

type SystemDialogTone = 'default' | 'destructive';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: SystemDialogTone;
}

interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  defaultValue?: string;
}

interface SystemDialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

type PendingDialog =
  | {
      type: 'confirm';
      options: ConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      type: 'prompt';
      options: PromptOptions;
      value: string;
      resolve: (value: string | null) => void;
    };

const SystemDialogContext = createContext<SystemDialogContextValue | null>(null);

export function SystemDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);

  function setDialog(dialog: PendingDialog | null) {
    pendingRef.current = dialog;
    setPending(dialog);
  }

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setDialog({ type: 'confirm', options, resolve });
  }), []);

  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
    setDialog({ type: 'prompt', options, value: options.defaultValue || '', resolve });
  }), []);

  function closeWithCancel() {
    const current = pendingRef.current;
    setDialog(null);
    if (!current) return;
    if (current.type === 'confirm') {
      current.resolve(false);
      return;
    }
    current.resolve(null);
  }

  function closeWithConfirm() {
    const current = pendingRef.current;
    setDialog(null);
    if (!current) return;
    if (current.type === 'confirm') {
      current.resolve(true);
      return;
    }
    current.resolve(current.value.trim() || null);
  }

  function updatePromptValue(value: string) {
    const current = pendingRef.current;
    if (!current || current.type !== 'prompt') return;
    const next = { ...current, value };
    setDialog(next);
  }

  const options = pending?.options;
  const title = options?.title || (pending?.type === 'prompt' ? '请输入内容' : '确认操作');
  const confirmText = options?.confirmText || (pending?.type === 'prompt' ? '确定' : '确认');
  const cancelText = options?.cancelText || '取消';
  const tone = options?.tone || 'default';

  return (
    <SystemDialogContext.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog open={!!pending} onOpenChange={(open) => { if (!open) closeWithCancel(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {options?.message ? <DialogDescription>{options.message}</DialogDescription> : null}
          </DialogHeader>
          {pending?.type === 'prompt' ? (
            <Input
              value={pending.value}
              placeholder={pending.options.placeholder}
              autoFocus
              onChange={(event) => updatePromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') closeWithConfirm();
              }}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeWithCancel}>{cancelText}</Button>
            <Button
              type="button"
              variant={tone === 'destructive' ? 'destructive' : 'default'}
              onClick={closeWithConfirm}
            >
              {confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SystemDialogContext.Provider>
  );
}

export function useSystemDialog() {
  const context = useContext(SystemDialogContext);
  if (!context) throw new Error('useSystemDialog must be used inside SystemDialogProvider');
  return context;
}
