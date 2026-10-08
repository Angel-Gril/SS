const operationLabels = { TEXT_TO_IMAGE: '单图生成', IMAGE_TO_IMAGE: '参考图生成', FULL_EDIT: '全图修图', INPAINT: '圈选重绘' };

export function createByokEditor({ root, container, runtime, getShopId, getBinding, openSession, getBusy = () => false, onBound, onModeChange }) {
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const settings = runtime?.settings;
  const available = typeof runtime?.registerUi === 'function' && typeof settings?.listProfiles === 'function';
  let registered = false, profiles = [], selectedId = '', selectedState = null, permission = null, dirty = false, busy = false, prepared = null;
  let initialization = null, initializing = false, registrationError = '', profileOptions = '', editCatalog = '';
  let flow = null, flowConnecting = false, flowState = null, flowPreview = null, mode = '', generationError = '';
  let edit = null, editStateValue = null, editSelectedKeys = new Set(), editBusy = false, editError = '';
  const panel = make('div', 'precision-suite-actions'); panel.hidden = true;
  const panelState = make('span', '', '请配置自带 API。'); panelState.id = 'precision-byok-state';
  const configure = make('button', 'ghost', '配置自带 API'); configure.id = 'precision-byok-config';
  const reconnect = make('button', 'ghost', '重新连接扩展'); reconnect.id = 'precision-byok-reconnect';
  const profileSelect = make('select'); profileSelect.id = 'precision-byok-profile'; profileSelect.setAttribute('aria-label', '自带 API 档案');
  panel.append(panelState, profileSelect, configure, reconnect); container.append(panel);
  panelState.setAttribute('role', 'status');
  const generation = make('section', 'precision-byok-generation'); generation.id = 'precision-byok-generation'; generation.hidden = true;
  const generationHead = make('div', 'precision-byok-generation-head');
  generationHead.append(make('strong', '', '单图生成 · 当前草稿'), make('small', '', '候选图必须先预览、审核，再由 ERP 绑定到当前 SKU 草稿。'));
  const prompt = make('textarea', '', ''); prompt.id = 'precision-byok-generation-prompt'; prompt.placeholder = '输入图片方向，例如：保留商品结构，浅灰背景，柔和自然光'; prompt.setAttribute('aria-label', 'BYOK 单图提示词');
  const negative = make('textarea', '', ''); negative.id = 'precision-byok-generation-negative'; negative.placeholder = '可选：不要文字、水印、Logo'; negative.setAttribute('aria-label', 'BYOK 负面提示词');
  const controls = make('div', 'precision-byok-generation-controls');
  const size = make('select'); size.id = 'precision-byok-generation-size'; size.setAttribute('aria-label', 'BYOK 图片尺寸');
  for (const value of ['1024x1024', '1024x1536', '1536x1024']) { const option = make('option', '', value); option.value = value; size.append(option); }
  const generate = make('button', 'primary', '生成候选'); generate.id = 'precision-byok-generation-submit';
  const refreshGeneration = make('button', 'ghost', '读取状态'); refreshGeneration.id = 'precision-byok-generation-refresh';
  controls.append(size, generate, refreshGeneration);
  const preview = make('div', 'precision-byok-generation-preview'); preview.id = 'precision-byok-generation-preview';
  const image = make('img'); image.id = 'precision-byok-generation-image'; image.alt = 'BYOK 候选图'; image.hidden = true;
  const previewMeta = make('span', 'precision-byok-generation-meta'); previewMeta.id = 'precision-byok-generation-meta';
  const showPreview = make('button', 'ghost', '打开预览'); showPreview.id = 'precision-byok-generation-show-preview';
  const approve = make('button', 'ghost', '审核通过'); approve.id = 'precision-byok-generation-approve';
  const reject = make('button', 'ghost', '驳回候选'); reject.id = 'precision-byok-generation-reject';
  const ingest = make('button', 'primary', '应用到草稿'); ingest.id = 'precision-byok-generation-ingest';
  const actions = make('div', 'precision-byok-generation-actions'); actions.append(showPreview, approve, reject, ingest);
  const generationState = make('p', 'precision-byok-generation-state', '连接草稿后可开始单图生成。'); generationState.id = 'precision-byok-generation-state'; generationState.setAttribute('role', 'status');
  preview.append(image, previewMeta, actions);
  generation.append(generationHead, prompt, negative, controls, preview, generationState); container.append(generation);
  const editFlowPanel = make('section', 'precision-byok-edit-flow'); editFlowPanel.id = 'precision-byok-edit-flow'; editFlowPanel.hidden = true;
  const editHeading = make('div', 'precision-byok-generation-head'); editHeading.append(make('strong', '', '参考图生成'), make('small', '', '来源素材经 ERP 校验后才会进入编辑任务。'));
  const editOperation = make('select'); editOperation.id = 'precision-byok-edit-operation'; editOperation.setAttribute('aria-label', 'BYOK 编辑操作');
  for (const value of [['IMAGE_TO_IMAGE', '参考图生成'], ['FULL_EDIT', '全图修图'], ['INPAINT', '圈选重绘']]) { const option = make('option', '', value[1]); option.value = value[0]; editOperation.append(option); }
  const editSource = make('select'); editSource.id = 'precision-byok-edit-source'; editSource.setAttribute('aria-label', 'BYOK 来源图片');
  const editMaskFile = make('input'); editMaskFile.id = 'precision-byok-edit-mask'; editMaskFile.type = 'file'; editMaskFile.accept = 'image/png'; editMaskFile.hidden = true;
  const editSources = make('div', 'precision-byok-edit-sources'); editSources.id = 'precision-byok-edit-sources';
  const editPrompt = make('textarea'); editPrompt.id = 'precision-byok-edit-prompt'; editPrompt.placeholder = '输入参考图生成方向';
  const editActions = make('div', 'precision-byok-generation-actions');
  const editLoad = make('button', 'ghost', '读取来源素材'); editLoad.id = 'precision-byok-edit-load';
  const editStart = make('button', 'primary', '开始参考图生成'); editStart.id = 'precision-byok-edit-start';
  const editPreview = make('button', 'ghost', '预览候选'); editPreview.id = 'precision-byok-edit-preview';
  const editReview = make('button', 'primary', '交给 ERP 审核'); editReview.id = 'precision-byok-edit-review';
  const editState = make('p', 'precision-byok-generation-state', '读取来源素材后可选择 1-4 张参考图。'); editState.id = 'precision-byok-edit-state'; editState.setAttribute('role', 'status');
  editActions.append(editLoad, editStart, editPreview, editReview); editFlowPanel.append(editHeading, editOperation, editSource, editMaskFile, editSources, editPrompt, editActions, editState); container.append(editFlowPanel);
  const previewModal = make('div', 'preview-modal'); previewModal.id = 'precision-byok-preview-modal'; previewModal.hidden = true;
  const previewDialog = make('div', 'preview-dialog'), previewHead = make('div', 'preview-header');
  const closePreview = make('button', 'ghost', '关闭'); closePreview.id = 'precision-byok-preview-close';
  previewHead.append(make('strong', '', '当前 BYOK 候选 · 预览后返回审核'), closePreview);
  const previewBody = make('div', 'preview-body'), previewStage = make('div', 'preview-stage'), largeImage = make('img');
  largeImage.id = 'precision-byok-preview-image'; largeImage.alt = '当前 BYOK 候选大图';
  previewStage.append(largeImage); previewBody.append(previewStage); previewDialog.append(previewHead, previewBody); previewModal.append(previewDialog); root.append(previewModal);
  closePreview.addEventListener('click', () => { previewModal.hidden = true; });
  const modal = make('div', 'settings-modal'); modal.id = 'precision-byok-config-modal'; modal.hidden = true;
  const dialog = make('div', 'settings-dialog'), head = make('div', 'settings-head'); head.append(make('div', 'settings-title', '自带 API · 接口与当前会话密钥'));
  const close = make('button', 'ghost', '关闭'); close.id = 'precision-byok-config-close'; close.addEventListener('click', () => { key.value = ''; modal.hidden = true; }); head.append(close);
  const body = make('div', 'settings-body');
  const field = (id, label, placeholder, type = 'text') => {
    const row = make('label', 'field', label), input = make('input'); input.id = id; input.type = type; input.placeholder = placeholder; input.autocomplete = 'off';
    row.style.cssText = 'display:grid;gap:6px;'; row.append(input); body.append(row); return input;
  };
  const name = field('precision-byok-name', '接口名称', '我的生图接口');
  const endpoint = field('precision-byok-endpoint', '接口地址', 'https://api.example.com/v1');
  const model = field('precision-byok-model', '模型', '填写模型名称');
  const operations = make('div'); operations.append(make('strong', '', '启用的图片功能'));
  for (const [id, label] of Object.entries(operationLabels)) {
    const row = make('label', 'field'), input = make('input'); input.type = 'checkbox'; input.value = id; input.name = 'precision-byok-operation'; input.checked = id === 'TEXT_TO_IMAGE'; row.append(input, document.createTextNode(label)); operations.append(row);
  }
  const modes = make('p'); modes.id = 'precision-byok-request-modes';
  const save = make('button', 'primary', '保存接口配置'); save.id = 'precision-byok-save-profile';
  const fresh = make('button', 'ghost', '新增接口'); fresh.id = 'precision-byok-new-profile';
  body.append(operations, modes, save, fresh);
  const key = field('precision-byok-key', '当前浏览器会话 API Key', '仅加载到扩展当前会话', 'password');
  const setKey = make('button', 'primary', '加载会话密钥'); setKey.id = 'precision-byok-set-key';
  const clearKey = make('button', 'ghost', '清除会话密钥'); clearKey.id = 'precision-byok-clear-key';
  const prepare = make('button', 'ghost', '准备来源授权'); prepare.id = 'precision-byok-prepare-permission';
  const request = make('button', 'primary', '授权此接口来源'); request.id = 'precision-byok-request-permission';
  const state = make('p'); state.id = 'precision-byok-config-state'; state.setAttribute('role', 'status');
  body.append(setKey, clearKey, prepare, request, state); dialog.append(head, body); modal.append(dialog); root.append(modal);
  const selected = () => profiles.find((profile) => profile.id === selectedId);
  const flowApi = globalThis.SS_ERP_PRECISION_BYOK_FLOW;
  const editFlowApi = globalThis.SS_ERP_PRECISION_BYOK_EDIT_FLOW;
  function errorText(error) {
    if (error?.reasonCode) return { POLICY_DISABLED: 'ERP 尚未开放自带 API', OWNER_NOT_ALLOWED: '当前账号尚未获授权', SHOP_NOT_ALLOWED: '当前店铺尚未获授权', DEVICE_NOT_ALLOWED: '当前设备尚未获授权', ORIGIN_NOT_ALLOWED: '此接口来源尚未进入 ERP 允许列表', OPERATION_NOT_ALLOWED: '此图片能力尚未获授权', GENERATION_DISABLED: 'ERP 已关闭此图片能力' }[error.reasonCode] || '请重新核对 ERP 权限';
    return { SS_ERP_PRECISION_PRIVATE_RUNTIME_UNAVAILABLE: '请从已安装的 SS ERP 扩展打开工作台', SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID: '接口地址须为公开 HTTPS API 地址', SS_ERP_BYOK_PROFILE_INVALID: '请完整填写接口名称、地址、模型及图片功能',
      SS_ERP_PRECISION_UI_REGISTRATION_FAILED: '扩展注册失败，请确认商品页已完成采集、ERP 设备已配对，再重新连接扩展。',
      SS_ERP_PRECISION_UI_REGISTRATION_TIMEOUT: '扩展连接超时，请重新连接扩展；若仍无响应，请重新加载扩展和来源商品页。',
      SS_ERP_PRECISION_UI_REGISTRATION_REQUIRED: '请先重新连接扩展，再处理当前草稿图片。',
      SS_ERP_PRECISION_BYOK_CONTEXT_STALE: '商品、店铺或草稿已变化，请回到原任务读取状态。',
      SS_ERP_PRECISION_BYOK_INPUT_INVALID: '请填写有效提示词与图片尺寸。',
      SS_ERP_PRECISION_BYOK_PREVIEW_REQUIRED: '预览未成功加载，不能通过审核。',
      SS_ERP_PRECISION_BYOK_RESULT_PENDING: '原任务尚未处理完，请读取状态，不要再次生成。',
      SS_ERP_PRECISION_BYOK_RESPONSE_INVALID: '回执未通过当前草稿核验，请读取状态。',
      SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME: 'Provider 结果未知，请读取状态，不要再次生成。',
    }[error?.code || error?.message] || '操作未完成，请读取状态核对原任务。';
  }
  function render() {
    const flowView = flow?.state() || flowState;
    const working = busy || initializing || flowConnecting || Boolean(flowView?.busy) || getBusy();
    const settingsLocked = working || Boolean(flowView?.candidate) || Boolean(flowView?.readbackRequired) || Boolean(flowView?.generationUnknown);
    panel.hidden = mode !== 'byok';
    configure.disabled = !registered || settingsLocked; profileSelect.disabled = !registered || settingsLocked;
    reconnect.hidden = registered;
    reconnect.disabled = !available || working;
    save.disabled = !registered || settingsLocked; fresh.disabled = !registered || settingsLocked;
    setKey.disabled = !registered || settingsLocked || !selected() || dirty;
    clearKey.disabled = !registered || settingsLocked || !selectedState?.hasKey;
    prepare.disabled = !registered || settingsLocked || !selected() || dirty || !getShopId();
    request.disabled = !registered || !prepared || settingsLocked || dirty;
    modes.textContent = selectedState?.evidence?.length ? '已验证请求方式：' + selectedState.evidence.map((evidence) => `${operationLabels[evidence.operation] || evidence.operation} ${evidence.requestMode}`).join('、')
      : '请求方式由接口能力验证确定，可支持 JSON、multipart 或 async；尚无验证记录。';
    panelState.textContent = !available ? '自带 API 运行时未加载，请重新加载扩展和来源商品页。'
      : initializing ? '正在连接扩展，请稍候。'
      : !registered ? registrationError || '自带 API 尚未连接，请重新连接扩展。' : selected()
      ? `${selected().name} · ${selectedState?.hasKey ? '会话密钥已加载' : '等待会话密钥'} · ${permission?.granted ? '来源已授权' : '等待来源授权'}` : '请配置自带 API。';
    const canTextGenerate = Boolean(flowView?.ready && selected()?.allowedOperations?.includes('TEXT_TO_IMAGE') && selectedState?.hasKey && !dirty);
    generation.hidden = mode !== 'byok';
    const allowedEditOperations = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
    const editOperationsEnabled = allowedEditOperations.some((operation) => selected()?.allowedOperations?.includes(operation));
    editFlowPanel.hidden = mode !== 'byok' || !editOperationsEnabled;
    [...editOperation.options].forEach((option) => { option.disabled = !selected()?.allowedOperations?.includes(option.value); });
    if (editOperation.options[editOperation.selectedIndex]?.disabled) {
      const firstAllowed = [...editOperation.options].find((option) => !option.disabled);
      if (firstAllowed) editOperation.value = firstAllowed.value;
    }
    prompt.disabled = !registered || settingsLocked;
    negative.disabled = prompt.disabled;
    size.disabled = prompt.disabled;
    generate.disabled = !registered || !canTextGenerate || settingsLocked;
    refreshGeneration.disabled = !registered || working || !getBinding?.();
    refreshGeneration.textContent = flowView?.context ? '读取原任务状态' : '连接当前 SKU 图片会话';
    showPreview.disabled = !registered || working || !flowView?.ready || !flowView?.candidate || flowView.candidate.deliveryState !== 'NOT_INGESTED';
    approve.disabled = !registered || working || !flowView?.ready || !flowView?.candidate || !flowView.previewReady || flowView.candidate.reviewState !== 'CANDIDATE_READY' || Boolean(flowView.readbackRequired);
    reject.disabled = !registered || working || !flowView?.ready || !flowView?.candidate || flowView.candidate.deliveryState !== 'NOT_INGESTED' || Boolean(flowView.readbackRequired);
    ingest.disabled = !registered || working || !flowView?.ready || !flowView?.candidate || flowView.candidate.reviewState !== 'APPROVED' || flowView.candidate.deliveryState !== 'NOT_INGESTED' || Boolean(flowView.readbackRequired);
    if (flowView?.candidate?.deliveryState === 'BOUND') generationState.textContent = 'ERP 已将候选图规范化并绑定到当前草稿。';
    else if (flowView?.readbackRequired) generationState.textContent = '上次结果待核对；请读取状态，不会自动重试或重复扣费。';
    else if (flowView?.generationUnknown) generationState.textContent = 'Provider 结果未知；请读取状态，不要再次生成。';
    else if (flowView?.candidate?.reviewState === 'APPROVED') generationState.textContent = '候选已审核，确认应用后才会写入当前草稿。';
    else if (flowView?.candidate) generationState.textContent = '候选已生成，请先查看预览并审核。';
    else if (!flowView?.ready) generationState.textContent = '请从当前来源草稿打开图片会话后读取状态。';
    else if (!selectedState?.hasKey) generationState.textContent = '请先加载当前浏览器会话密钥。';
    else generationState.textContent = '提示词仅用于本次 BYOK 候选；ERP 仍负责当前草稿绑定。';
    if (generationError) generationState.textContent = generationError;
    else if (working) generationState.textContent = '正在处理，请等待当前操作完成。';
    if (!flowView?.ready || !flowView?.candidate || flowView.candidate.deliveryState === 'BOUND') {
      flowPreview = null; image.removeAttribute('src'); largeImage.removeAttribute('src'); previewModal.hidden = true;
    }
    image.hidden = !flowPreview?.objectUrl;
    if (flowPreview?.objectUrl && image.src !== flowPreview.objectUrl) image.src = flowPreview.objectUrl;
    previewMeta.textContent = flowView?.candidate ? `${flowView.candidate.reviewState} · ${flowView.candidate.deliveryState}` : '';
    const editView = editStateValue;
    editLoad.disabled = !registered || working || !editFlowApi || !getBinding?.();
    const editOperationValue = editOperation.value;
    editMaskFile.hidden = editOperationValue !== 'INPAINT';
    editStart.disabled = !registered || working || editBusy || !editView?.connected || !editPrompt.value.trim()
      || editOperationValue === 'IMAGE_TO_IMAGE' && (editSelectedKeys.size < 1 || editSelectedKeys.size > 4)
      || editOperationValue !== 'IMAGE_TO_IMAGE' && !editSource.value
      || editOperationValue === 'INPAINT' && !editMaskFile.files?.[0];
    if (editError) editState.textContent = editError;
    else if (editView?.handoff) editState.textContent = '已交给 ERP 编辑审核 owner，等待审核回执。';
    else if (editView?.candidate) editState.textContent = '参考图候选已生成，可先预览再交给 ERP 审核。';
    else if (editView?.connected) editState.textContent = `已选择 ${editSelectedKeys.size} 张参考图。`;
    else editState.textContent = '读取来源素材后可选择 1-4 张参考图。';
    const catalog = editView?.catalog || [];
    const catalogProjection = JSON.stringify(catalog.map(item => [item.sourceMediaKey, item.label]));
    if (editCatalog !== catalogProjection) {
      const selectedSource = editSource.value;
      editCatalog = catalogProjection;
      editSources.replaceChildren(...catalog.map(item => {
        const label = make('label', 'precision-byok-edit-source'); const input = make('input'); input.type = 'checkbox'; input.value = item.sourceMediaKey; input.checked = editSelectedKeys.has(item.sourceMediaKey);
        input.addEventListener('change', () => { if (input.checked) editSelectedKeys.add(item.sourceMediaKey); else editSelectedKeys.delete(item.sourceMediaKey); render(); });
        label.append(input, make('span', '', item.label)); return label;
      }));
      editSource.replaceChildren(...catalog.map(item => { const option = make('option', '', item.label); option.value = item.sourceMediaKey; return option; }));
      editSource.value = catalog.some(item => item.sourceMediaKey === selectedSource) ? selectedSource : catalog[0]?.sourceMediaKey || '';
    }
    const editCandidateAttempt = editView?.snapshot?.alternatives?.find(item => item.state === 'CANDIDATE_READY' && item.candidateId);
    editPreview.disabled = !registered || working || editBusy || !editCandidateAttempt;
    editReview.disabled = !registered || working || editBusy || !editView?.candidate || editView.candidate.state !== 'CANDIDATE_READY';
  }
  function fill(profile) {
    name.value = profile?.name || ''; endpoint.value = profile?.baseUrl || ''; model.value = profile?.model || ''; key.value = '';
    operations.querySelectorAll('input').forEach((input) => { input.checked = profile ? profile.allowedOperations.includes(input.value) : input.value === 'TEXT_TO_IMAGE'; });
    dirty = false; prepared = null;
  }
  async function refresh() {
    if (!registered) return;
    const listed = await settings.listProfiles(); profiles = listed.profiles || [];
    if (!profiles.some((profile) => profile.id === selectedId)) selectedId = profiles[0]?.id || '';
    const optionsProjection = JSON.stringify(profiles.map(profile => [profile.id, profile.name]));
    if (profileOptions !== optionsProjection) {
      profileOptions = optionsProjection;
      profileSelect.replaceChildren(...profiles.map((profile) => { const option = make('option', '', profile.name); option.value = profile.id; return option; }));
    }
    profileSelect.value = selectedId;
    if (selected()) {
      selectedState = await settings.getProfileState(selectedId); permission = await settings.getPermissionStatus(selectedId);
    } else { selectedState = permission = null; }
    if (!dirty) fill(selected()); render();
  }
  async function act(run) {
    if (busy || getBusy()) return;
    busy = true; render();
    try { await run(); }
    catch (error) { state.textContent = errorText(error); }
    finally { busy = false; render(); }
  }
  async function registerRuntime() {
    try {
      const reply = await runtime.registerUi();
      if (reply?.registered !== true) throw new Error('SS_ERP_PRECISION_UI_REGISTRATION_FAILED');
      registered = true; registrationError = '';
      return reply;
    } catch (error) {
      registered = false; registrationError = errorText(error);
      throw error;
    }
  }
  function initialize() {
    if (initialization) return initialization;
    if (registered) return Promise.resolve(true);
    if (!available) { render(); return Promise.resolve(false); }
    initializing = true; registrationError = ''; render();
    initialization = (async () => {
      try { await registerRuntime(); await refresh(); return true; }
      catch (error) { registered = false; registrationError = errorText(error); state.textContent = registrationError; return false; }
      finally { initializing = false; initialization = null; render(); }
    })();
    return initialization;
  }
  reconnect.addEventListener('click', event => { if (event.isTrusted && !reconnect.disabled) void initialize(); });
  for (const input of [name, endpoint, model, ...operations.querySelectorAll('input')]) input.addEventListener('input', () => { dirty = true; prepared = null; settings?.invalidatePreparedPermissions(); render(); });
  configure.addEventListener('click', (event) => { if (event.isTrusted && !configure.disabled) void act(async () => { modal.hidden = false; await refresh(); state.textContent = '配置与密钥分开保存；选择图片任务后再确认执行。'; }); });
  fresh.addEventListener('click', (event) => { if (!event.isTrusted || fresh.disabled) return; selectedId = ''; selectedState = permission = null; fill(null); render(); });
  profileSelect.addEventListener('change', () => { selectedId = profileSelect.value; dirty = false; key.value = ''; prepared = null; void act(refresh); });
  save.addEventListener('click', (event) => {
    if (!event.isTrusted || save.disabled) return;
    void act(async () => {
      const profile = { id: selectedId || 'precision-profile-' + crypto.randomUUID(), name: name.value.trim(), baseUrl: endpoint.value.trim(), model: model.value.trim(),
        allowedOperations: [...operations.querySelectorAll('input:checked')].map((input) => input.value), preferences: { defaultSize: '1024x1024', quality: 'auto', outputFormat: 'png' } };
      const result = await settings.saveProfile(profile); selectedId = result.profile.id; selectedState = result; dirty = false; prepared = null; key.value = '';
      await refresh(); state.textContent = result.rebound ? '地址或模型已更新，旧密钥与验证记录已清除。' : '接口配置已保存，尚未执行能力测试或生图。';
    });
  });
  setKey.addEventListener('click', (event) => {
    if (!event.isTrusted || setKey.disabled) return;
    let secret = key.value; key.value = '';
    void act(async () => {
      try { const pending = settings.setSessionKey(selectedId, secret); secret = ''; selectedState = await pending; state.textContent = '会话密钥已加载，表单已清空。'; }
      finally { secret = ''; key.value = ''; }
    });
  });
  clearKey.addEventListener('click', (event) => { if (event.isTrusted && !clearKey.disabled) void act(async () => { selectedState = await settings.clearSessionKey(selectedId); key.value = ''; state.textContent = '会话密钥与能力记录已清除。'; }); });
  prepare.addEventListener('click', (event) => { if (!event.isTrusted || prepare.disabled) return; void act(async () => {
    const operation = selected().allowedOperations[0];
    const readiness = await settings.getReadiness({ profileId: selectedId, shopId: getShopId(), operation });
    prepared = await settings.preparePermission({ profileId: selectedId, operation, readiness });
    state.textContent = `已准备 ${new URL(selected().baseUrl).origin} 的来源授权，请明确点击授权。`;
  }); });
  request.addEventListener('click', (event) => {
    if (!event.isTrusted || request.disabled) return;
    const readiness = prepared; prepared = null;
    let pending;
    try { pending = settings.requestPermissionFromGesture({ profile: selected(), shopId: getShopId(), operation: selected().allowedOperations[0], readiness, event }); }
    catch (error) { state.textContent = errorText(error); render(); return; }
    void act(async () => { await pending; permission = await settings.getPermissionStatus(selectedId); state.textContent = permission.granted ? '此接口精确来源已授权。' : '来源授权未完成。'; });
  });
  async function ensureFlow() {
    if (!registered) throw new Error('SS_ERP_PRECISION_UI_REGISTRATION_REQUIRED');
    if (!flowApi || !runtime?.media || typeof getBinding !== 'function' || typeof openSession !== 'function') throw Object.assign(new Error('SS_ERP_PRECISION_BYOK_FLOW_UNAVAILABLE'), { code: 'SS_ERP_PRECISION_BYOK_FLOW_UNAVAILABLE' });
    if (!flow) {
      flow = flowApi.createController({
        media: runtime.media,
        registerUi: registerRuntime,
        openSession,
        getBinding,
        newOperationKey: () => 'precision-byok-' + crypto.randomUUID(),
        onChange: (next) => { flowState = next; render(); },
      });
    }
    if (!flow.state().context) {
      flowConnecting = true; render();
      try { await flow.connect(); } finally { flowConnecting = false; flowState = flow.state(); render(); }
    }
    return flow;
  }
  async function ensureEditFlow() {
    if (!registered) throw new Error('SS_ERP_PRECISION_UI_REGISTRATION_REQUIRED');
    if (!editFlowApi || !runtime?.media || typeof getBinding !== 'function' || typeof openSession !== 'function') throw Object.assign(new Error('SS_ERP_PRECISION_BYOK_EDIT_FLOW_UNAVAILABLE'), { code: 'SS_ERP_PRECISION_BYOK_EDIT_FLOW_UNAVAILABLE' });
    if (!edit) edit = editFlowApi.createController({ media: runtime.media, getBinding, onChange: next => { editStateValue = next; render(); } });
    if (!editStateValue?.connected) editStateValue = await edit.connect();
    return edit;
  }
  async function mediaAct(run) {
    if (!registered || busy || getBusy()) return;
    busy = true; generationError = ''; render();
    try { await run(); }
    catch (error) { generationError = errorText(error); }
    finally { busy = false; render(); }
  }
  async function openCandidatePreview(show = true) {
    const opened = await flow.preview();
    flowPreview = opened; image.src = largeImage.src = opened.objectUrl;
    image.hidden = false;
    if (show) previewModal.hidden = false;
    try { await largeImage.decode(); flow.confirmPreview(opened.resultId); }
    catch (error) { flow.closePreview(); flowPreview = null; image.removeAttribute('src'); largeImage.removeAttribute('src'); throw error; }
    render();
  }
  generate.addEventListener('click', (event) => {
    if (!event.isTrusted || generate.disabled) return;
    void mediaAct(async () => {
      const active = await ensureFlow();
      const confirmed = globalThis.confirm(`使用 ${selected().name} 生成一张 BYOK 候选图？ERP 不收取 AI 托管费用，但 Provider 可能收费。`);
      if (!confirmed) return;
      await active.generate({ profileId: selectedId, prompt: prompt.value.normalize('NFKC').trim(), negativePrompt: negative.value.normalize('NFKC').trim(), size: size.value, chargeConfirmed: true });
      await openCandidatePreview();
    });
  });
  async function readMediaState() {
    if (!registered && !await initialize()) return;
    return mediaAct(async () => {
      await ensureFlow(); flowState = await flow.refresh();
      if (flowState.candidate?.deliveryState === 'BOUND') await onBound?.(flowState);
    });
  }
  refreshGeneration.addEventListener('click', (event) => { if (event.isTrusted && !refreshGeneration.disabled) void readMediaState(); });
  editLoad.addEventListener('click', event => { if (!event.isTrusted || editLoad.disabled) return; void mediaAct(async () => { try { editError = ''; const active = await ensureEditFlow(); editStateValue = await active.loadCatalog(); } catch (error) { editError = errorText(error); throw error; } }); });
  editStart.addEventListener('click', event => { if (!event.isTrusted || editStart.disabled) return; void mediaAct(async () => {
    const active = await ensureEditFlow(); const operation = editOperation.value; let sourceHandle = null; let maskHandle = null;
    if (operation === 'IMAGE_TO_IMAGE') editStateValue = await active.setReferences([...editSelectedKeys]);
    else { editStateValue = await active.setSource(editSource.value); sourceHandle = editStateValue.source.mediaHandle;
      if (operation === 'INPAINT') { editStateValue = await active.setMaskBlob(editMaskFile.files[0]); maskHandle = editStateValue.mask.mediaHandle; } }
    editStateValue = await active.start({ profileId: selectedId, operation, prompt: editPrompt.value.normalize('NFKC').trim(), size: size.value, sourceHandle, maskHandle });
  }); });
  editPreview.addEventListener('click', event => { if (!event.isTrusted || editPreview.disabled) return; void mediaAct(async () => { const active = await ensureEditFlow(); const attempt = editStateValue?.snapshot?.alternatives?.find(item => item.state === 'CANDIDATE_READY'); if (!attempt) throw new Error('没有可预览的参考图候选'); editStateValue = await active.select(attempt.attemptId); editStateValue = await active.openCandidate(attempt.attemptId); }); });
  editReview.addEventListener('click', event => { if (!event.isTrusted || editReview.disabled) return; void mediaAct(async () => { editStateValue = await edit.prepareReview(); }); });
  editPrompt.addEventListener('input', render);
  editOperation.addEventListener('change', render);
  editSource.addEventListener('change', render);
  editMaskFile.addEventListener('change', render);
  showPreview.addEventListener('click', (event) => { if (event.isTrusted && !showPreview.disabled) void mediaAct(() => openCandidatePreview()); });
  approve.addEventListener('click', (event) => { if (event.isTrusted && !approve.disabled) void mediaAct(async () => { flowState = await flow.review('APPROVE'); }); });
  reject.addEventListener('click', (event) => { if (event.isTrusted && !reject.disabled) void mediaAct(async () => { flowState = await flow.review('REJECT'); flowPreview = null; }); });
  ingest.addEventListener('click', (event) => { if (event.isTrusted && !ingest.disabled) void mediaAct(async () => { flowState = await flow.ingest(); flowPreview = null; await onBound?.(flowState); }); });
  render();
  return {
    panel, configure, reconnect, render, readMediaState, initialize,
    async openSettings() {
      if (!registered && !await initialize()) throw new Error('请重新连接扩展后配置自带 API');
      await act(async () => { modal.hidden = false; await refresh(); state.textContent = '接口和密钥在当前扩展会话配置；图片模型与商品分析模型分别选择。'; });
    },
    setMode(value) { mode = value; onModeChange(value); render(); },
    // ERP entry must wait for a pending media mutation, candidate, unknown
    // outcome, or unsaved media edit, but read-only registration/profile
    // initialization does not replace a draft or change its owner.
    hasPendingMedia: () => {
      const flowView = flow?.state() || flowState;
      return busy || Boolean(flowView?.busy || flowView?.candidate || flowView?.readbackRequired
        || flowView?.generationUnknown || editBusy || editStateValue?.candidate);
    },
    isBusy: () => busy || initializing || Boolean(flow?.state().busy),
    invalidate() { flow?.invalidate(); generationError = ''; render(); },
    state: () => ({ registered, initializing, available, selectedProfileId: selectedId, hasKey: selectedState?.hasKey === true }),
  };
}
