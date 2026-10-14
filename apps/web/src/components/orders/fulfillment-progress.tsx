'use client';

import * as React from 'react';
import { ORDER_FULFILLMENT_PIPELINE, resolveOrderFulfillmentStage, resolveOrderFulfillmentStatus, type OrderFulfillmentStageInput } from 'shared/order-fulfillment-stage';

const steps = ORDER_FULFILLMENT_PIPELINE.filter(stage => stage.key !== 'abnormal');

export function OrderFulfillmentProgress({ order }: { order: OrderFulfillmentStageInput }) {
  const stage = resolveOrderFulfillmentStage(order);
  const status = resolveOrderFulfillmentStatus(order);
  if (stage.key === 'abnormal') {
    return <div role="status" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-destructive dark:bg-red-950/30">
      {status === 'cancelled' ? '订单已取消' : '订单异常'}
    </div>;
  }
  return (
    <ol aria-label="订单履约进度" className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-4">
      {steps.map(step => {
        const active = step.key === stage.key;
        return <li key={step.key} aria-current={active ? 'step' : undefined}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${active
            ? 'border-blue-500 bg-blue-50 font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-400'
            : 'border-border text-muted-foreground'}`}>
          {active && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
          {step.label}
        </li>;
      })}
    </ol>
  );
}
