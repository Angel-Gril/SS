'use client';

import { Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PlatformPageProps {
  platform: string;
  description: string;
  features: string[];
}

function PlatformComingSoon({ platform, description, features }: PlatformPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{platform} 店铺管理</h1>
        <p className="text-muted-foreground text-sm mt-1">{description}</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Globe className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">功能开发中</h2>
            <p className="text-muted-foreground max-w-md mb-6">
              {platform} 平台接入正在开发中，即将支持以下功能：
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {features.map((f) => (
                <Badge key={f} variant="outline">{f}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function YandexShopsPage() {
  return (
    <PlatformComingSoon
      platform="Yandex Market"
      description="管理您的 Yandex Market 店铺"
      features={['店铺绑定', '商品同步', '订单管理', '库存同步', '价格管理']}
    />
  );
}
