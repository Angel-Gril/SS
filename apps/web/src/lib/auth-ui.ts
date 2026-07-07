'use client';

export function formatAuthNetworkError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `网络错误: ${error.message}`;
  }
  return '网络错误，请检查网络后重试';
}
