export interface SystemConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'destructive';
}

export interface SystemPromptOptions extends SystemConfirmOptions {
  placeholder?: string;
  defaultValue?: string;
}

export type PendingSystemDialog =
  | { type: 'confirm'; options: SystemConfirmOptions; resolve: (answer: boolean) => void }
  | { type: 'prompt'; options: SystemPromptOptions; value: string; resolve: (answer: string | null) => void };

export function createSystemDialogController(onChange: (dialog: PendingSystemDialog | null) => void) {
  let pending: PendingSystemDialog | null = null;
  let active = true;

  function cancelPending() {
    const previous = pending;
    pending = null;
    if (previous?.type === 'confirm') previous.resolve(false);
    if (previous?.type === 'prompt') previous.resolve(null);
  }

  function replace(next: PendingSystemDialog) {
    cancelPending();
    pending = next;
    onChange(next);
  }

  return {
    confirm(options: SystemConfirmOptions): Promise<boolean> {
      if (!active) return Promise.resolve(false);
      return new Promise((resolve) => replace({ type: 'confirm', options, resolve }));
    },
    prompt(options: SystemPromptOptions): Promise<string | null> {
      if (!active) return Promise.resolve(null);
      return new Promise((resolve) => replace({ type: 'prompt', options, value: options.defaultValue || '', resolve }));
    },
    cancel() {
      cancelPending();
      if (active) onChange(null);
    },
    accept() {
      const previous = pending;
      pending = null;
      if (active) onChange(null);
      if (previous?.type === 'confirm') previous.resolve(true);
      if (previous?.type === 'prompt') previous.resolve(previous.value.trim() || null);
    },
    updatePromptValue(value: string) {
      if (pending?.type !== 'prompt' || !active) return;
      pending = { ...pending, value };
      onChange(pending);
    },
    dispose() {
      active = false;
      cancelPending();
    },
    activate() { active = true; },
  };
}

export function createConfirmationScope(initialScope: string) {
  let scope = initialScope;
  let generation = 0;
  return {
    update(nextScope: string) {
      if (nextScope === scope) return;
      scope = nextScope;
      generation += 1;
    },
    invalidate() { generation += 1; },
    async run(requestApproval: () => boolean | Promise<boolean>): Promise<boolean> {
      const requestGeneration = ++generation;
      return await requestApproval() === true && requestGeneration === generation;
    },
  };
}
