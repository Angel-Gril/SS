// Entry selection is a UI preference. Every command still uses the normal
// device/draft owner and its current server readback.
export function createPrecisionErpEntry(options) {
  let handledRequestId = '';
  return Object.freeze({
    async accept(entry) {
      if (!entry || typeof entry.requestId !== 'string' || !/^erp-entry-[1-9]\d{0,12}$/u.test(entry.requestId)
        || entry.requestId === handledRequestId || options.getProjection().busy) return;
      const context = entry.context;
      if (!context || context.contractVersion !== 'extension-byok-workbench-launch-context/v1'
        || typeof context.workflowId !== 'string' || !context.workflowId || context.workflowId.length > 200
        || !['draftRevision', 'draftVersion'].every(key => Number.isSafeInteger(context[key]) && context[key] > 0)) return;
      handledRequestId = entry.requestId;
      let accepted = false;
      try {
        if (options.isBusy()) throw new Error('请先保存当前编辑或核对原请求，再从 ERP 打开草稿');
        options.session.pinDraft(context);
        options.applySelection(context);
        accepted = true;
      } catch (error) { options.report(error); }
      try {
        await options.acknowledge({ entryRequestId: entry.requestId, workflowId: context.workflowId,
          draftRevision: context.draftRevision, draftVersion: context.draftVersion, accepted });
      } catch (error) { options.report(error); }
    },
  });
}
