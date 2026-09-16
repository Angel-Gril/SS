'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import {
  createConfirmationScope,
  createSystemDialogController,
  type PendingSystemDialog,
  type SystemConfirmOptions,
  type SystemPromptOptions,
} from '@/lib/system-dialog-state';

interface SystemDialogContextValue {
  confirm: (options: SystemConfirmOptions) => Promise<boolean>;
  prompt: (options: SystemPromptOptions) => Promise<string | null>;
}

const SystemDialogContext = createContext<SystemDialogContextValue | null>(null);

export function SystemDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingSystemDialog | null>(null);
  const [controller] = useState(() => createSystemDialogController(setPending));
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);

  const options = pending?.options;
  const title = options?.title || (pending?.type === 'prompt' ? '请输入内容' : '确认操作');
  const confirmText = options?.confirmText || (pending?.type === 'prompt' ? '确定' : '确认');
  const cancelText = options?.cancelText || '取消';
  const tone = options?.tone || 'default';

  return (
    <SystemDialogContext.Provider value={controller}>
      {children}
      <Dialog open={!!pending} onOpenChange={(open) => { if (!open) controller.cancel(); }}>
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
              onChange={(event) => controller.updatePromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') controller.accept();
              }}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => controller.cancel()}>{cancelText}</Button>
            <Button
              type="button"
              variant={tone === 'destructive' ? 'destructive' : 'default'}
              onClick={() => controller.accept()}
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

export function useScopedSystemConfirmation(scopeKey: string) {
  const { confirm: requestConfirmation } = useSystemDialog();
  const [scope] = useState(() => createConfirmationScope(scopeKey));
  const mounted = useRef(true);
  scope.update(scopeKey);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scope.invalidate(); };
  }, [scope]);
  return useCallback((options: SystemConfirmOptions) => scope.run(
    () => mounted.current ? requestConfirmation(options) : false,
  ), [requestConfirmation, scope]);
}
