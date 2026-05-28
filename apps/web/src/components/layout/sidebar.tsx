'use client';

import Link from 'next/link';
import {
  Store,
  ShoppingCart,
  Warehouse,
  CreditCard,
  Upload,
  Truck,
  HelpCircle,
  Package,
  Globe,
  LayoutDashboard,
  ChevronDown,
  Image,
  Settings,
  MessageCircle,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

type UserRole = 'ADMIN' | 'USER' | 'STAFF';

interface NavItem {
  label: string;
  icon: React.ElementType;
  href?: string;
  children?: { label: string; href: string }[];
  /** 允许访问的角色列表，不设置则所有角色可见 */
  roles?: UserRole[];
}

const navigation: NavItem[] = [
  { label: '首页', icon: LayoutDashboard, href: '/', roles: ['ADMIN'] },
  {
    label: '店铺管理',
    icon: Store,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: 'OZON 店铺', href: '/shops/ozon' },
      { label: '店铺分析', href: '/shops/ozon/analytics' },
      { label: 'Yandex 店铺', href: '/shops/yandex' },
      { label: 'Kaspi 店铺', href: '/shops/kaspi' },
      { label: 'Wildberries 店铺', href: '/shops/wildberries' },
      { label: '产品管理', href: '/products' },
      { label: '仓库管理', href: '/warehouses' },
    ],
  },
  {
    label: '订单管理',
    icon: ShoppingCart,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: '全部订单', href: '/orders' },
      { label: '物流绑定', href: '/orders/logistics' },
      { label: '打包发货', href: '/orders/ship' },
      { label: '订单统计', href: '/orders/stats' },
      { label: '退货记录', href: '/orders/returns' },
    ],
  },
  {
    label: '仓储相关',
    icon: Warehouse,
    roles: ['ADMIN', 'STAFF'],
    children: [
      { label: '仓库看板', href: '/warehouse' },
      { label: '扫码入库', href: '/warehouse/scan-in' },
      { label: '扫码出库', href: '/warehouse/scan-out' },
      { label: '验视处理', href: '/warehouse/inspection' },
      { label: '扫码打单', href: '/warehouse/scan' },
      { label: '面单打印', href: '/warehouse/print' },
      { label: '快递入库', href: '/warehouse/inbound' },
      { label: '物流单号', href: '/warehouse/tracking' },
      { label: '库存发货', href: '/warehouse/outbound' },
    ],
  },
  {
    label: '财务管理',
    icon: CreditCard,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: '余额充值', href: '/finance' },
      { label: '物流账单', href: '/finance/logistics' },
      { label: '利润分析', href: '/finance/profit' },
    ],
  },
  {
    label: '一键上货',
    icon: Upload,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: 'SKU批量采集', href: '/collect/batch' },
      { label: 'SKU采集跟卖', href: '/collect' },
      { label: 'SKU采集改款', href: '/listing' },
      { label: '图片处理', href: '/image-processing' },
      { label: '上架日志', href: '/listing-logs' },
    ],
  },
  {
    label: '快递相关',
    icon: Truck,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: '退件申请', href: '/express/returns' },
      { label: '问题处理', href: '/express/issues' },
    ],
  },
  {
    label: '客服消息',
    icon: MessageCircle,
    href: '/chat',
    roles: ['ADMIN', 'USER'],
  },
  {
    label: '库存管理',
    icon: Package,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: '库存列表', href: '/inventory' },
    ],
  },
  {
    label: '供货平台',
    icon: Globe,
    roles: ['ADMIN', 'USER'],
    children: [
      { label: '供货信息', href: '/supply/goods' },
      { label: '国内货盘', href: '/supply/domestic' },
    ],
  },
  { label: '帮助中心', icon: HelpCircle, href: '/help' },
  {
    label: '系统管理',
    icon: Settings,
    roles: ['ADMIN'],
    children: [
      { label: '系统设置', href: '/admin/settings' },
      { label: '服务标签设置', href: '/admin/service-tags' },
      { label: '费用模板', href: '/admin/fee-templates' },
      { label: '用户管理', href: '/admin/users' },
      { label: '账户管理', href: '/admin/accounts' },
      { label: '仓库模板', href: '/admin/warehouse-templates' },
      { label: '仓库指令', href: '/admin/warehouse-commands' },
      { label: 'OZON 揽收点', href: '/admin/ozon-pickup-points' },
      { label: 'OZON 接口探测', href: '/admin/ozon-probe' },
      { label: 'Solo 账单', href: '/admin/solo-billing' },
      { label: '国内地址', href: '/domestic-addresses' },
    ],
  },
  {
    label: '我的仓库',
    icon: Warehouse,
    roles: ['USER'],
    children: [
      { label: '仓库指令', href: '/warehouse-commands' },
      { label: '我的颜色标签', href: '/user-color-tags' },
      { label: 'OZON 揽收点', href: '/ozon-pickup-points' },
      { label: '国内地址', href: '/domestic-addresses' },
      { label: '代理管理', href: '/provider' },
    ],
  },
  {
    label: '账号设置',
    icon: User,
    roles: ['USER'],
    children: [
      { label: '员工管理', href: '/settings/staff' },
      { label: '子账号管理', href: '/settings/sub-accounts' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  pathname: string;
  role: UserRole;
}

export function Sidebar({ collapsed, pathname, role }: SidebarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const visibleNav = navigation.filter(
    (item) => !item.roles || item.roles.includes(role),
  );

  // 当侧边栏折叠时，鼠标悬停自动展开
  const shouldExpand = collapsed && isHovered;

  return (
    <aside
      className={cn(
        'h-screen sticky top-0 flex flex-col transition-all duration-300 border-r glass-effect',
        shouldExpand ? 'w-64' : collapsed ? 'w-16' : 'w-64',
      )}
      onMouseEnter={() => {
        if (collapsed) {
          setIsHovered(true);
        }
      }}
      onMouseLeave={() => {
        if (collapsed) {
          setIsHovered(false);
        }
      }}
    >
      <div className="h-16 flex items-center justify-center border-b border-border/50 shrink-0">
        {collapsed && !shouldExpand ? (
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
            SS
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold shadow-md">
              SS
            </div>
            <span className="text-lg font-semibold tracking-tight bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
              松鼠跨境 ERP
            </span>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-4 px-2">
        {visibleNav.map((item) => (
          <NavGroup key={item.label} item={item} collapsed={collapsed && !shouldExpand} pathname={pathname} />
        ))}
      </nav>
    </aside>
  );
}

function NavGroup({
  item,
  collapsed,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}) {
  const hasChildren = !!item.children?.length;
  const isActive = item.href === pathname || item.children?.some((c) => pathname.startsWith(c.href));
  const [open, setOpen] = useState(isActive);
  const [isHovered, setIsHovered] = useState(false);

  // 鼠标悬停自动展开子菜单
  const shouldOpen = open || isHovered;

  if (!hasChildren) {
    return (
      <Link
        href={item.href!}
        className={cn(
          'dock-item flex items-center gap-3 px-4 py-3 mb-1 rounded-xl text-sm font-medium transition-all',
          pathname === item.href
            ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white menu-active'
            : 'text-foreground/70 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-950/30',
          collapsed && 'justify-center px-0 w-12 h-12 mx-auto',
        )}
      >
        <item.icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4.5 w-4.5')} />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  }

  return (
    <div
      className="mb-1"
      onMouseEnter={() => !collapsed && setIsHovered(true)}
      onMouseLeave={() => !collapsed && setIsHovered(false)}
    >
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'dock-item w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
          isActive
            ? 'text-orange-600 dark:text-orange-400'
            : 'text-foreground/70 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-950/30',
          collapsed && 'justify-center px-0 w-12 h-12 mx-auto',
        )}
      >
        <item.icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4.5 w-4.5')} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', shouldOpen && 'rotate-180')}
            />
          </>
        )}
      </button>
      {!collapsed && shouldOpen && (
        <div className="ml-4 pl-4 border-l-2 border-orange-200 dark:border-orange-900/50 space-y-1 mt-1">
          {item.children!.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={cn(
                'dock-item block px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                pathname === child.href
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white menu-active'
                  : 'text-foreground/60 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30',
              )}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
