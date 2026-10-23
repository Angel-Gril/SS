import { z } from 'zod';

export type OzonLabelTaskType = 'big_label' | 'small_label';
export interface OzonLabelTask {
  task_id: number | string;
  task_type: OzonLabelTaskType;
}
export interface OzonLabelTaskResult {
  file_url?: string;
  status: {
    code: 'pending' | 'in_progress' | 'completed' | 'error';
    postings_count?: number;
    printed_postings_count?: number;
    unprinted_postings?: { posting_number: string; message?: string }[];
  };
  error?: { code?: string; message?: string };
}
interface LabelClient {
  createPackageLabelTasks(postingNumbers: string[]): Promise<{ tasks: OzonLabelTask[] }>;
  getPackageLabelTask(taskId: number | string): Promise<OzonLabelTaskResult>;
  /** Downloads through the client's bounded, public HTTPS-only fetch policy. */
  fetchUrl(url: string): Promise<{ buffer: Buffer; contentType: string }>;
}

const postingNumbersSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(1000);

/**
 * One V3 creation, bounded V2 polling, and a verified complete PDF download.
 * Never fall back to the obsolete synchronous endpoint or recreate an unknown task.
 */
export async function fetchLabelAsync(
  client: LabelClient,
  postingNumbers: string | string[],
  options: { taskType?: OzonLabelTaskType } = {},
): Promise<{ buffer: Buffer; contentType: string }> {
  const numbers = [...new Set(postingNumbersSchema.parse(
    Array.isArray(postingNumbers) ? postingNumbers : [postingNumbers],
  ))];
  const taskType = z.enum(['big_label', 'small_label']).parse(options.taskType ?? 'big_label');
  const created = await client.createPackageLabelTasks(numbers);
  const matching = created.tasks?.filter(task => task.task_type === taskType) ?? [];
  if (matching.length !== 1) throw new Error(`OZON 未返回唯一的 ${taskType} 面单任务`);
  const task = matching[0]!;
  const taskId = String(task.task_id);
  if ((typeof task.task_id === 'number' && !Number.isSafeInteger(task.task_id))
    || !/^[1-9]\d*$/.test(taskId) || BigInt(taskId) > 9223372036854775807n) {
    throw new Error('OZON 返回无效或精度不安全的面单任务 ID');
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await client.getPackageLabelTask(task.task_id);
    const status = result.status;
    if (status?.code === 'completed') {
      const unprinted = status.unprinted_postings ?? [];
      if (unprinted.length > 0) {
        const summary = unprinted.slice(0, 10).map(item => `${item.posting_number}: ${item.message || '未生成'}`).join('；');
        throw new Error(`OZON 部分面单生成失败：${summary}`);
      }
      if (status.postings_count !== numbers.length || status.printed_postings_count !== numbers.length) {
        throw new Error(`OZON 面单数量不完整（请求 ${numbers.length}，生成 ${status.printed_postings_count ?? '未知'}）`);
      }
      if (result.error?.code || result.error?.message) {
        throw new Error(result.error.message || result.error.code || '面单生成失败');
      }
      if (!result.file_url) throw new Error('OZON 已完成面单任务但未返回下载地址');
      return client.fetchUrl(result.file_url);
    }
    if (status?.code === 'error') {
      throw new Error(result.error?.message || result.error?.code || '面单生成失败');
    }
    if (status?.code !== 'pending' && status?.code !== 'in_progress') throw new Error('OZON 返回未知面单任务状态');
  }
  throw new Error(`面单生成超时（任务 ${taskId}），未重新创建任务，请稍后核对`);
}
