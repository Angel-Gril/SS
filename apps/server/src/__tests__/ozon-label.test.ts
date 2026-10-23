import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLabelAsync } from '../services/ozon-label.js';

const pdf = { buffer: Buffer.from('%PDF-1.7\nfixture'), contentType: 'application/pdf' };
function clientFor() {
  return {
    createPackageLabelTask: vi.fn().mockResolvedValue({ task_id: 1 }),
    createPackageLabelTasks: vi.fn().mockResolvedValue({ tasks: [
      { task_id: 21, task_type: 'small_label' },
      { task_id: 22, task_type: 'big_label' },
    ] }),
    getPackageLabelTask: vi.fn().mockResolvedValue({
      status: { code: 'completed', postings_count: 2, printed_postings_count: 2, unprinted_postings: [] },
      file_url: 'https://cdn.ozon.ru/labels/test.pdf',
    }),
    fetchUrl: vi.fn().mockResolvedValue(pdf),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('current Ozon asynchronous label contract', () => {
  it('selects an explicitly requested big-label task from the official tasks array for a batch', async () => {
    const client = clientFor();
    const result = expect(fetchLabelAsync(client as any, ['posting-1', 'posting-2'], { taskType: 'big_label' })).resolves.toEqual(pdf);
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.createPackageLabelTasks).toHaveBeenCalledWith(['posting-1', 'posting-2']);
    expect(client.createPackageLabelTask).not.toHaveBeenCalled();
    expect(client.getPackageLabelTask).toHaveBeenCalledWith(22);
  });

  it('prints the available small label by default when Ozon returns only a small-label task', async () => {
    const client = clientFor();
    client.createPackageLabelTasks.mockResolvedValue({ tasks: [{ task_id: 21, task_type: 'small_label' }] });
    const result = expect(fetchLabelAsync(client as any, ['posting-1', 'posting-2'])).resolves.toEqual(pdf);
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.getPackageLabelTask).toHaveBeenCalledWith(21);
    expect(client.createPackageLabelTasks).toHaveBeenCalledTimes(1);
  });

  it('prefers small labels when both exist and retains support for shops providing only ordinary labels', async () => {
    const client = clientFor();
    const first = expect(fetchLabelAsync(client as any, ['posting-1', 'posting-2'])).resolves.toEqual(pdf);
    await Promise.all([first, vi.runAllTimersAsync()]);
    expect(client.getPackageLabelTask).toHaveBeenCalledWith(21);
    client.createPackageLabelTasks.mockResolvedValue({ tasks: [{ task_id: 22, task_type: 'big_label' }] });
    client.getPackageLabelTask.mockClear();
    const second = expect(fetchLabelAsync(client as any, ['posting-1', 'posting-2'])).resolves.toEqual(pdf);
    await Promise.all([second, vi.runAllTimersAsync()]);
    expect(client.getPackageLabelTask).toHaveBeenCalledWith(22);
  });

  it('supports small labels and polls pending / in_progress without recreating the task', async () => {
    const client = clientFor();
    client.getPackageLabelTask
      .mockResolvedValueOnce({ status: { code: 'pending' } })
      .mockResolvedValueOnce({ status: { code: 'in_progress' } });
    const result = expect(fetchLabelAsync(client as any, ['posting-1', 'posting-2'], { taskType: 'small_label' })).resolves.toEqual(pdf);
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.createPackageLabelTasks).toHaveBeenCalledTimes(1);
    expect(client.getPackageLabelTask.mock.calls).toEqual([[21], [21], [21]]);
  });

  it('rejects completed partial batches and does not download or report all orders printed', async () => {
    const client = clientFor();
    client.getPackageLabelTask.mockResolvedValue({ status: {
      code: 'completed', postings_count: 2, printed_postings_count: 1,
      unprinted_postings: [{ posting_number: 'posting-2', message: 'not ready' }],
    }, file_url: 'https://cdn.ozon.ru/labels/test.pdf' });
    const result = expect(fetchLabelAsync(client as any, ['posting-1', 'posting-2'])).rejects.toThrow('posting-2');
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.fetchUrl).not.toHaveBeenCalled();
  });

  it('fails clearly if the requested size is not available', async () => {
    const client = clientFor();
    client.createPackageLabelTasks.mockResolvedValue({ tasks: [{ task_id: 21, task_type: 'small_label' }] });
    const result = expect(fetchLabelAsync(client as any, 'posting-1', { taskType: 'big_label' })).rejects.toThrow('普通面单');
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.fetchUrl).not.toHaveBeenCalled();
  });

  it('reports the official task error and stops polling', async () => {
    const client = clientFor();
    client.getPackageLabelTask.mockResolvedValue({ status: { code: 'error' }, error: { code: 'not_ready', message: '订单尚未组装' } });
    const result = expect(fetchLabelAsync(client as any, 'posting-1')).rejects.toThrow('订单尚未组装');
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.getPackageLabelTask).toHaveBeenCalledTimes(1);
    expect(client.fetchUrl).not.toHaveBeenCalled();
  });

  it('keeps polling bounded and never repeats create after a timeout', async () => {
    const client = clientFor();
    client.getPackageLabelTask.mockResolvedValue({ status: { code: 'pending' } });
    const result = expect(fetchLabelAsync(client as any, 'posting-1')).rejects.toThrow('超时');
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(client.getPackageLabelTask).toHaveBeenCalledTimes(15);
    expect(client.createPackageLabelTasks).toHaveBeenCalledTimes(1);
  });
});
