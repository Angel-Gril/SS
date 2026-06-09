export interface OnboardingStatus {
  hasShop: boolean;
  hasOrder: boolean;
  hasWarehouse: boolean;
  completed: boolean;
  nextStep: 'add-shop' | 'sync-orders' | 'configure-warehouse' | null;
}

export type OnboardingStepKey = NonNullable<OnboardingStatus['nextStep']>;

export interface OnboardingStepView {
  key: OnboardingStepKey;
  title: string;
  desc: string;
  href?: string;
  action?: 'sync-orders';
  done: boolean;
  active: boolean;
  disabled: boolean;
}

export function buildOnboardingSteps(status: OnboardingStatus): OnboardingStepView[] {
  return [
    {
      key: 'add-shop',
      title: '添加 OZON 店铺',
      desc: '录入 Client ID 和 API Key，先完成连接测试。',
      done: status.hasShop,
      active: status.nextStep === 'add-shop',
      disabled: false,
      href: '/shops/ozon',
    },
    {
      key: 'sync-orders',
      title: '同步第一批订单',
      desc: '从已绑定店铺拉取订单，确认履约状态和金额口径。',
      done: status.hasOrder,
      active: status.nextStep === 'sync-orders',
      disabled: !status.hasShop,
      action: 'sync-orders',
    },
    {
      key: 'configure-warehouse',
      title: '配置仓库和物流',
      desc: '补齐仓库、物流单号和打单相关配置。',
      done: status.hasWarehouse,
      active: status.nextStep === 'configure-warehouse',
      disabled: false,
      href: '/warehouses',
    },
  ];
}
