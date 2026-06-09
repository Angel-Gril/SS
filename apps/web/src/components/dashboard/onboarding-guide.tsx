'use client';

import type { ElementType } from 'react';
import { Loader2, RefreshCw, Settings, Store } from 'lucide-react';
import { buildOnboardingSteps, type OnboardingStatus, type OnboardingStepKey } from '@/lib/onboarding';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const STEP_ICONS: Record<OnboardingStepKey, ElementType> = {
  'add-shop': Store,
  'sync-orders': RefreshCw,
  'configure-warehouse': Settings,
};

export function OnboardingGuide({
  status,
  onSync,
  syncing = false,
}: {
  status: OnboardingStatus;
  onSync?: () => void;
  syncing?: boolean;
}) {
  const steps = buildOnboardingSteps(status);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">完成首次配置</h2>
            <p className="text-sm text-muted-foreground">按顺序完成店铺、订单和仓库配置后，ERP 会进入日常处理模式。</p>
          </div>
          <Badge variant="warning">新用户引导</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = STEP_ICONS[step.key];
            const content = (
              <div className={`h-full rounded-md border bg-background p-4 transition-colors ${step.active ? 'border-primary shadow-sm' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-3">
                  <Icon className={`h-5 w-5 ${step.done ? 'text-emerald-600' : step.active ? 'text-primary' : 'text-muted-foreground'}`} />
                  {step.done ? <Badge variant="success">已完成</Badge> : step.active ? <Badge>下一步</Badge> : <Badge variant="outline">待完成</Badge>}
                </div>
                <div className="mt-4 font-medium">{step.title}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.desc}</p>
                {step.action === 'sync-orders' && (
                  onSync ? (
                    <Button size="sm" className="mt-4" onClick={onSync} disabled={syncing || step.disabled}>
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      同步订单
                    </Button>
                  ) : step.disabled ? (
                    <Button size="sm" className="mt-4" disabled>
                      <RefreshCw className="h-4 w-4" />
                      同步订单
                    </Button>
                  ) : (
                    <Button asChild size="sm" className="mt-4">
                      <a href="/orders">
                        <RefreshCw className="h-4 w-4" />
                        去同步订单
                      </a>
                    </Button>
                  )
                )}
              </div>
            );

            if (step.href) {
              return (
                <a key={step.key} href={step.href} className="block">
                  {content}
                </a>
              );
            }
            return <div key={step.key}>{content}</div>;
          })}
        </div>
      </CardContent>
    </Card>
  );
}
