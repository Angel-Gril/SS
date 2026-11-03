// UI navigation only; all image commands still use the existing ERP owners.
export function resolveSuitePrimaryAction({draftId,busy,billing,lock,history}) {
  if(!draftId)return{action:'NONE',label:'请先采集并选择店铺',disabled:true};
  if(busy||lock?.status==='submitting')return{action:'NONE',label:'正在准备图片任务…',disabled:true};
  if(!billing?.suite&&!billing?.quote&&history?.state==='ready'&&history.listingWorkflowId===draftId
    &&history.items.some(item=>item.status==='SUCCEEDED'&&item.application?.state==='APPLIED'&&item.application.targetId===draftId))
    return{action:'REVIEW',label:'查看已应用图片',disabled:false};
  if(billing?.state!=='ready'||billing.listingWorkflowId!==draftId||(!billing.quote&&lock))
    return{action:'READ',label:'读取现有图片任务',disabled:false};
  if(!billing.quote)return{action:'PREPARE',label:'准备套图',disabled:false};
  if(!billing.suite)return{action:'START',label:'确认费用并生成',disabled:false};
  if(['SUCCEEDED','PARTIAL_FAILURE','FAILED','CANCELLED'].includes(billing.suite.status))
    return{action:'REVIEW',label:'查看图片结果',disabled:false};
  return{action:'CONTINUE',label:'继续图片任务',disabled:false};
}
