import type { OzonClient } from './ozon-client.js';

/**
 * 异步获取 OZON 面单：先创建任务，轮询直到完成或超时。
 */
export async function fetchLabelAsync(
  client: OzonClient,
  postingNumber: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const task = await client.createPackageLabelTask([postingNumber]);
  let attempts = 0;
  while (attempts < 15) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await client.getPackageLabelTask(task.task_id);
    if (status.status === 'completed' && status.file_url) {
      return client.fetchUrl(status.file_url);
    }
    if (status.status === 'error') {
      throw new Error(status.error || '面单生成失败');
    }
    attempts++;
  }
  throw new Error('面单生成超时，请稍后重试');
}
