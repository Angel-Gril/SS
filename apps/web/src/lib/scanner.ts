'use client';

import { useEffect, useRef, useCallback } from 'react';

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function playBeep(type: 'success' | 'error' = 'success') {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === 'success') {
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } else {
    osc.type = 'square';
    osc.frequency.value = 280;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  }
}

export interface ScannerOptions {
  dedupMs?: number;
  autoRefocus?: boolean;
}

export function useScannerInput(options: ScannerOptions = {}) {
  const { dedupMs = 1500, autoRefocus = true } = options;
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!autoRefocus) return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.key !== 'Enter') return;
      inputRef.current?.focus();
    }
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick);
    };
  }, [autoRefocus]);

  const isDuplicate = useCallback((code: string): boolean => {
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last && last.code === code && now - last.at < dedupMs) return true;
    lastCodeRef.current = { code, at: now };
    return false;
  }, [dedupMs]);

  const handlers = {
    onCompositionStart: () => { composingRef.current = true; },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      const target = e.target as HTMLInputElement;
      const cleaned = target.value.replace(/[一-龥　-〿＀-￯]/g, '');
      if (cleaned !== target.value) target.value = cleaned;
    },
    isComposing: () => composingRef.current,
  };

  const refocus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return { inputRef, isDuplicate, handlers, refocus };
}
