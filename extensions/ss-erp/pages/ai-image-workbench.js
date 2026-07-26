(function initializeByokImageWorkbench(global) {
  'use strict';

  var clientApi = global.SS_ERP_BYOK_WORKBENCH_CLIENT;
  if (!clientApi || typeof clientApi.createClient !== 'function') return;

  function byId(id) {
    return document.getElementById(id);
  }

  var nodes = {
    pageStatus: byId('pageStatus'),
    contextSource: byId('contextSource'),
    contextShop: byId('contextShop'),
    contextDraft: byId('contextDraft'),
    contextSku: byId('contextSku'),
    contextKicker: byId('contextKicker'),
    contextBadge: byId('contextBadge'),
    executionModeByok: byId('executionModeByok'),
    executionModeHosted: byId('executionModeHosted'),
    profileSelect: byId('profileSelect'),
    profileSummary: byId('profileSummary'),
    promptInput: byId('promptInput'),
    negativePromptInput: byId('negativePromptInput'),
    sizeSelect: byId('sizeSelect'),
    generateButton: byId('generateButton'),
    resultPanel: byId('resultPanel'),
    emptyResult: byId('emptyResult'),
    previewImage: byId('previewImage'),
    previewMeta: byId('previewMeta'),
    resultStatus: byId('resultStatus'),
    rejectButton: byId('rejectButton'),
    approveButton: byId('approveButton'),
    approvedNotice: byId('approvedNotice'),
    refreshButton: byId('refreshButton'),
  };

  var client;
  try {
    client = clientApi.createClient({
      runtime: global.chrome && global.chrome.runtime,
      BroadcastChannel: global.BroadcastChannel,
      URL: global.URL,
      now: function () { return new Date(); },
    });
  } catch (_error) {
    return;
  }

  var state = {
    publicState: null,
    selectedProfileId: '',
    readiness: null,
    candidate: null,
    preview: null,
    previewEpoch: 0,
    previewReadyResultId: null,
    busy: false,
    unknownOutcome: false,
  };

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function setStatus(message, tone) {
    nodes.pageStatus.textContent = String(message || '');
    ['is-success', 'is-warning', 'is-error'].forEach(function (name) {
      nodes.pageStatus.classList.remove(name);
    });
    if (tone) nodes.pageStatus.classList.add('is-' + tone);
  }

  function setResultStatus(message, tone) {
    nodes.resultStatus.textContent = String(message || '');
    ['state-pending', 'state-ready', 'state-success', 'state-error'].forEach(function (name) {
      nodes.resultStatus.classList.remove(name);
    });
    nodes.resultStatus.classList.add('state-' + (tone || 'pending'));
  }

  function errorLabel(error) {
    var code = error && typeof error.code === 'string' ? error.code : '';
    var labels = {
      SS_ERP_BYOK_WORKBENCH_SESSION_NOT_FOUND: '工作台会话已失效，请从来源商品页重新打开。',
      SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED: '工作台页面已重新加载；为保护上下文，请从来源商品页重新打开。',
      SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE: 'ERP 草稿或目标槽位已变化，请从来源商品页重新打开。',
      SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH: '工作台上下文不一致，已阻止执行。',
      SS_ERP_BYOK_PROVIDER_KEY_REQUIRED: '当前档案没有可用的会话密钥，请先到 Provider 设置页加载。',
      SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED: '当前档案尚未获得精确 Provider 来源权限。',
      SS_ERP_BYOK_PROVIDER_CAPABILITY_REQUIRED: '当前模型缺少与管理员策略一致的文生图验证证据。',
      SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME: 'Provider 请求结果未知，系统不会自动重试；请刷新状态确认。',
      SS_ERP_BYOK_WORKBENCH_PREVIEW_TIMEOUT: '候选图预览通道已超时。',
      SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID: '候选图预览未通过安全校验。',
    };
    return labels[code] || '工作台操作失败，请刷新状态后重试。';
  }

  function profileRows() {
    return state.publicState && Array.isArray(state.publicState.profiles)
      ? state.publicState.profiles
      : [];
  }

  function selectedProfileRow() {
    return profileRows().find(function (row) {
      return row && row.profile && row.profile.id === state.selectedProfileId;
    }) || null;
  }

  function profileCanGenerate(row) {
    return Boolean(row && row.profile
      && Array.isArray(row.profile.allowedOperations)
      && row.profile.allowedOperations.includes('TEXT_TO_IMAGE')
      && row.hasKey === true
      && row.permissionState === 'GRANTED'
      && row.textToImageEvidence);
  }

  function readinessIsCurrent() {
    return Boolean(state.readiness && typeof state.readiness.expiresAt === 'string'
      && Date.parse(state.readiness.expiresAt) > Date.now() + 1000);
  }

  function renderContext(context) {
    nodes.contextKicker.textContent = '服务器已绑定';
    nodes.contextBadge.textContent = '精确草稿';
    ['state-pending', 'state-ready', 'state-error'].forEach(function (name) {
      nodes.contextBadge.classList.remove(name);
    });
    nodes.contextBadge.classList.add('state-ready');
    nodes.contextSource.textContent = context.sourcePlatform + ' · ' + context.sourceProductId;
    nodes.contextShop.textContent = context.shopId;
    nodes.contextDraft.textContent = context.workflowId
      + ' · r' + context.draftRevision + ' · v' + context.draftVersion;
    nodes.contextSku.textContent = context.skuKey
      + ' · 主图 · 追加位置 ' + (context.assignmentOrdinal + 1);
  }

  function clearContextView(label, unavailable) {
    var value = String(label || '不可用');
    nodes.contextKicker.textContent = unavailable ? '服务器绑定不可用' : '服务器绑定待确认';
    nodes.contextBadge.textContent = unavailable ? '上下文失效' : '正在验证';
    ['state-pending', 'state-ready', 'state-error'].forEach(function (name) {
      nodes.contextBadge.classList.remove(name);
    });
    nodes.contextBadge.classList.add(unavailable ? 'state-error' : 'state-pending');
    nodes.contextSource.textContent = value;
    nodes.contextShop.textContent = value;
    nodes.contextDraft.textContent = value;
    nodes.contextSku.textContent = value;
  }

  function renderProfileOptions() {
    var rows = profileRows();
    var options = rows.map(function (row) {
      var option = document.createElement('option');
      option.value = row.profile.id;
      option.textContent = row.profile.name + ' · ' + row.profile.model;
      return option;
    });
    if (!options.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '没有可用的 Provider 档案';
      options.push(empty);
      state.selectedProfileId = '';
    } else if (!rows.some(function (row) {
      return row.profile.id === state.selectedProfileId;
    })) {
      var preferred = rows.find(profileCanGenerate) || rows[0];
      state.selectedProfileId = preferred.profile.id;
    }
    nodes.profileSelect.replaceChildren.apply(nodes.profileSelect, options);
    nodes.profileSelect.value = state.selectedProfileId;
  }

  function renderProfileSummary() {
    var row = selectedProfileRow();
    if (!row) {
      nodes.profileSummary.textContent = '请先在 Provider 设置页创建档案并完成验证。';
      return;
    }
    var parts = [
      row.hasKey === true ? '会话密钥已加载' : '缺少会话密钥',
      row.permissionState === 'GRANTED' ? '来源已授权'
        : row.permissionState === 'REQUIRED' ? '来源未授权' : '来源权限不可确认',
      row.textToImageEvidence ? '能力证据有效' : '缺少有效能力证据',
    ];
    nodes.profileSummary.textContent = parts.join(' · ');
  }

  function renderControls() {
    var ready = profileCanGenerate(selectedProfileRow()) && readinessIsCurrent();
    var promptReady = String(nodes.promptInput.value || '').normalize('NFKC').trim().length > 0;
    var locked = state.busy || Boolean(state.candidate) || state.unknownOutcome;
    nodes.profileSelect.disabled = state.busy || Boolean(state.candidate) || !profileRows().length;
    nodes.promptInput.disabled = locked;
    nodes.negativePromptInput.disabled = locked;
    nodes.sizeSelect.disabled = locked;
    nodes.generateButton.disabled = locked || !ready || !promptReady;
    nodes.refreshButton.disabled = state.busy;
    nodes.rejectButton.disabled = state.busy || !state.candidate
      || state.candidate.reviewState !== 'CANDIDATE_READY';
    nodes.approveButton.disabled = nodes.rejectButton.disabled
      || state.previewReadyResultId !== state.candidate.resultId;
    renderProfileSummary();
  }

  function revokePreview() {
    var previous = state.preview;
    state.previewEpoch += 1;
    state.preview = null;
    state.previewReadyResultId = null;
    if (previous && typeof previous.revoke === 'function') {
      previous.revoke();
    }
    nodes.previewImage.src = '';
  }

  function clearResultView() {
    revokePreview();
    state.candidate = null;
    nodes.resultPanel.hidden = true;
    nodes.emptyResult.hidden = false;
    nodes.approvedNotice.hidden = true;
    nodes.previewMeta.textContent = '等待安全预览';
    setResultStatus('等待结果', 'pending');
  }

  async function showCandidate(candidate) {
    revokePreview();
    var previewEpoch = state.previewEpoch;
    state.candidate = candidate;
    nodes.resultPanel.hidden = false;
    nodes.emptyResult.hidden = true;
    nodes.approvedNotice.hidden = candidate.reviewState !== 'APPROVED';
    setResultStatus(
      candidate.reviewState === 'APPROVED'
        ? '已批准 · 尚未上传 ERP'
        : '等待审核',
      candidate.reviewState === 'APPROVED' ? 'success' : 'pending',
    );
    var preview;
    try {
      preview = await client.openPreview(candidate.resultId);
    } catch (_error) {
      if (previewEpoch === state.previewEpoch && state.candidate
        && state.candidate.resultId === candidate.resultId) {
        state.previewReadyResultId = null;
        nodes.previewMeta.textContent = '安全预览不可用';
        setResultStatus('预览不可用 · 可驳回删除', 'error');
        renderControls();
      }
      return false;
    }
    if (previewEpoch !== state.previewEpoch || !state.candidate
      || state.candidate.resultId !== candidate.resultId) {
      preview.revoke();
      return false;
    }
    state.preview = {
      ...preview,
      previewEpoch: previewEpoch,
      resultId: candidate.resultId,
    };
    state.previewReadyResultId = null;
    nodes.previewImage.src = preview.objectUrl;
    nodes.previewMeta.textContent = preview.metadata.mimeType
      + ' · ' + preview.metadata.byteLength + ' bytes · SHA-256 '
      + preview.metadata.sha256.slice(0, 12) + '…';
    return true;
  }

  async function refreshReadiness(options) {
    options = options || {};
    state.readiness = null;
    renderControls();
    var row = selectedProfileRow();
    if (!profileCanGenerate(row)) {
      if (!options.quiet) setStatus('当前 Provider 档案尚未完成本地准备。', 'warning');
      return false;
    }
    try {
      state.readiness = await client.getReadiness(state.selectedProfileId);
      if (!readinessIsCurrent()) throw new Error('readiness_expired');
      if (!options.quiet) setStatus('工作台已就绪。生成费用由所选 Provider 账户承担。', 'success');
      return true;
    } catch (error) {
      state.readiness = null;
      if (!options.quiet) setStatus(errorLabel(error), 'error');
      return false;
    } finally {
      renderControls();
    }
  }

  async function loadPublicState() {
    state.busy = true;
    renderControls();
    setStatus('正在重新验证工作台会话与 ERP 草稿...', '');
    clearContextView('正在重新验证', false);
    try {
      var next = await client.getPublicState();
      if (!isRecord(next) || next.contractVersion !== 'extension-byok-workbench-public-state/v1'
        || next.executionMode !== 'BYOK' || !isRecord(next.context)
        || !Array.isArray(next.profiles)
        || ![null, 'UNKNOWN_OUTCOME'].includes(next.generationOutcome)
        || (next.result && next.generationOutcome !== null)) {
        throw new Error('state_invalid');
      }
      state.publicState = next;
      state.unknownOutcome = next.generationOutcome === 'UNKNOWN_OUTCOME';
      renderContext(next.context);
      renderProfileOptions();
      if (next.result && isRecord(next.result)) {
        var previewAvailable = await showCandidate(next.result);
        if (!previewAvailable) {
          setStatus('候选图仍保留在扩展后台；预览不可用时只能驳回删除，不能批准。', 'warning');
        }
      } else {
        clearResultView();
        if (state.unknownOutcome) {
          setStatus('Provider 请求结果仍未知；刷新只会核对状态，不会重新提交或产生第二次扣费。', 'warning');
        }
      }
    } catch (error) {
      state.publicState = null;
      state.readiness = null;
      clearResultView();
      clearContextView('不可用', true);
      setStatus(errorLabel(error), 'error');
      throw error;
    } finally {
      state.busy = false;
      renderControls();
    }
  }

  function newIdempotencyKey() {
    var bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return 'wb_' + Array.from(bytes).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  async function generateCandidate() {
    var prompt = String(nodes.promptInput.value || '').normalize('NFKC').trim();
    var negativePrompt = String(nodes.negativePromptInput.value || '').normalize('NFKC').trim();
    if (!prompt || state.busy || state.candidate || state.unknownOutcome) return;
    if (!readinessIsCurrent() && !await refreshReadiness()) return;
    state.busy = true;
    renderControls();
    setStatus('Provider 正在生成候选图。请求超时后不会自动重试。', '');
    try {
      var candidate = await client.generate({
        profileId: state.selectedProfileId,
        prompt: prompt,
        negativePrompt: negativePrompt || null,
        size: nodes.sizeSelect.value,
        idempotencyKey: newIdempotencyKey(),
        readiness: state.readiness,
      });
      state.readiness = null;
      var previewAvailable = await showCandidate(candidate);
      setStatus(
        previewAvailable
          ? '候选图已生成。请先审核，批准不会直接上传或发布。'
          : '候选图已生成但预览不可用；可驳回删除，不能批准。',
        previewAvailable ? 'success' : 'warning',
      );
    } catch (error) {
      state.readiness = null;
      if (error && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME') {
        state.unknownOutcome = true;
      }
      setStatus(errorLabel(error), state.unknownOutcome ? 'warning' : 'error');
    } finally {
      state.busy = false;
      renderControls();
    }
  }

  async function reviewCandidate(decision) {
    if (state.busy || !state.candidate || state.candidate.reviewState !== 'CANDIDATE_READY') return;
    var candidateId = state.candidate.resultId;
    if (decision === 'APPROVE' && state.previewReadyResultId !== candidateId) return;
    state.busy = true;
    renderControls();
    try {
      var reviewed = await client.reviewResult(candidateId, decision);
      var expectedState = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (!isRecord(reviewed) || reviewed.resultId !== candidateId
        || reviewed.reviewState !== expectedState
        || (decision === 'APPROVE' && reviewed.deliveryState !== 'NOT_INGESTED')) {
        throw new Error('review_invalid');
      }
      if (decision === 'APPROVE') {
        state.candidate = { ...state.candidate, reviewState: 'APPROVED' };
        nodes.approvedNotice.hidden = false;
        setResultStatus('已批准 · 尚未上传 ERP', 'success');
        setStatus('候选图已批准，但媒体接收和草稿绑定仍未启用。', 'warning');
      } else {
        clearResultView();
        setStatus('候选图已驳回并从扩展临时存储中删除。', 'success');
        await refreshReadiness({ quiet: true });
      }
    } catch (error) {
      setStatus(errorLabel(error), 'error');
    } finally {
      state.busy = false;
      renderControls();
    }
  }

  nodes.profileSelect.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true || state.busy || state.candidate) return;
    state.selectedProfileId = String(nodes.profileSelect.value || '');
    state.readiness = null;
    void refreshReadiness();
  });
  nodes.promptInput.addEventListener('input', renderControls);
  nodes.negativePromptInput.addEventListener('input', renderControls);
  nodes.sizeSelect.addEventListener('change', renderControls);
  nodes.previewImage.addEventListener('load', function () {
    if (!state.preview || !state.candidate
      || state.preview.previewEpoch !== state.previewEpoch
      || state.preview.resultId !== state.candidate.resultId
      || nodes.previewImage.src !== state.preview.objectUrl
      || nodes.previewImage.complete !== true
      || nodes.previewImage.naturalWidth < 1
      || nodes.previewImage.naturalHeight < 1) return;
    state.previewReadyResultId = state.candidate.resultId;
    if (state.candidate.reviewState === 'CANDIDATE_READY') {
      setResultStatus('等待审核', 'pending');
    }
    renderControls();
  });
  nodes.previewImage.addEventListener('error', function () {
    if (!state.preview || nodes.previewImage.src !== state.preview.objectUrl) return;
    state.previewReadyResultId = null;
    setResultStatus('预览加载失败 · 可驳回删除', 'error');
    renderControls();
  });
  nodes.generateButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.generateButton.disabled) return;
    void generateCandidate();
  });
  nodes.rejectButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.rejectButton.disabled) return;
    void reviewCandidate('REJECT');
  });
  nodes.approveButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.approveButton.disabled) return;
    void reviewCandidate('APPROVE');
  });
  nodes.refreshButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.refreshButton.disabled) return;
    void loadPublicState().then(function () {
      return state.unknownOutcome ? null : refreshReadiness();
    }).catch(function () {});
  });
  global.addEventListener('pagehide', function () { revokePreview(); });

  void loadPublicState().then(function () {
    if (!state.candidate && !state.unknownOutcome) return refreshReadiness();
    return null;
  }).catch(function () {});
}(typeof globalThis !== 'undefined' ? globalThis : window));
