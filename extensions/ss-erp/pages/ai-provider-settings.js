(function initializeByokProviderSettingsPage(global) {
  'use strict';

  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var IMPLEMENTED_OPERATIONS = new Set(OPERATIONS);
  var OPERATION_REQUEST_MODES = Object.freeze({
    TEXT_TO_IMAGE: 'json',
    IMAGE_TO_IMAGE: 'multipart',
    FULL_EDIT: 'multipart',
    INPAINT: 'multipart',
  });
  var OPERATION_LABELS = Object.freeze({
    TEXT_TO_IMAGE: '文生图',
    IMAGE_TO_IMAGE: '参考图生成',
    FULL_EDIT: '全图编辑',
    INPAINT: '局部重绘',
  });

  var clientApi = global.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT;
  if (!clientApi || typeof clientApi.createClient !== 'function') return;

  var client;
  try {
    client = clientApi.createClient({
      runtime: global.chrome && global.chrome.runtime,
      permissions: global.chrome && global.chrome.permissions,
      now: function () { return new Date(); },
    });
  } catch (_error) {
    return;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  var nodes = {
    pageStatus: byId('pageStatus'),
    refreshPageBtn: byId('refreshPageBtn'),
    readinessSummary: byId('readinessSummary'),
    generationPolicyState: byId('generationPolicyState'),
    ingestPolicyState: byId('ingestPolicyState'),
    publishPolicyState: byId('publishPolicyState'),
    policyRevision: byId('policyRevision'),
    shopSelect: byId('shopSelect'),
    shopStatus: byId('shopStatus'),
    profileSelect: byId('profileSelect'),
    profileStateSummary: byId('profileStateSummary'),
    newProfileBtn: byId('newProfileBtn'),
    deleteProfileBtn: byId('deleteProfileBtn'),
    profileForm: byId('profileForm'),
    profileNameInput: byId('profileNameInput'),
    baseUrlInput: byId('baseUrlInput'),
    modelInput: byId('modelInput'),
    profileDirtyState: byId('profileDirtyState'),
    saveProfileBtn: byId('saveProfileBtn'),
    sessionKeyForm: byId('sessionKeyForm'),
    apiKeyInput: byId('apiKeyInput'),
    setSessionKeyBtn: byId('setSessionKeyBtn'),
    clearSessionKeyBtn: byId('clearSessionKeyBtn'),
    keyStatus: byId('keyStatus'),
    permissionStatus: byId('permissionStatus'),
    providerOrigin: byId('providerOrigin'),
    requestPermissionBtn: byId('requestPermissionBtn'),
    revokePermissionBtn: byId('revokePermissionBtn'),
    permissionReason: byId('permissionReason'),
    capabilitySummary: byId('capabilitySummary'),
    capabilityRows: byId('capabilityRows'),
    capabilityLiveRegion: byId('capabilityLiveRegion'),
  };

  var state = {
    profiles: [],
    setup: null,
    selectedProfileId: '',
    selectedShopId: '',
    profileState: null,
    permission: null,
    permissionReadiness: null,
    dirty: false,
    loading: false,
    action: '',
    selectionEpoch: 0,
    expiryTimer: null,
  };

  function errorText(error) {
    var code = error && typeof error.code === 'string' ? error.code : '';
    var messages = {
      SS_ERP_BYOK_PROFILE_NOT_FOUND: 'Provider 档案不存在，请刷新后重试。',
      SS_ERP_BYOK_PROFILE_INVALID: '档案参数无效，请检查 Endpoint、模型和能力选择。',
      SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID: 'Endpoint 必须是公开的 HTTPS 地址，且不能包含查询参数或片段。',
      SS_ERP_BYOK_API_KEY_INVALID: 'API Key 无效，请重新输入。',
      SS_ERP_BYOK_SESSION_STORAGE_UNAVAILABLE: '当前浏览器会话存储不可用，无法安全加载密钥。',
      SS_ERP_BYOK_PROVIDER_SHOPS_UNAVAILABLE: '无法读取设备授权店铺。',
      SS_ERP_BYOK_READINESS_UNAVAILABLE: 'ERP 管理策略尚未允许当前店铺、来源或能力。',
      SS_ERP_BYOK_READINESS_PROFILE_UNAVAILABLE: '当前档案未启用该能力。',
      SS_ERP_BYOK_PROVIDER_OPERATION_UNSUPPORTED: '该能力的 Provider 适配尚未开放。',
      SS_ERP_BYOK_PROVIDER_CAPABILITY_REQUIRED: '需要先完成当前模型能力验证。',
      SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED: '请直接点击授权按钮后重试。',
      SS_ERP_BYOK_PERMISSION_READINESS_EXPIRED: '授权许可已过期，正在重新校验。',
      SS_ERP_BYOK_PERMISSION_NOT_ALLOWED: 'ERP 管理员尚未允许该 Provider 来源。',
      SS_ERP_BYOK_PERMISSION_API_FAILED: '浏览器未能完成来源权限操作。',
      SS_ERP_BYOK_PERMISSION_REVOKE_FAILED: '来源权限仍然有效，档案未变更；请在浏览器扩展权限中检查后重试。',
      SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME: 'Provider 可能已执行本次验证，结果未知；请勿重复请求，先刷新能力状态。',
      SS_ERP_BYOK_PROVIDER_SETTINGS_RUNTIME_TIMEOUT: '扩展后台响应超时，请刷新状态后重试。',
      SS_ERP_BYOK_PROVIDER_SETTINGS_RUNTIME_FAILED: '扩展后台不可用，请重新加载扩展后重试。',
    };
    return messages[code] || '操作未完成，请检查设备配对、管理员策略和 Provider 配置。';
  }

  function setPageStatus(message, tone) {
    nodes.pageStatus.textContent = message || '';
    nodes.pageStatus.className = 'page-status' + (tone ? ' is-' + tone : '');
  }

  function setBadge(node, label, tone) {
    node.textContent = label;
    node.className = 'state-badge state-' + (tone || 'neutral');
  }

  function formatDate(value) {
    var parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '无';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  }

  function timestamp(value) {
    var parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function discardPreparedPermission(value) {
    if (!value || typeof client.discardPreparedPermission !== 'function') return;
    try {
      client.discardPreparedPermission(value);
    } catch (_error) {
      // Invalid or already-consumed page tickets have no remaining authority.
    }
  }

  function clearPermissionReadiness() {
    var previous = state.permissionReadiness;
    state.permissionReadiness = null;
    discardPreparedPermission(previous);
  }

  function confirmDiscardDirty() {
    if (!state.dirty) return true;
    return global.confirm('当前 Provider 档案有未保存修改。放弃这些修改并继续？');
  }

  function selectedProfile() {
    return state.profiles.find(function (profile) {
      return profile.id === state.selectedProfileId;
    }) || null;
  }

  function allowedOperationsFromForm() {
    return Array.from(nodes.profileForm.querySelectorAll('input[name="allowedOperations"]:checked'))
      .map(function (input) { return input.value; })
      .filter(function (operation) { return OPERATIONS.includes(operation); });
  }

  function setAllowedOperations(operations) {
    var allowed = new Set(Array.isArray(operations) ? operations : ['TEXT_TO_IMAGE']);
    nodes.profileForm.querySelectorAll('input[name="allowedOperations"]').forEach(function (input) {
      input.checked = allowed.has(input.value);
    });
  }

  function newProfileId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return 'profile-' + global.crypto.randomUUID();
    }
    return 'profile-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function newProbeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return 'probe-' + global.crypto.randomUUID();
    }
    return 'probe-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function formProfile() {
    var operations = allowedOperationsFromForm();
    if (!operations.length) throw new Error('NO_OPERATION');
    return {
      id: state.selectedProfileId || newProfileId(),
      name: nodes.profileNameInput.value.trim(),
      baseUrl: nodes.baseUrlInput.value.trim(),
      model: nodes.modelInput.value.trim(),
      allowedOperations: operations,
      preferences: {
        defaultSize: '1024x1024',
        quality: 'auto',
        outputFormat: 'png',
      },
    };
  }

  function fillProfileForm(profile) {
    nodes.profileNameInput.value = profile ? profile.name : '';
    nodes.baseUrlInput.value = profile ? profile.baseUrl : '';
    nodes.modelInput.value = profile ? profile.model : '';
    setAllowedOperations(profile ? profile.allowedOperations : ['TEXT_TO_IMAGE']);
    state.dirty = false;
    renderDirtyState();
  }

  function renderDirtyState() {
    setBadge(nodes.profileDirtyState, state.dirty ? '未保存' : '已同步', state.dirty ? 'warning' : 'neutral');
  }

  function renderProfiles() {
    var previous = state.selectedProfileId;
    nodes.profileSelect.textContent = '';
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = state.profiles.length ? '新建 Provider 档案' : '尚无 Provider 档案';
    nodes.profileSelect.appendChild(empty);
    state.profiles.forEach(function (profile) {
      var option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name + ' · ' + profile.model;
      nodes.profileSelect.appendChild(option);
    });
    if (previous && state.profiles.some(function (profile) { return profile.id === previous; })) {
      nodes.profileSelect.value = previous;
    } else {
      state.selectedProfileId = '';
      nodes.profileSelect.value = '';
    }
  }

  function renderSetup() {
    var setup = state.setup || { device: { state: 'unconfigured', scopes: [] }, shops: [] };
    var device = setup.device || { state: 'unconfigured', scopes: [] };
    var shops = Array.isArray(setup.shops) ? setup.shops : [];
    var previous = state.selectedShopId;
    nodes.shopSelect.textContent = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    var shopsUnavailable = setup.shopsState === 'unavailable';
    placeholder.textContent = shopsUnavailable
      ? '店铺列表暂不可用'
      : device.state !== 'paired' ? '设备尚未配对' : '请选择测试店铺';
    nodes.shopSelect.appendChild(placeholder);
    shops.forEach(function (shop) {
      var option = document.createElement('option');
      option.value = shop.id;
      option.textContent = shop.name + (shop.status === 'ACTIVE' ? '' : ' · ' + shop.status);
      option.disabled = shop.status !== 'ACTIVE';
      nodes.shopSelect.appendChild(option);
    });
    var activeShops = shops.filter(function (shop) { return shop.status === 'ACTIVE'; });
    if (previous && activeShops.some(function (shop) { return shop.id === previous; })) {
      state.selectedShopId = previous;
    } else if (activeShops.length === 1) {
      state.selectedShopId = activeShops[0].id;
    } else {
      state.selectedShopId = '';
    }
    nodes.shopSelect.value = state.selectedShopId;
    nodes.shopSelect.disabled = device.state !== 'paired' || shopsUnavailable || !activeShops.length;
    if (shopsUnavailable) {
      nodes.shopStatus.textContent = device.state === 'paired'
        ? '店铺列表暂时无法读取，请刷新后重试'
        : '设备与店铺状态暂时无法读取，请刷新后重试';
    } else if (device.state !== 'paired') {
      nodes.shopStatus.textContent = '请先在扩展设置中完成设备配对';
    } else if (!Array.isArray(device.scopes) || !device.scopes.includes('byok:media:ingest')) {
      nodes.shopStatus.textContent = '当前设备缺少 BYOK 媒体权限';
    } else if (!activeShops.length) {
      nodes.shopStatus.textContent = '没有可用于测试的 Ozon 店铺';
    } else {
      nodes.shopStatus.textContent = activeShops.length + ' 个可用 Ozon 店铺';
    }
  }

  function evidenceFor(operation) {
    var profile = selectedProfile();
    var binding = state.permissionReadiness && state.permissionReadiness.readinessBinding;
    var expectedRequestMode = OPERATION_REQUEST_MODES[operation];
    var now = Date.now();
    if (!profile || !binding || !expectedRequestMode
      || !IMPLEMENTED_OPERATIONS.has(operation)
      || !profile.allowedOperations.includes(operation)) return null;
    var evidence = state.profileState && Array.isArray(state.profileState.evidence)
      ? state.profileState.evidence : [];
    return evidence.find(function (item) {
      var verifiedAt = timestamp(item && item.verifiedAt);
      var expiresAt = timestamp(item && item.expiresAt);
      return item && item.operation === operation
        && item.requestMode === expectedRequestMode
        && item.policyRevision === binding.policyRevision
        && Number.isFinite(verifiedAt) && verifiedAt <= now
        && Number.isFinite(expiresAt) && expiresAt > now;
    }) || null;
  }

  function scheduleExpiryRefresh() {
    if (state.expiryTimer) {
      global.clearTimeout(state.expiryTimer);
      state.expiryTimer = null;
    }
    var now = Date.now();
    var expirations = [];
    var readinessExpiry = timestamp(state.permissionReadiness && state.permissionReadiness.expiresAt);
    if (Number.isFinite(readinessExpiry) && readinessExpiry > now) expirations.push(readinessExpiry);
    var evidence = state.profileState && Array.isArray(state.profileState.evidence)
      ? state.profileState.evidence : [];
    evidence.forEach(function (item) {
      var expiresAt = timestamp(item && item.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt > now) expirations.push(expiresAt);
    });
    if (!expirations.length || typeof global.setTimeout !== 'function') return;
    var delay = Math.min(Math.max(1, Math.min.apply(Math, expirations) - now + 25), 2147483647);
    state.expiryTimer = global.setTimeout(function () {
      state.expiryTimer = null;
      var permissionExpired = state.permissionReadiness
        && timestamp(state.permissionReadiness.expiresAt) <= Date.now();
      if (permissionExpired) {
        clearPermissionReadiness();
        resetReadiness('授权许可已过期');
      }
      renderProfileState();
    }, delay);
    if (state.expiryTimer && typeof state.expiryTimer.unref === 'function') {
      state.expiryTimer.unref();
    }
  }

  function capabilityReason(operation, profile, hasKey, granted) {
    if (!profile) return '请先保存 Provider 档案';
    if (state.dirty) return '请先保存档案修改';
    if (!profile.allowedOperations.includes(operation)) return '当前档案未启用此能力';
    if (!IMPLEMENTED_OPERATIONS.has(operation)) return '当前扩展版本尚未实现此能力';
    if (!hasKey) return '请先加载当前会话 API Key';
    if (!granted) return '请先授权精确 Provider 来源';
    if (!state.selectedShopId) return '请选择 ERP 授权店铺';
    return '可以验证当前 endpoint、模型与能力组合';
  }

  function renderCapabilities() {
    var profile = selectedProfile();
    var hasKey = Boolean(state.profileState && state.profileState.hasKey);
    var granted = Boolean(state.permission && state.permission.granted);
    var currentEvidence = 0;
    nodes.capabilityRows.querySelectorAll('[data-operation]').forEach(function (row) {
      var operation = row.dataset.operation;
      var evidence = evidenceFor(operation);
      var statusNode = row.querySelector('[data-role="capability-status"]');
      var reasonNode = row.querySelector('[data-role="capability-reason"]');
      var requestModeNode = row.querySelector('[data-field="request-mode"]');
      var verifiedNode = row.querySelector('[data-field="verified-at"]');
      var expiresNode = row.querySelector('[data-field="expires-at"]');
      var action = row.querySelector('[data-action="test-capability"]');
      var reason = capabilityReason(operation, profile, hasKey, granted);
      if (evidence) {
        currentEvidence += 1;
        reason = '当前策略已有有效证据；更换会话密钥后才能重新验证';
        setBadge(statusNode, '已验证', 'success');
        requestModeNode.textContent = evidence.requestMode;
        verifiedNode.textContent = formatDate(evidence.verifiedAt);
        expiresNode.textContent = formatDate(evidence.expiresAt);
      } else if (!IMPLEMENTED_OPERATIONS.has(operation)) {
        setBadge(statusNode, '未开放', 'neutral');
        requestModeNode.textContent = '待适配';
        verifiedNode.textContent = '尚未验证';
        expiresNode.textContent = '无有效证据';
      } else {
        setBadge(statusNode, '未验证', 'pending');
        requestModeNode.textContent = OPERATION_REQUEST_MODES[operation] || '待适配';
        verifiedNode.textContent = '尚未验证';
        expiresNode.textContent = '无有效证据';
      }
      reasonNode.textContent = reason;
      action.disabled = state.loading || Boolean(state.action)
        || !profile || state.dirty || !profile.allowedOperations.includes(operation)
        || !IMPLEMENTED_OPERATIONS.has(operation) || !hasKey || !granted
        || !state.selectedShopId || Boolean(evidence);
    });
    setBadge(
      nodes.capabilitySummary,
      currentEvidence + ' 项有效证据',
      currentEvidence ? 'success' : 'pending',
    );
  }

  function permissionOperation(profile) {
    if (!profile || !Array.isArray(profile.allowedOperations)) return '';
    return profile.allowedOperations.find(function (operation) {
      return IMPLEMENTED_OPERATIONS.has(operation);
    }) || '';
  }

  function renderPermission() {
    var profile = selectedProfile();
    var granted = Boolean(state.permission && state.permission.granted);
    nodes.providerOrigin.textContent = state.permission && state.permission.origin
      ? state.permission.origin : profile ? '等待精确来源校验' : '尚未确定';
    setBadge(
      nodes.permissionStatus,
      granted ? '已授权' : profile ? '未授权' : '待读取',
      granted ? 'success' : profile ? 'warning' : 'pending',
    );
    var reason = '请先保存 Provider 档案';
    if (profile && state.dirty) reason = '请先保存档案修改';
    else if (profile && !permissionOperation(profile)) reason = '当前档案没有可验证的 Provider 能力';
    else if (profile && !state.selectedShopId) reason = '请选择 ERP 授权店铺';
    else if (profile && !granted && !state.permissionReadiness) reason = '正在校验管理员策略';
    else if (profile && !granted) reason = '管理员策略已允许，可申请精确来源权限';
    else if (profile && granted) reason = '扩展仅可访问此 Provider 来源';
    nodes.permissionReason.textContent = reason;
    nodes.requestPermissionBtn.disabled = state.loading || Boolean(state.action)
      || !profile || state.dirty || granted || !state.permissionReadiness;
    nodes.revokePermissionBtn.disabled = state.loading || Boolean(state.action)
      || !profile || state.dirty || !granted;
  }

  function renderProfileState() {
    var profile = selectedProfile();
    var hasKey = Boolean(state.profileState && state.profileState.hasKey);
    var blocked = state.loading || Boolean(state.action);
    var activeShops = state.setup && Array.isArray(state.setup.shops)
      ? state.setup.shops.filter(function (shop) { return shop.status === 'ACTIVE'; }) : [];
    nodes.profileSelect.disabled = blocked;
    nodes.newProfileBtn.disabled = blocked;
    nodes.refreshPageBtn.disabled = blocked;
    nodes.shopSelect.disabled = blocked
      || !state.setup || !state.setup.device || state.setup.device.state !== 'paired'
      || !activeShops.length;
    nodes.profileForm.querySelectorAll('input').forEach(function (input) {
      input.disabled = blocked;
    });
    nodes.saveProfileBtn.disabled = blocked;
    nodes.deleteProfileBtn.disabled = state.loading || Boolean(state.action) || !profile;
    nodes.setSessionKeyBtn.disabled = state.loading || Boolean(state.action) || !profile || state.dirty;
    nodes.clearSessionKeyBtn.disabled = state.loading || Boolean(state.action)
      || !profile || state.dirty || !hasKey;
    nodes.profileStateSummary.textContent = profile
      ? profile.baseUrl + ' · ' + profile.model
      : '保存档案后才能加载密钥与验证能力';
    setBadge(nodes.keyStatus, hasKey ? '当前会话已加载' : '未加载', hasKey ? 'success' : 'neutral');
    renderPermission();
    renderCapabilities();
    scheduleExpiryRefresh();
  }

  function resetReadiness(message) {
    clearPermissionReadiness();
    setBadge(nodes.readinessSummary, message || '待读取', 'pending');
    nodes.generationPolicyState.textContent = message || '待读取';
    nodes.policyRevision.textContent = '待读取';
    nodes.ingestPolicyState.textContent = '工作台中检查';
    nodes.publishPolicyState.textContent = '发布前检查';
  }

  async function refreshPermissionReadiness(epoch) {
    var profile = selectedProfile();
    var operation = permissionOperation(profile);
    clearPermissionReadiness();
    if (!profile || state.dirty || !state.selectedShopId || !operation) {
      resetReadiness(profile ? '等待店铺与档案' : '等待档案');
      renderProfileState();
      return;
    }
    setBadge(nodes.readinessSummary, '校验中', 'pending');
    nodes.generationPolicyState.textContent = OPERATION_LABELS[operation] + ' · 校验中';
    nodes.policyRevision.textContent = '校验中';
    renderProfileState();
    try {
      var ready = await client.getReadiness({
        profileId: profile.id,
        shopId: state.selectedShopId,
        operation: operation,
      });
      if (epoch !== state.selectionEpoch) return;
      var prepared = await client.preparePermission({
        profileId: profile.id,
        operation: operation,
        readiness: ready,
      });
      if (epoch !== state.selectionEpoch) {
        discardPreparedPermission(prepared);
        return;
      }
      state.permissionReadiness = prepared;
      setBadge(nodes.readinessSummary, '允许测试', 'success');
      nodes.generationPolicyState.textContent = OPERATION_LABELS[operation] + ' · 已允许';
      nodes.policyRevision.textContent = ready.readinessBinding.policyRevision;
    } catch (error) {
      if (epoch !== state.selectionEpoch) return;
      resetReadiness('未就绪');
      nodes.generationPolicyState.textContent = errorText(error);
    }
    renderProfileState();
  }

  async function loadSelectedProfile() {
    var profile = selectedProfile();
    var epoch = ++state.selectionEpoch;
    state.profileState = null;
    state.permission = null;
    clearPermissionReadiness();
    if (!profile) {
      renderProfileState();
      resetReadiness('等待档案');
      return;
    }
    try {
      var values = await Promise.all([
        client.getProfileState(profile.id),
        client.getPermissionStatus(profile.id),
      ]);
      if (epoch !== state.selectionEpoch) return;
      state.profileState = values[0];
      state.permission = values[1];
      renderProfileState();
      await refreshPermissionReadiness(epoch);
    } catch (error) {
      if (epoch !== state.selectionEpoch) return;
      setPageStatus(errorText(error), 'error');
      renderProfileState();
      resetReadiness('未就绪');
    }
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    state.selectionEpoch += 1;
    clearPermissionReadiness();
    setPageStatus('正在读取 Provider 配置...', '');
    nodes.refreshPageBtn.disabled = true;
    try {
      var values = await Promise.allSettled([client.getSetupContext(), client.listProfiles()]);
      var setupResult = values[0];
      var profilesResult = values[1];
      if (setupResult.status === 'fulfilled') state.setup = setupResult.value;
      else {
        state.setup = {
          device: state.setup && state.setup.device
            ? state.setup.device : { state: 'unreachable', scopes: [], expiresAt: null },
          shops: [],
          shopsState: 'unavailable',
        };
      }
      if (profilesResult.status === 'fulfilled') {
        state.profiles = Array.isArray(profilesResult.value.profiles)
          ? profilesResult.value.profiles : [];
      }
      renderSetup();
      renderProfiles();
      if (profilesResult.status === 'fulfilled') {
        if (!state.selectedProfileId && state.profiles.length === 1) {
          state.selectedProfileId = state.profiles[0].id;
          nodes.profileSelect.value = state.selectedProfileId;
          fillProfileForm(state.profiles[0]);
        } else if (state.selectedProfileId) {
          fillProfileForm(selectedProfile());
        } else {
          fillProfileForm(null);
        }
      }
      if (setupResult.status === 'fulfilled' && profilesResult.status === 'fulfilled') {
        setPageStatus('Provider 配置已同步。', 'success');
      } else if (profilesResult.status === 'fulfilled') {
        setPageStatus('Provider 档案已同步，但设备与店铺状态读取失败。', 'warning');
      } else if (setupResult.status === 'fulfilled') {
        setPageStatus('设备状态已同步，但 Provider 档案读取失败。', 'warning');
      } else {
        setPageStatus(errorText(profilesResult.reason || setupResult.reason), 'error');
      }
    } catch (error) {
      state.setup = null;
      renderSetup();
      renderProfiles();
      setPageStatus(errorText(error), 'error');
    } finally {
      state.loading = false;
      nodes.refreshPageBtn.disabled = false;
      renderProfileState();
    }
    await loadSelectedProfile();
  }

  function markDirty() {
    state.selectionEpoch += 1;
    state.dirty = true;
    clearPermissionReadiness();
    renderDirtyState();
    resetReadiness('等待保存');
    renderProfileState();
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (state.action) return;
    var profile;
    try {
      profile = formProfile();
      if (!profile.name || !profile.baseUrl || !profile.model) {
        throw new Error('MISSING_FIELDS');
      }
    } catch (_error) {
      setPageStatus('请填写档案名称、Endpoint、模型，并至少选择一项能力。', 'error');
      return;
    }
    state.action = 'save';
    renderProfileState();
    try {
      var saved = await client.saveProfile(profile);
      state.selectedProfileId = saved.profile.id;
      state.profileState = saved;
      var listed = await client.listProfiles();
      state.profiles = Array.isArray(listed.profiles) ? listed.profiles : [];
      renderProfiles();
      nodes.profileSelect.value = state.selectedProfileId;
      fillProfileForm(saved.profile);
      setPageStatus(
        saved.rebound
          ? 'Endpoint 或模型已更新；旧会话密钥与能力证据已清除。'
          : 'Provider 档案已保存。',
        saved.rebound ? 'warning' : 'success',
      );
    } catch (error) {
      setPageStatus(errorText(error), 'error');
    } finally {
      state.action = '';
      renderProfileState();
    }
    await loadSelectedProfile();
  }

  async function removeSelectedProfile() {
    var profile = selectedProfile();
    if (!profile || state.action) return;
    if (!global.confirm('删除 Provider 档案“' + profile.name + '”？当前会话密钥和验证证据会同时清除。')) {
      return;
    }
    state.action = 'remove';
    renderProfileState();
    try {
      await client.removeProfile(profile.id);
      state.selectedProfileId = '';
      state.profileState = null;
      state.permission = null;
      clearPermissionReadiness();
      var listed = await client.listProfiles();
      state.profiles = Array.isArray(listed.profiles) ? listed.profiles : [];
      renderProfiles();
      fillProfileForm(null);
      resetReadiness('等待档案');
      setPageStatus('Provider 档案已删除。', 'success');
    } catch (error) {
      setPageStatus(errorText(error), 'error');
    } finally {
      state.action = '';
      renderProfileState();
    }
  }

  async function setSessionKey(event) {
    event.preventDefault();
    var profile = selectedProfile();
    if (!profile || state.dirty || state.action) return;
    var epoch = state.selectionEpoch;
    var apiKey = nodes.apiKeyInput.value;
    nodes.apiKeyInput.value = '';
    if (!apiKey.trim()) {
      setPageStatus('请输入 Provider API Key。', 'error');
      apiKey = '';
      return;
    }
    state.action = 'set-key';
    renderProfileState();
    try {
      var request = client.setSessionKey(profile.id, apiKey);
      apiKey = '';
      var nextProfileState = await request;
      if (epoch === state.selectionEpoch && state.selectedProfileId === profile.id) {
        state.profileState = nextProfileState;
        setPageStatus('API Key 已加载到当前浏览器会话。', 'success');
      }
    } catch (error) {
      apiKey = '';
      setPageStatus(errorText(error), 'error');
    } finally {
      apiKey = '';
      state.action = '';
      renderProfileState();
    }
  }

  async function clearSessionKey() {
    var profile = selectedProfile();
    if (!profile || state.action) return;
    var epoch = state.selectionEpoch;
    state.action = 'clear-key';
    renderProfileState();
    try {
      var nextProfileState = await client.clearSessionKey(profile.id);
      if (epoch === state.selectionEpoch && state.selectedProfileId === profile.id) {
        state.profileState = nextProfileState;
        setPageStatus('当前档案的会话密钥与能力证据已清除。', 'success');
      }
    } catch (error) {
      setPageStatus(errorText(error), 'error');
    } finally {
      state.action = '';
      renderProfileState();
    }
  }

  function requestPermission(event) {
    var profile = selectedProfile();
    var ready = state.permissionReadiness;
    var operation = permissionOperation(profile);
    if (!profile || !ready || !operation || state.action) return;
    var epoch = state.selectionEpoch;
    var request;
    try {
      request = client.requestPermissionFromGesture({
        event: event,
        profile: profile,
        shopId: state.selectedShopId,
        operation: operation,
        readiness: ready,
      });
      clearPermissionReadiness();
    } catch (error) {
      clearPermissionReadiness();
      setPageStatus(errorText(error), 'error');
      refreshPermissionReadiness(state.selectionEpoch);
      return;
    }
    state.action = 'request-permission';
    renderProfileState();
    Promise.resolve(request).then(function (result) {
      if (!result.granted) throw new Error('PERMISSION_DENIED');
      if (epoch !== state.selectionEpoch) return null;
      setPageStatus('Provider 精确来源权限已授予。', 'success');
      return client.getPermissionStatus(profile.id);
    }).then(function (permission) {
      if (permission && epoch === state.selectionEpoch
        && state.selectedProfileId === profile.id) state.permission = permission;
    }).catch(function (error) {
      if (epoch === state.selectionEpoch) setPageStatus(errorText(error), 'error');
    }).finally(function () {
      state.action = '';
      renderProfileState();
      refreshPermissionReadiness(state.selectionEpoch);
    });
  }

  async function revokePermission() {
    var profile = selectedProfile();
    if (!profile || state.action) return;
    var epoch = state.selectionEpoch;
    state.action = 'revoke-permission';
    renderProfileState();
    try {
      var revoked = await client.revokePermission(profile.id);
      var permission = await client.getPermissionStatus(profile.id);
      if (!revoked || revoked.removed !== true || !permission || permission.granted !== false) {
        var revokeError = new Error('SS_ERP_BYOK_PERMISSION_REVOKE_FAILED');
        revokeError.code = 'SS_ERP_BYOK_PERMISSION_REVOKE_FAILED';
        throw revokeError;
      }
      if (epoch === state.selectionEpoch && state.selectedProfileId === profile.id) {
        state.permission = permission;
        setPageStatus('Provider 来源权限已撤销。', 'success');
      }
    } catch (error) {
      setPageStatus(errorText(error), 'error');
    } finally {
      state.action = '';
      renderProfileState();
    }
  }

  async function testCapability(event) {
    var button = event.target.closest('[data-action="test-capability"]');
    if (!button || button.disabled || state.action) return;
    var row = button.closest('[data-operation]');
    var operation = row && row.dataset.operation;
    var profile = selectedProfile();
    if (!profile || !IMPLEMENTED_OPERATIONS.has(operation)) return;
    var epoch = state.selectionEpoch;
    state.action = 'probe-' + operation;
    button.disabled = true;
    nodes.capabilityLiveRegion.textContent = '正在验证' + OPERATION_LABELS[operation];
    renderProfileState();
    try {
      var ready = await client.getReadiness({
        profileId: profile.id,
        shopId: state.selectedShopId,
        operation: operation,
      });
      await client.testCapability({
        profileId: profile.id,
        operation: operation,
        idempotencyKey: newProbeId(),
        readiness: ready,
      });
      var nextProfileState = await client.getProfileState(profile.id);
      if (epoch === state.selectionEpoch && state.selectedProfileId === profile.id) {
        state.profileState = nextProfileState;
        nodes.capabilityLiveRegion.textContent = OPERATION_LABELS[operation] + '验证通过';
        setPageStatus(OPERATION_LABELS[operation] + '能力验证通过。', 'success');
      }
    } catch (error) {
      if (epoch === state.selectionEpoch) {
        nodes.capabilityLiveRegion.textContent = error && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
          ? OPERATION_LABELS[operation] + '验证结果未知，请勿重复请求'
          : OPERATION_LABELS[operation] + '验证未通过';
        setPageStatus(errorText(error), 'error');
      }
    } finally {
      state.action = '';
      renderProfileState();
      refreshPermissionReadiness(state.selectionEpoch);
    }
  }

  function handleDeviceSessionInvalidated(message) {
    if (!message || message.type !== clientApi.DEVICE_SESSION_INVALIDATED_MESSAGE) return;
    state.selectionEpoch += 1;
    if (typeof client.invalidatePreparedPermissions === 'function') {
      client.invalidatePreparedPermissions();
    }
    clearPermissionReadiness();
    nodes.apiKeyInput.value = '';
    if (state.profileState) {
      state.profileState = {
        profile: state.profileState.profile || selectedProfile(),
        hasKey: false,
        evidence: [],
      };
    }
    resetReadiness('设备会话已变更');
    setPageStatus('设备连接已变更；会话密钥、验证证据和授权许可已清除。', 'warning');
    renderProfileState();
  }

  nodes.refreshPageBtn.addEventListener('click', function () {
    if (confirmDiscardDirty()) refreshAll();
  });
  nodes.newProfileBtn.addEventListener('click', function () {
    if (!confirmDiscardDirty()) return;
    state.selectedProfileId = '';
    state.profileState = null;
    state.permission = null;
    clearPermissionReadiness();
    state.selectionEpoch += 1;
    nodes.profileSelect.value = '';
    fillProfileForm(null);
    renderProfileState();
    resetReadiness('等待保存');
    nodes.profileNameInput.focus();
  });
  nodes.profileSelect.addEventListener('change', function () {
    if (!confirmDiscardDirty()) {
      nodes.profileSelect.value = state.selectedProfileId;
      return;
    }
    state.selectedProfileId = nodes.profileSelect.value;
    fillProfileForm(selectedProfile());
    loadSelectedProfile();
  });
  nodes.shopSelect.addEventListener('change', function () {
    state.selectedShopId = nodes.shopSelect.value;
    clearPermissionReadiness();
    var epoch = ++state.selectionEpoch;
    renderProfileState();
    refreshPermissionReadiness(epoch);
  });
  nodes.profileForm.addEventListener('input', markDirty);
  nodes.profileForm.addEventListener('change', markDirty);
  nodes.profileForm.addEventListener('submit', saveProfile);
  nodes.deleteProfileBtn.addEventListener('click', removeSelectedProfile);
  nodes.setSessionKeyBtn.addEventListener('click', setSessionKey);
  nodes.apiKeyInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') setSessionKey(event);
  });
  nodes.clearSessionKeyBtn.addEventListener('click', clearSessionKey);
  nodes.requestPermissionBtn.addEventListener('click', requestPermission);
  nodes.revokePermissionBtn.addEventListener('click', revokePermission);
  nodes.capabilityRows.addEventListener('click', testCapability);
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage
    && typeof global.chrome.runtime.onMessage.addListener === 'function') {
    global.chrome.runtime.onMessage.addListener(handleDeviceSessionInvalidated);
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  renderSetup();
  renderProfiles();
  fillProfileForm(null);
  renderProfileState();
  resetReadiness('待读取');
  refreshAll();
}(typeof globalThis !== 'undefined' ? globalThis : window));
