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
    previewFrame: byId('previewFrame'),
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
    previewExpiryTimer: null,
    busy: false,
    unknownOutcome: false,
    lifecycleEpoch: 0,
    authoritativeReloadPending: false,
  };

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function lifecycleIsCurrent(lifecycleEpoch) {
    return state.lifecycleEpoch === lifecycleEpoch;
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
      SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME: 'ERP 接收结果暂时未知；请使用同一候选图重新核对，不会生成新图。',
      SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED: 'ERP 已响应，但本地绑定状态尚未保存；请重试接收以核对同一回执。',
      SS_ERP_BYOK_INGEST_BINDING_MISMATCH: '候选图与当前草稿目标不一致，已阻止接收。',
      SS_ERP_BYOK_INGEST_RECEIPT_PENDING: 'ERP 仍在处理同一张图片；稍后再次核对回执即可。',
      SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED: 'ERP 尚未开始提交；系统会先核对同一幂等回执，仅当服务端确认没有活动中的接收尝试时，才可能重新发送同一图片字节。',
      SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND: 'ERP 未找到本次接收授权；正在恢复为可重新接收状态。',
      SS_ERP_BYOK_INGEST_RECEIPT_FAILED: 'ERP 已确认本次接收失败；该接收身份不可重用，候选图已清除，请重新生成。',
      SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED: '本地缺少精确接收身份；正在重新核对候选图状态。',
      SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE: 'ERP 回执暂时无法核对，请稍后重试。',
      SS_ERP_BYOK_INGEST_RECOVERY_REJECTED: 'ERP 已终止本次接收恢复；正在重新核对候选图状态。',
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

  function readinessIsCurrent(value) {
    var current = arguments.length > 0 ? value : state.readiness;
    return Boolean(current && typeof current.expiresAt === 'string'
      && Date.parse(current.expiresAt) > Date.now() + 1000);
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
    var candidateReady = Boolean(state.candidate
      && state.candidate.reviewState === 'CANDIDATE_READY');
    var approved = Boolean(state.candidate
      && state.candidate.reviewState === 'APPROVED'
      && state.candidate.deliveryState === 'NOT_INGESTED');
    var ingesting = Boolean(state.candidate
      && state.candidate.deliveryState === 'INGESTING');
    var bound = Boolean(state.candidate && state.candidate.deliveryState === 'BOUND');
    nodes.rejectButton.disabled = state.busy || (!candidateReady && !approved) || ingesting || bound;
    nodes.rejectButton.textContent = approved ? '删除临时图' : '驳回并删除';
    nodes.approveButton.textContent = bound
      ? '已绑定 ERP' : ingesting
        ? '核对 ERP 回执' : approved ? '接收并绑定 ERP' : '批准候选图';
    nodes.approveButton.disabled = state.busy || bound
      || (candidateReady && state.previewReadyResultId !== state.candidate.resultId)
      || (!candidateReady && !approved && !ingesting);
    renderProfileSummary();
  }

  function revokePreview() {
    var previous = state.preview;
    if (state.previewExpiryTimer !== null) {
      clearTimeout(state.previewExpiryTimer);
      state.previewExpiryTimer = null;
    }
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
    nodes.previewFrame.hidden = false;
    nodes.approvedNotice.hidden = true;
    nodes.previewMeta.textContent = '等待安全预览';
    setResultStatus('等待结果', 'pending');
  }

  function handlePreviewExpiry(resultId, lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch) || !state.candidate
      || state.candidate.resultId !== resultId) return;
    if (state.busy) {
      state.authoritativeReloadPending = true;
      revokePreview();
      nodes.previewMeta.textContent = '预览已过期 · 操作完成后核对状态';
      return;
    }
    clearResultView();
    setStatus('候选图已过期并从页面临时预览中清除。', 'warning');
    renderControls();
  }

  async function showCandidate(candidate, expectedLifecycleEpoch) {
    var lifecycleEpoch = Number.isSafeInteger(expectedLifecycleEpoch)
      ? expectedLifecycleEpoch
      : state.lifecycleEpoch;
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    if (candidate && candidate.deliveryState === 'BOUND' && isRecord(candidate.ingest)) {
      revokePreview();
      state.candidate = candidate;
      nodes.resultPanel.hidden = false;
      nodes.emptyResult.hidden = true;
      nodes.previewFrame.hidden = true;
      nodes.approvedNotice.hidden = false;
      nodes.approvedNotice.textContent = 'ERP 回执 ' + candidate.ingest.receiptId
        + ' · 已绑定草稿 v' + candidate.ingest.boundDraftVersion
        + ' · 资源 ' + candidate.ingest.assetId;
      setResultStatus('已绑定 ERP', 'success');
      setStatus('图片已绑定 ERP 草稿；Ozon 发布仍未执行。', 'success');
      renderControls();
      return true;
    }
    if (candidate && candidate.deliveryState === 'INGESTING') {
      revokePreview();
      state.candidate = candidate;
      nodes.resultPanel.hidden = false;
      nodes.emptyResult.hidden = true;
      nodes.previewFrame.hidden = true;
      nodes.approvedNotice.hidden = false;
      nodes.approvedNotice.textContent = '系统会先核对同一幂等回执；仅当服务端确认没有活动中的接收尝试时，才可能重新发送同一图片字节。不会重新生成或直接发布。';
      setResultStatus('等待 ERP 回执', 'pending');
      setStatus('图片接收结果尚待核对；系统会按同一幂等身份核对或恢复。', 'warning');
      renderControls();
      return true;
    }
    revokePreview();
    var previewEpoch = state.previewEpoch;
    var expiresAt = candidate && typeof candidate.expiresAt === 'string'
      ? Date.parse(candidate.expiresAt)
      : NaN;
    var current = Date.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= current) {
      clearResultView();
      setStatus('候选图已过期并从页面临时预览中清除。', 'warning');
      return false;
    }
    state.candidate = candidate;
    nodes.resultPanel.hidden = false;
    nodes.emptyResult.hidden = true;
    nodes.previewFrame.hidden = false;
    nodes.approvedNotice.hidden = candidate.reviewState !== 'APPROVED';
    if (candidate.reviewState === 'APPROVED') {
      nodes.approvedNotice.textContent = '候选图已批准。点击“接收并绑定 ERP”后，图片才会进入服务端规范化和精确草稿绑定。';
    }
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
      if (lifecycleIsCurrent(lifecycleEpoch)
        && previewEpoch === state.previewEpoch && state.candidate
        && state.candidate.resultId === candidate.resultId) {
        state.previewReadyResultId = null;
        nodes.previewMeta.textContent = '安全预览不可用';
        setResultStatus('预览不可用 · 可驳回删除', 'error');
        renderControls();
      }
      return false;
    }
    if (!lifecycleIsCurrent(lifecycleEpoch) || previewEpoch !== state.previewEpoch || !state.candidate
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
    var remainingPreviewLifetime = expiresAt - Date.now();
    if (remainingPreviewLifetime <= 0) {
      preview.revoke();
      clearResultView();
      setStatus('候选图已过期并从页面临时预览中清除。', 'warning');
      return false;
    }
    nodes.previewImage.src = preview.objectUrl;
    state.previewExpiryTimer = setTimeout(function () {
      handlePreviewExpiry(candidate.resultId, lifecycleEpoch);
    }, remainingPreviewLifetime);
    nodes.previewMeta.textContent = preview.metadata.mimeType
      + ' · ' + preview.metadata.byteLength + ' bytes · SHA-256 '
      + preview.metadata.sha256.slice(0, 12) + '…';
    setStatus(
      candidate.reviewState === 'APPROVED'
        ? '候选图已批准但尚未接收。请确认后点击“接收并绑定 ERP”。'
        : '候选图已生成。请先审核，批准不会直接上传或发布。',
      candidate.reviewState === 'APPROVED' ? 'warning' : 'success',
    );
    return true;
  }

  async function refreshReadiness(options) {
    options = options || {};
    var lifecycleEpoch = Number.isSafeInteger(options.lifecycleEpoch)
      ? options.lifecycleEpoch
      : state.lifecycleEpoch;
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    state.readiness = null;
    renderControls();
    var row = selectedProfileRow();
    var profileId = state.selectedProfileId;
    if (!profileCanGenerate(row)) {
      if (!options.quiet) setStatus('当前 Provider 档案尚未完成本地准备。', 'warning');
      return false;
    }
    try {
      var readiness = await client.getReadiness(profileId);
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId) return false;
      if (!readinessIsCurrent(readiness)) throw new Error('readiness_expired');
      state.readiness = readiness;
      if (!options.quiet) setStatus('工作台已就绪。生成费用由所选 Provider 账户承担。', 'success');
      return true;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId) return false;
      state.readiness = null;
      if (!options.quiet) setStatus(errorLabel(error), 'error');
      return false;
    } finally {
      if (lifecycleIsCurrent(lifecycleEpoch) && state.selectedProfileId === profileId) {
        renderControls();
      }
    }
  }

  function finishBusyOperation(lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    state.busy = false;
    var reload = state.authoritativeReloadPending;
    state.authoritativeReloadPending = false;
    renderControls();
    if (reload) void reloadAuthoritativeState(lifecycleEpoch);
    return reload;
  }

  async function reloadAuthoritativeState(lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    try {
      var loaded = await loadPublicState(lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch) || !loaded) return false;
      if (!state.candidate && !state.unknownOutcome) {
        await refreshReadiness({ quiet: true, lifecycleEpoch: lifecycleEpoch });
        if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function loadPublicState(expectedLifecycleEpoch) {
    var lifecycleEpoch = Number.isSafeInteger(expectedLifecycleEpoch)
      ? expectedLifecycleEpoch
      : state.lifecycleEpoch;
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    var loaded = false;
    state.busy = true;
    renderControls();
    setStatus('正在重新验证工作台会话与 ERP 草稿...', '');
    clearContextView('正在重新验证', false);
    try {
      var next = await client.getPublicState();
      if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
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
        var previewAvailable = await showCandidate(next.result, lifecycleEpoch);
        if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
        if (!previewAvailable) {
          setStatus('候选图仍保留在扩展后台；预览不可用时只能驳回删除，不能批准。', 'warning');
        }
      } else {
        clearResultView();
        if (state.unknownOutcome) {
          setStatus('Provider 请求结果仍未知；刷新只会核对状态，不会重新提交或产生第二次扣费。', 'warning');
        }
      }
      loaded = true;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
      state.publicState = null;
      state.readiness = null;
      state.authoritativeReloadPending = false;
      clearResultView();
      clearContextView('不可用', true);
      setStatus(errorLabel(error), 'error');
      throw error;
    } finally {
      if (finishBusyOperation(lifecycleEpoch)) loaded = false;
    }
    return loaded;
  }

  function newIdempotencyKey() {
    var bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return 'wb_' + Array.from(bytes).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  async function generateCandidate() {
    var lifecycleEpoch = state.lifecycleEpoch;
    var profileId = state.selectedProfileId;
    var prompt = String(nodes.promptInput.value || '').normalize('NFKC').trim();
    var negativePrompt = String(nodes.negativePromptInput.value || '').normalize('NFKC').trim();
    if (!prompt || state.busy || state.candidate || state.unknownOutcome) return;
    if (!readinessIsCurrent()) {
      var ready = await refreshReadiness({ lifecycleEpoch: lifecycleEpoch });
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId || !ready) return;
    }
    state.busy = true;
    renderControls();
    setStatus('Provider 正在生成候选图。请求超时后不会自动重试。', '');
    try {
      var candidate = await client.generate({
        profileId: profileId,
        prompt: prompt,
        negativePrompt: negativePrompt || null,
        size: nodes.sizeSelect.value,
        idempotencyKey: newIdempotencyKey(),
        readiness: state.readiness,
      });
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId) return;
      state.readiness = null;
      candidate = { ...candidate, deliveryState: candidate.deliveryState || 'NOT_INGESTED' };
      var previewAvailable = await showCandidate(candidate, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus(
        previewAvailable
          ? '候选图已生成。请先审核，批准不会直接上传或发布。'
          : '候选图已生成但预览不可用；可驳回删除，不能批准。',
        previewAvailable ? 'success' : 'warning',
      );
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      state.readiness = null;
      if (error && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME') {
        state.unknownOutcome = true;
      }
      setStatus(errorLabel(error), state.unknownOutcome ? 'warning' : 'error');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function reviewCandidate(decision) {
    if (state.busy || !state.candidate
      || !['CANDIDATE_READY', 'APPROVED'].includes(state.candidate.reviewState)
      || (decision === 'APPROVE' && state.candidate.reviewState !== 'CANDIDATE_READY')) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    var candidateId = state.candidate.resultId;
    if (decision === 'APPROVE' && state.previewReadyResultId !== candidateId) return;
    state.busy = true;
    renderControls();
    try {
      var reviewed = await client.reviewResult(candidateId, decision);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      var expectedState = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (!isRecord(reviewed) || reviewed.resultId !== candidateId
        || reviewed.reviewState !== expectedState
        || (decision === 'APPROVE' && reviewed.deliveryState !== 'NOT_INGESTED')) {
        throw new Error('review_invalid');
      }
      if (decision === 'APPROVE') {
        state.candidate = {
          ...state.candidate,
          reviewState: 'APPROVED',
          deliveryState: 'NOT_INGESTED',
        };
        nodes.approvedNotice.hidden = false;
        nodes.approvedNotice.textContent = '候选图已批准。点击“接收并绑定 ERP”后，图片才会进入服务端规范化和精确草稿绑定。';
        setResultStatus('已批准 · 尚未上传 ERP', 'success');
        setStatus('候选图已批准但尚未接收。请确认后点击“接收并绑定 ERP”。', 'warning');
      } else {
        clearResultView();
        setStatus('候选图已驳回并从扩展临时存储中删除。', 'success');
        await refreshReadiness({ quiet: true, lifecycleEpoch: lifecycleEpoch });
        if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      }
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus(errorLabel(error), 'error');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function ingestApprovedCandidate() {
    if (state.busy || !state.candidate || state.candidate.reviewState !== 'APPROVED'
      || state.candidate.deliveryState === 'BOUND') return;
    var lifecycleEpoch = state.lifecycleEpoch;
    var candidateId = state.candidate.resultId;
    state.busy = true;
    renderControls();
    setStatus('正在取得一次性 ERP 接收授权并绑定当前草稿...', '');
    try {
      var bound = await client.ingestApproved(candidateId);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      var context = state.publicState && state.publicState.context;
      if (!isRecord(bound) || bound.resultId !== candidateId
        || bound.reviewState !== 'APPROVED' || bound.deliveryState !== 'BOUND'
        || !isRecord(bound.ingest) || !isRecord(context)
        || bound.ingest.sourceDraftRevision !== context.draftRevision
        || bound.ingest.sourceDraftVersion !== context.draftVersion
        || bound.ingest.boundDraftRevision !== context.draftRevision + 1
        || bound.ingest.boundDraftVersion !== context.draftVersion + 1
        || bound.ingest.assignmentOrdinal !== context.assignmentOrdinal
        || bound.ingest.skuKey !== context.skuKey
        || bound.ingest.slotKey !== context.slotKey) {
        throw new Error('ingest_invalid');
      }
      await showCandidate(bound, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus('图片已由 ERP 规范化、存储并绑定到新草稿；Ozon 发布仍未执行。', 'success');
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (error && [
        'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
        'SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED',
        'SS_ERP_BYOK_INGEST_RECOVERY_REQUIRED',
      ].includes(error.code) && state.candidate && state.candidate.resultId === candidateId) {
        await showCandidate({
          resultId: candidateId,
          reviewState: 'APPROVED',
          deliveryState: 'INGESTING',
        }, lifecycleEpoch);
        if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      }
      setStatus(errorLabel(error), error && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
        ? 'warning' : 'error');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function recoverIngestCandidate() {
    if (state.busy || !state.candidate || state.candidate.deliveryState !== 'INGESTING') return;
    var lifecycleEpoch = state.lifecycleEpoch;
    var candidateId = state.candidate.resultId;
    state.busy = true;
    renderControls();
    setStatus('正在核对同一 ERP 接收回执...', '');
    try {
      var bound = await client.recoverApprovedIngest(candidateId);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (!isRecord(bound) || bound.resultId !== candidateId
        || bound.reviewState !== 'APPROVED' || bound.deliveryState !== 'BOUND'
        || !isRecord(bound.ingest)) {
        throw new Error('ingest_recovery_invalid');
      }
      await showCandidate(bound, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus('已恢复 ERP 接收回执；图片已绑定草稿，Ozon 发布仍未执行。', 'success');
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (error && [
        'SS_ERP_BYOK_INGEST_RECOVERY_REJECTED',
        'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND',
        'SS_ERP_BYOK_INGEST_RECEIPT_FAILED',
        'SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED',
        'SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT',
        'SS_ERP_BYOK_INGEST_AUTHORITY_STALE',
      ].includes(error.code)) {
        state.authoritativeReloadPending = true;
      }
      setStatus(errorLabel(error), 'warning');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  nodes.profileSelect.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true || state.busy || state.candidate) return;
    state.selectedProfileId = String(nodes.profileSelect.value || '');
    state.readiness = null;
    void refreshReadiness({ lifecycleEpoch: state.lifecycleEpoch });
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
    if (state.candidate && state.candidate.deliveryState === 'INGESTING') {
      void recoverIngestCandidate();
      return;
    }
    if (state.candidate && state.candidate.reviewState === 'APPROVED') {
      void ingestApprovedCandidate();
      return;
    }
    void reviewCandidate('APPROVE');
  });
  nodes.refreshButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.refreshButton.disabled) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    void loadPublicState(lifecycleEpoch).then(function (loaded) {
      if (!loaded || !lifecycleIsCurrent(lifecycleEpoch)
        || state.candidate || state.unknownOutcome) return null;
      return refreshReadiness({ lifecycleEpoch: lifecycleEpoch });
    }).catch(function () {});
  });
  global.addEventListener('pagehide', function () {
    state.lifecycleEpoch += 1;
    state.authoritativeReloadPending = false;
    revokePreview();
  });
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage
    && typeof global.chrome.runtime.onMessage.addListener === 'function') {
    global.chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== clientApi.DEVICE_INVALIDATED_MESSAGE) return;
      state.lifecycleEpoch += 1;
      state.publicState = null;
      state.readiness = null;
      state.unknownOutcome = false;
      state.busy = false;
      state.authoritativeReloadPending = false;
      clearResultView();
      clearContextView('设备已断开', true);
      setStatus('扩展设备会话已变化，请重新连接后从来源商品页打开工作台。', 'warning');
      renderControls();
    });
  }

  var initialLifecycleEpoch = state.lifecycleEpoch;
  void loadPublicState(initialLifecycleEpoch).then(function (loaded) {
    if (loaded && lifecycleIsCurrent(initialLifecycleEpoch)
      && !state.candidate && !state.unknownOutcome) {
      return refreshReadiness({ lifecycleEpoch: initialLifecycleEpoch });
    }
    return null;
  }).catch(function () {});
}(typeof globalThis !== 'undefined' ? globalThis : window));
