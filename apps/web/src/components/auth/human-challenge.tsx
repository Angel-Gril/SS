'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export type HumanChallengeProvider = 'disabled' | 'cloudflare-turnstile' | 'builtin-pow';
export type HumanChallengeAction =
  | 'login'
  | 'sms_login'
  | 'register_sms'
  | 'password_reset_sms'
  | 'admin_login';

export interface HumanChallengeConfig {
  runtimeMode: 'local' | 'cloud';
  smsRegisterEnabled: boolean;
  smsLoginEnabled?: boolean;
  humanChallengeProvider?: HumanChallengeProvider;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  powDifficulty?: number;
  powTtlSeconds?: number;
  smsRateLimitSeconds: number;
}

export interface HumanChallengeHandle {
  getToken: () => Promise<string | null>;
  reset: () => void;
}

interface HumanChallengeProps {
  action: HumanChallengeAction;
  provider: HumanChallengeProvider;
  turnstileSiteKey?: string;
  onStatusChange?: (ready: boolean) => void;
}

interface PowChallenge {
  token: string;
  difficulty: number;
  expiresAt: string;
}

type ChallengeState = 'idle' | 'loading' | 'solving' | 'ready' | 'error';

const TURNSTILE_RESPONSE_TIMEOUT_MS = 8000;

function hasLeadingZeroHexCharacters(bytes: Uint8Array, difficulty: number): boolean {
  const digestHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return digestHex.startsWith('0'.repeat(difficulty));
}

async function solvePow(
  token: string,
  difficulty: number,
  isCancelled: () => boolean,
): Promise<string> {
  const encoder = new TextEncoder();
  for (let counter = 0; counter < 20_000_000; counter += 1) {
    if (isCancelled()) throw new Error('cancelled');
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${token}:${counter}`));
    if (hasLeadingZeroHexCharacters(new Uint8Array(digest), difficulty))
      return `${token}.${counter}`;
    if (counter > 0 && counter % 250 === 0)
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error('计算次数超过安全上限');
}

export function resolveHumanChallengeProvider(
  config: HumanChallengeConfig,
): HumanChallengeProvider {
  if (config.humanChallengeProvider) return config.humanChallengeProvider;
  return config.turnstileEnabled ? 'cloudflare-turnstile' : 'disabled';
}

export const HumanChallenge = forwardRef<HumanChallengeHandle, HumanChallengeProps>(
  function HumanChallenge({ action, provider, turnstileSiteKey = '', onStatusChange }, ref) {
    const turnstileRef = useRef<TurnstileInstance | null>(null);
    const generationRef = useRef(0);
    const [turnstileRenderKey, setTurnstileRenderKey] = useState(0);
    const [state, setState] = useState<ChallengeState>('idle');
    const [token, setToken] = useState('');
    const [error, setError] = useState('');

    const handleTurnstileFailure = useCallback(
      (kind: 'error' | 'timeout' | 'unsupported', errorCode?: string) => {
        const code = errorCode ? `（错误码 ${errorCode}）` : '';
        const message =
          kind === 'timeout'
            ? `人机验证超时${code}，请关闭脚本拦截器或切换网络后重试`
            : kind === 'unsupported'
              ? `当前浏览器不支持人机验证${code}，请使用最新版 Chrome 或 Edge`
              : `人机验证加载失败${code}，请关闭脚本拦截器或切换网络后重试`;
        setToken('');
        setState('error');
        setError(message);
        onStatusChange?.(false);
      },
      [onStatusChange],
    );

    const setReadyToken = useCallback(
      (nextToken: string) => {
        setToken(nextToken);
        setError('');
        setState('ready');
        onStatusChange?.(true);
      },
      [onStatusChange],
    );

    const startPow = useCallback(async () => {
      const generation = ++generationRef.current;
      setToken('');
      setError('');
      setState('loading');
      onStatusChange?.(false);
      try {
        const response = await api.get<PowChallenge>(`/api/auth/human-challenge?action=${action}`);
        if (response.code !== 1 || !response.data?.token)
          throw new Error(response.msg || '无法获取安全验证');
        setState('solving');
        const solution = await solvePow(
          response.data.token,
          response.data.difficulty,
          () => generation !== generationRef.current,
        );
        if (generation === generationRef.current) setReadyToken(solution);
      } catch (cause) {
        if (generation !== generationRef.current) return;
        setState('error');
        setError(
          cause instanceof Error && cause.message !== 'cancelled'
            ? cause.message
            : '安全验证失败，请重试',
        );
        onStatusChange?.(false);
      }
    }, [action, onStatusChange, setReadyToken]);

    const reset = useCallback(() => {
      generationRef.current += 1;
      setToken('');
      setError('');
      onStatusChange?.(provider === 'disabled');
      if (provider === 'cloudflare-turnstile') {
        turnstileRef.current?.reset();
        setTurnstileRenderKey((value) => value + 1);
        setState('idle');
      } else if (provider === 'builtin-pow') {
        void startPow();
      } else {
        setState('ready');
      }
    }, [onStatusChange, provider, startPow]);

    useEffect(() => {
      if (provider === 'builtin-pow') void startPow();
      else {
        generationRef.current += 1;
        setToken('');
        setError('');
        setState(provider === 'disabled' ? 'ready' : 'idle');
        onStatusChange?.(provider === 'disabled');
      }
      return () => {
        generationRef.current += 1;
      };
    }, [onStatusChange, provider, startPow]);

    const getToken = useCallback(async () => {
      if (provider === 'disabled') return '';
      if (provider === 'builtin-pow') return token || null;
      if (token) return token;

      const generation = generationRef.current;
      const instance = turnstileRef.current;
      if (!instance) return null;

      const response = instance.getResponse();
      if (response) return response;

      try {
        const pendingResponse = await instance.getResponsePromise(TURNSTILE_RESPONSE_TIMEOUT_MS);
        if (generation !== generationRef.current) return null;
        if (pendingResponse) setReadyToken(pendingResponse);
        return pendingResponse || null;
      } catch {
        if (generation === generationRef.current) handleTurnstileFailure('timeout');
        return null;
      }
    }, [handleTurnstileFailure, provider, setReadyToken, token]);

    useImperativeHandle(ref, () => ({ getToken, reset }), [getToken, reset]);

    if (provider === 'disabled') return null;

    if (provider === 'cloudflare-turnstile') {
      if (!turnstileSiteKey)
        return (
          <p className="text-center text-xs text-destructive">
            Turnstile 站点密钥未配置，暂时无法验证
          </p>
        );
      return (
        <div className="space-y-2">
          <div className="flex justify-center">
            <Turnstile
              key={turnstileRenderKey}
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              onSuccess={setReadyToken}
              onError={(errorCode) => handleTurnstileFailure('error', errorCode)}
              onTimeout={() => handleTurnstileFailure('timeout')}
              onUnsupported={() => handleTurnstileFailure('unsupported')}
              onExpire={() => {
                setToken('');
                setState('error');
                setError('人机验证已过期，请重新验证');
                onStatusChange?.(false);
              }}
              options={{
                size: 'normal',
                theme: 'auto',
                retry: 'never',
                refreshTimeout: 'manual',
                refreshExpired: 'auto',
                action,
              }}
            />
          </div>
          {error && <ChallengeError message={error} onRetry={reset} />}
        </div>
      );
    }

    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2.5" aria-live="polite">
        <div className="flex items-center gap-2 text-sm">
          {state === 'ready' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : state === 'error' ? (
            <ShieldCheck className="h-4 w-4 text-destructive" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <span>
            {state === 'ready'
              ? '安全验证已完成'
              : state === 'error'
                ? '安全验证未完成'
                : state === 'loading'
                  ? '正在加载安全验证…'
                  : '正在完成安全验证…'}
          </span>
          {state === 'ready' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              onClick={reset}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              重新验证
            </Button>
          )}
        </div>
        {state === 'solving' && (
          <p className="mt-1 pl-6 text-xs text-muted-foreground">
            仅使用少量浏览器计算，无需识别图片或输入字符。
          </p>
        )}
        {state === 'error' && <ChallengeError message={error} onRetry={reset} />}
      </div>
    );
  },
);

function ChallengeError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-destructive">
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" className="h-7 shrink-0" onClick={onRetry}>
        重新验证
      </Button>
    </div>
  );
}
