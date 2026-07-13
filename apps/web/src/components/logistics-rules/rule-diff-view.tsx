import { ArrowRight, Minus, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface LogisticsRuleDiff {
  revisionId: string;
  channelId: string;
  currentReleaseId: string | null;
  currentSequence: number;
  added: string[];
  changed: string[];
  removed: string[];
}

interface RuleDiffViewProps {
  diff: LogisticsRuleDiff | null;
}

const diffMeta = {
  added: {
    label: '新增',
    description: '候选草稿新增的稳定服务',
    icon: Plus,
    badge: 'success' as const,
  },
  changed: {
    label: '变更',
    description: '相同稳定服务标识下的公式发生变化',
    icon: ArrowRight,
    badge: 'warning' as const,
  },
  removed: {
    label: '移除',
    description: '当前发布存在、候选草稿不再包含的服务',
    icon: Minus,
    badge: 'destructive' as const,
  },
};

export function RuleDiffView({ diff }: RuleDiffViewProps) {
  if (!diff) {
    return (
      <div className="border-y bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        导入或读取草稿后获取服务端稳定差异。
      </div>
    );
  }

  const rows = (Object.keys(diffMeta) as Array<keyof typeof diffMeta>)
    .flatMap((kind) => diff[kind].map((stableServiceKey) => ({ kind, stableServiceKey })))
    .sort((left, right) => left.stableServiceKey.localeCompare(right.stableServiceKey));

  return (
    <section id="rule-diff" aria-labelledby="rule-diff-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="rule-diff-title" className="text-sm font-semibold">稳定服务差异</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            仅按服务端稳定服务标识比较；响应顺序和 Ozon 临时响应 ID 不参与差异。
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="差异统计">
          {(Object.keys(diffMeta) as Array<keyof typeof diffMeta>).map((kind) => (
            <Badge key={kind} variant={diffMeta[kind].badge}>
              {diffMeta[kind].label} {diff[kind].length}
            </Badge>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-y bg-emerald-50/60 px-4 py-5 text-sm text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
          候选公式与当前发布没有稳定服务级差异。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">类型</TableHead>
              <TableHead>稳定服务标识</TableHead>
              <TableHead className="min-w-64">影响</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ kind, stableServiceKey }) => {
              const meta = diffMeta[kind];
              const Icon = meta.icon;
              return (
                <TableRow key={`${kind}:${stableServiceKey}`}>
                  <TableCell>
                    <Badge variant={meta.badge} className="gap-1">
                      <Icon className="h-3 w-3" aria-hidden />
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xl break-all font-mono text-xs">{stableServiceKey}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{meta.description}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
