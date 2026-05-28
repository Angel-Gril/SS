'use client';

import { HelpCircle, BookOpen, MessageCircle, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const HELP_SECTIONS = [
  { icon: BookOpen, title: '快速入门', description: '了解如何绑定店铺、同步商品、处理订单', items: ['绑定 OZON 店铺', '同步商品数据', '订单发货流程', '库存管理基础'] },
  { icon: FileText, title: '常见问题', description: '解答使用过程中的常见疑问', items: ['API Key 如何获取？', '同步失败怎么办？', '如何批量发货？', '物流单号在哪里查看？'] },
  { icon: MessageCircle, title: '联系支持', description: '遇到问题？联系我们的技术支持团队', items: ['工作时间: 9:00-18:00', '响应时间: 30分钟内', '支持渠道: 在线客服/邮件'] },
];

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">帮助中心</h1>
        <p className="text-muted-foreground text-sm mt-1">使用指南和常见问题解答</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {HELP_SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <section.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{section.title}</h3>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
              </div>
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item} className="text-sm text-muted-foreground flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
