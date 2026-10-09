'use client';

import { useState } from 'react';

function managedImageCrossOrigin(src: string): 'anonymous' | undefined {
  try {
    // Persisted ERP assets may be served on a different public ERP origin with CORP.
    return new URL(src, 'https://ss-erp.invalid').pathname.startsWith('/api/cdn/')
      ? 'anonymous'
      : undefined;
  } catch {
    return undefined;
  }
}

export function SourceProductImage({ src, alt = '', className = '' }: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    return (
      <span
        className={`flex items-center justify-center p-2 text-center text-xs text-muted-foreground ${className}`}
        title="图片加载失败，来源站点可能限制访问或图片已失效"
      >
        图片暂不可用
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      crossOrigin={managedImageCrossOrigin(src)}
      onError={() => setFailedSrc(src)}
    />
  );
}
