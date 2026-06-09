export type DashboardBusinessActionKey = 'collect-1688' | 'category-mapping' | 'supply-goods' | 'ozon-listing';

export interface DashboardBusinessAction {
  key: DashboardBusinessActionKey;
  label: string;
  description: string;
  href: string;
  icon: 'calculator' | 'mapping' | 'package' | 'listing';
}

export interface DashboardBusinessStatus {
  collect1688: {
    supplyGoodCount: number;
    latestSupplyGood: {
      id: string;
      title: string;
      sourceProductId: string | null;
      updatedAt: string;
    } | null;
  };
  categoryMapping: {
    mappingCount: number;
    latestMapping: {
      id: string;
      sourceCategoryName: string | null;
      targetCategoryId: number;
      targetTypeId: number;
      updatedAt: string;
    } | null;
  };
}

export function buildDashboardBusinessActions(): DashboardBusinessAction[] {
  return [
    {
      key: 'collect-1688',
      label: '1688手工补录',
      description: '扩展采集异常时的兜底入口，用于补录货源、复算核价和排查接口。',
      href: '/collect/1688',
      icon: 'calculator',
    },
    {
      key: 'category-mapping',
      label: '类目映射',
      description: '维护 1688 来源类目到 Ozon 类目和 type 的默认关系。',
      href: '/collect/category-mapping',
      icon: 'mapping',
    },
    {
      key: 'supply-goods',
      label: '货源管理',
      description: '查看已保存的 1688/淘宝/拼多多货源和采购成本。',
      href: '/supply/goods',
      icon: 'package',
    },
    {
      key: 'ozon-listing',
      label: 'Ozon上货',
      description: '进入采集商品、克隆刊登和批量发布工作区。',
      href: '/collect',
      icon: 'listing',
    },
  ];
}

export function getDashboardBusinessActionMeta(
  action: DashboardBusinessAction,
  status: DashboardBusinessStatus | null,
): string {
  if (!status) return '状态加载中';

  if (action.key === 'collect-1688') {
    const count = status.collect1688.supplyGoodCount;
    const latestTitle = status.collect1688.latestSupplyGood?.title;
    return latestTitle ? `${count} 条1688货源 · 最近 ${latestTitle}` : `${count} 条1688货源`;
  }

  if (action.key === 'category-mapping') {
    const count = status.categoryMapping.mappingCount;
    const latestName = status.categoryMapping.latestMapping?.sourceCategoryName;
    return latestName ? `${count} 条映射 · 最近 ${latestName}` : `${count} 条映射`;
  }

  if (action.key === 'supply-goods') {
    return `${status.collect1688.supplyGoodCount} 条1688货源已接入`;
  }

  return status.categoryMapping.mappingCount > 0 ? '已启用类目映射辅助上货' : '可先维护类目映射';
}
