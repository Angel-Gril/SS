(function () {
  'use strict';

  var MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var MAX_PREVIEW_PIXELS = 1_500_000;
  var MASK_PROBE_EDGE = 160;
  var MAX_EXPORT_SCAN_PIXELS = 1_000_000;
  var OPERATIONS = {
    IMAGE_TO_IMAGE: {
      title: '参考图生图',
      readyStatus: '编辑指令已就绪。',
      submittingStatus: '正在创建参考图生图任务...',
    },
    FULL_EDIT: {
      title: '整图编辑',
      readyStatus: '编辑指令已就绪。',
      submittingStatus: '正在创建整图编辑任务...',
    },
    INPAINT: {
      title: '局部重绘',
      readyStatus: '编辑指令和遮罩已就绪。',
      submittingStatus: '正在上传遮罩并创建局部重绘任务...',
    },
  };
  var nonce = new URLSearchParams(window.location.hash.slice(1)).get('nonce') || '';
  var maskApi = window.SS_ERP_IMAGE_MASK_CORE;
  var layoutApi = window.SS_ERP_IMAGE_MASK_LAYOUT;
  var editorTitle = document.getElementById('editorTitle');
  var sourceMeta = document.getElementById('sourceMeta');
  var maskTools = document.getElementById('maskTools');
  var editorWorkspace = document.querySelector('.editor-workspace');
  var canvasWorkspace = document.getElementById('canvasWorkspace');
  var canvasStage = document.getElementById('canvasStage');
  var canvasLoading = document.getElementById('canvasLoading');
  var sourceImage = document.getElementById('sourceImage');
  var maskCanvas = document.getElementById('maskCanvas');
  var paintTool = document.getElementById('paintTool');
  var eraseTool = document.getElementById('eraseTool');
  var brushSize = document.getElementById('brushSize');
  var brushValue = document.getElementById('brushValue');
  var undoButton = document.getElementById('undoButton');
  var redoButton = document.getElementById('redoButton');
  var clearButton = document.getElementById('clearButton');
  var promptInput = document.getElementById('promptInput');
  var negativePromptInput = document.getElementById('negativePromptInput');
  var maskMetrics = document.getElementById('maskMetrics');
  var editPixelCount = document.getElementById('editPixelCount');
  var preservedPixelCount = document.getElementById('preservedPixelCount');
  var statusNode = document.getElementById('editorStatus');
  var submitButton = document.getElementById('submitButton');
  var cancelButton = document.getElementById('cancelButton');
  var previewContext = maskCanvas.getContext('2d');
  var editor = null;
  var source = null;
  var mask = null;
  var tool = 'paint';
  var activePointerId = null;
  var previewFrame = null;
  var maskPreviewState = {
    partial: false,
    editPixelCount: 0,
    preservedPixelCount: 0,
  };
  var sourceReady = false;
  var busy = false;
  var completed = false;
  var sourceError = '';
  var initialPrompt = '';
  var initialNegativePrompt = '';

  function send(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '扩展后台未响应'));
          return;
        }
        resolve(response);
      });
    });
  }

  function setStatus(message, kind) {
    statusNode.textContent = String(message || '');
    statusNode.className = 'editor-status' + (kind ? ' is-' + kind : '');
  }

  function isInpaint() {
    return Boolean(editor && editor.operation === 'INPAINT');
  }

  function normalizedPrompt() {
    return String(promptInput.value || '').normalize('NFKC').trim();
  }

  function normalizedNegativePrompt() {
    return String(negativePromptInput.value || '').normalize('NFKC').trim();
  }

  function promptIsValid() {
    return normalizedPrompt().length > 0 && normalizedPrompt().length <= 8000
      && normalizedNegativePrompt().length <= 4000;
  }

  function hasUnsubmittedChanges() {
    if (completed) return false;
    return promptInput.value !== initialPrompt
      || negativePromptInput.value !== initialNegativePrompt
      || Boolean(isInpaint() && mask && mask.state().dirty);
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  function refreshControls() {
    var current = mask ? mask.state() : null;
    var inpaint = isInpaint();
    var partial = Boolean(maskPreviewState.partial);
    undoButton.disabled = Boolean(!inpaint || busy || completed || !current || !current.canUndo);
    redoButton.disabled = Boolean(!inpaint || busy || completed || !current || !current.canRedo);
    clearButton.disabled = Boolean(
      !inpaint || busy || completed || !current || !current.strokeCount,
    );
    paintTool.disabled = Boolean(
      !inpaint || busy || completed || !sourceReady || (current && current.budgetExhausted),
    );
    eraseTool.disabled = Boolean(
      !inpaint || busy || completed || !sourceReady || (current && current.budgetExhausted),
    );
    brushSize.disabled = Boolean(
      !inpaint || busy || completed || !sourceReady || (current && current.budgetExhausted),
    );
    promptInput.disabled = Boolean(busy || completed || !editor);
    negativePromptInput.disabled = Boolean(busy || completed || !editor);
    submitButton.disabled = Boolean(
      busy || completed || activePointerId !== null || !editor || !sourceReady
      || !promptIsValid() || (inpaint && !partial),
    );
    cancelButton.disabled = busy;
    editPixelCount.textContent = formatCount(maskPreviewState.editPixelCount);
    preservedPixelCount.textContent = formatCount(maskPreviewState.preservedPixelCount);
  }

  function refreshDraftStatus() {
    if (!editor || busy || completed) return;
    var current = isInpaint() && mask ? mask.state() : null;
    if (current && current.budgetExhausted) {
      setStatus(
        '遮罩复杂度已达安全上限。可撤销或清空后继续；遮罩有效时也可直接提交。',
        'error',
      );
      return;
    }
    if (!normalizedPrompt()) {
      setStatus('请填写编辑指令。', '');
      return;
    }
    if (!isInpaint()) {
      setStatus(OPERATIONS[editor.operation].readyStatus, '');
      return;
    }
    if (sourceError) {
      setStatus(sourceError, 'error');
      return;
    }
    if (!sourceReady) {
      setStatus('正在加载局部重绘来源图...', '');
      return;
    }
    if (!current || !maskPreviewState.partial) {
      setStatus(
        current && current.hasPaint
          ? '遮罩必须同时包含重绘和保留区域。'
          : '请标记需要重绘的区域。',
        '',
      );
      return;
    }
    setStatus(OPERATIONS.INPAINT.readyStatus, '');
  }

  function setTool(next) {
    tool = next === 'erase' ? 'erase' : 'paint';
    paintTool.classList.toggle('is-active', tool === 'paint');
    eraseTool.classList.toggle('is-active', tool === 'erase');
    paintTool.setAttribute('aria-pressed', tool === 'paint' ? 'true' : 'false');
    eraseTool.setAttribute('aria-pressed', tool === 'erase' ? 'true' : 'false');
  }

  function updateBrushValue() {
    brushValue.value = String(Math.round(Number(brushSize.value))) + ' px';
    brushValue.textContent = brushValue.value;
  }

  function sourcePoint(event) {
    var rect = maskCanvas.getBoundingClientRect();
    if (!source || !rect.width || !rect.height) throw new Error('遮罩画布尺寸不可用');
    return {
      x: (event.clientX - rect.left) * source.width / rect.width,
      y: (event.clientY - rect.top) * source.height / rect.height,
    };
  }

  function drawMaskStroke(context, stroke, width, height, color) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
    var lineWidth = Math.max(1, stroke.brushSize * Math.min(width, height));
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = lineWidth;
    context.strokeStyle = color;
    context.fillStyle = color;
    if (stroke.points.length === 1) {
      context.beginPath();
      context.arc(
        stroke.points[0].x * width,
        stroke.points[0].y * height,
        lineWidth / 2,
        0,
        Math.PI * 2,
      );
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
      for (var index = 1; index < stroke.points.length; index += 1) {
        context.lineTo(stroke.points[index].x * width, stroke.points[index].y * height);
      }
      context.stroke();
    }
    context.restore();
  }

  function renderMaskCommands(context, width, height, commands, exportMode) {
    context.globalCompositeOperation = 'source-over';
    if (exportMode) {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
    } else {
      context.clearRect(0, 0, width, height);
    }
    commands.forEach(function (stroke) {
      context.globalCompositeOperation = !exportMode && stroke.mode === 'erase'
        ? 'destination-out'
        : 'source-over';
      drawMaskStroke(
        context,
        stroke,
        width,
        height,
        exportMode
          ? (stroke.mode === 'paint' ? '#ffffff' : '#000000')
          : 'rgba(220, 38, 38, 0.48)',
      );
    });
    context.globalCompositeOperation = 'source-over';
  }

  function exportedMaskIsPartial(context, width, height) {
    var rowsPerRead = Math.max(1, Math.floor(MAX_EXPORT_SCAN_PIXELS / width));
    var hasEditPixel = false;
    var hasPreservedPixel = false;
    for (var y = 0; y < height; y += rowsPerRead) {
      var rows = Math.min(rowsPerRead, height - y);
      var pixels = context.getImageData(0, y, width, rows).data;
      for (var index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 0) hasEditPixel = true;
        else hasPreservedPixel = true;
        if (hasEditPixel && hasPreservedPixel) return true;
      }
    }
    return false;
  }

  function drawMaskPreviewNow() {
    if (!mask || !source || !previewContext) return;
    renderMaskCommands(
      previewContext,
      maskCanvas.width,
      maskCanvas.height,
      mask.commands(true),
      false,
    );
  }

  function renderMaskPreview() {
    if (previewFrame !== null) return;
    previewFrame = window.requestAnimationFrame(function () {
      previewFrame = null;
      drawMaskPreviewNow();
    });
  }

  function refreshMaskPreviewState() {
    if (!mask || !source) {
      maskPreviewState = { partial: false, editPixelCount: 0, preservedPixelCount: 0 };
      return;
    }
    var scale = Math.min(MASK_PROBE_EDGE / source.width, MASK_PROBE_EDGE / source.height, 1);
    var width = Math.max(1, Math.round(source.width * scale));
    var height = Math.max(1, Math.round(source.height * scale));
    var probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    var context = probe.getContext('2d', { willReadFrequently: true });
    if (!context) {
      maskPreviewState = { partial: false, editPixelCount: 0, preservedPixelCount: source.width * source.height };
      return;
    }
    renderMaskCommands(context, width, height, mask.commands(false), false);
    var pixels = context.getImageData(0, 0, width, height).data;
    var selected = 0;
    for (var index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) selected += 1;
    }
    var probePixels = width * height;
    var sourcePixels = source.width * source.height;
    var estimatedSelected = Math.round(sourcePixels * selected / probePixels);
    maskPreviewState = {
      partial: selected > 0 && selected < probePixels,
      editPixelCount: estimatedSelected,
      preservedPixelCount: sourcePixels - estimatedSelected,
    };
  }

  function resizeMaskStage() {
    if (!isInpaint() || !source || !layoutApi || typeof layoutApi.fitStage !== 'function') return;
    var computed = window.getComputedStyle(canvasWorkspace);
    var availableWidth = canvasWorkspace.clientWidth
      - Number.parseFloat(computed.paddingLeft || 0)
      - Number.parseFloat(computed.paddingRight || 0);
    var availableHeight = canvasWorkspace.clientHeight
      - Number.parseFloat(computed.paddingTop || 0)
      - Number.parseFloat(computed.paddingBottom || 0);
    if (availableWidth <= 0 || availableHeight <= 0) return;
    var fitted = layoutApi.fitStage({
      sourceWidth: source.width,
      sourceHeight: source.height,
      availableWidth: availableWidth,
      availableHeight: availableHeight,
    });
    canvasStage.style.width = fitted.width + 'px';
    canvasStage.style.height = fitted.height + 'px';
    var bitmap = layoutApi.fitPreviewBitmap({
      cssWidth: fitted.width,
      cssHeight: fitted.height,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      maxPixels: MAX_PREVIEW_PIXELS,
    });
    if (maskCanvas.width !== bitmap.width || maskCanvas.height !== bitmap.height) {
      maskCanvas.width = bitmap.width;
      maskCanvas.height = bitmap.height;
      renderMaskPreview();
    }
  }

  function finishStroke(commit) {
    if (activePointerId === null || !mask) return;
    if (commit === false) mask.cancelStroke();
    else mask.endStroke();
    activePointerId = null;
    refreshMaskPreviewState();
    renderMaskPreview();
    refreshControls();
    refreshDraftStatus();
  }

  function normalizedSourceKeys(value, operation) {
    var maximum = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
    if (!Array.isArray(value) || value.length < 1 || value.length > maximum) return null;
    var keys = value.map(function (item) {
      return typeof item === 'string' ? item.normalize('NFKC').trim() : '';
    });
    if (keys.some(function (key) { return !key || key.length > 500; })
      || new Set(keys).size !== keys.length) return null;
    return keys;
  }

  function renderEditor(value) {
    var definition = value && OPERATIONS[value.operation];
    var sourceMediaKeys = normalizedSourceKeys(value && value.sourceMediaKeys, value && value.operation);
    var inpaint = Boolean(definition && value.operation === 'INPAINT');
    if (!definition || !sourceMediaKeys
      || (inpaint && (!value.source || value.source.maskSemantics !== MASK_SEMANTICS))
      || (!inpaint && value.source !== null)) {
      throw new Error('AI 图片任务上下文无效');
    }

    editor = value;
    completed = value.completed === true;
    sourceError = '';
    promptInput.value = '';
    negativePromptInput.value = '';
    editorTitle.textContent = definition.title;
    document.title = definition.title + ' - SS ERP';
    maskTools.hidden = !inpaint;
    canvasWorkspace.hidden = !inpaint;
    maskMetrics.hidden = !inpaint;
    editorWorkspace.classList.toggle('is-prompt-only', !inpaint);

    if (!inpaint) {
      source = null;
      mask = null;
      sourceReady = true;
      sourceMeta.textContent = '已选择 ' + sourceMediaKeys.length + ' 张来源图';
    } else {
      if (!previewContext || !maskApi || typeof maskApi.createMask !== 'function'
        || !layoutApi || typeof layoutApi.fitStage !== 'function'
        || typeof layoutApi.fitPreviewBitmap !== 'function') {
        throw new Error('遮罩编辑模块不可用');
      }
      source = value.source;
      mask = maskApi.createMask({ width: source.width, height: source.height });
      maskPreviewState = {
        partial: false,
        editPixelCount: 0,
        preservedPixelCount: source.width * source.height,
      };
      sourceMeta.textContent = source.width + ' × ' + source.height + ' · ' + sourceMediaKeys[0];
      var maximumBrush = Math.max(
        8,
        Math.min(512, Math.round(Math.min(source.width, source.height) / 3)),
      );
      var initialBrush = Math.max(
        2,
        Math.min(maximumBrush, Math.round(Math.min(source.width, source.height) / 20)),
      );
      brushSize.max = String(maximumBrush);
      brushSize.value = String(initialBrush);
      updateBrushValue();
      sourceImage.src = source.url;
      resizeMaskStage();
    }

    initialPrompt = promptInput.value;
    initialNegativePrompt = negativePromptInput.value;
    refreshControls();
    if (completed) {
      setStatus('该' + definition.title + '任务已经创建。', 'success');
    } else {
      refreshDraftStatus();
      promptInput.focus();
    }
  }

  async function load() {
    if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error('AI 图片编辑链接无效或已过期');
    var response = await send({
      type: 'ss-erp:source-listing-workbench-media-editor-read',
      nonce: nonce,
    });
    if (!response || !response.ok || !response.editor) {
      throw new Error(response && response.error || 'AI 图片任务内容不可用');
    }
    renderEditor(response.editor);
  }

  function exportMaskDataUrl() {
    return new Promise(function (resolve, reject) {
      if (!mask || !source || !maskPreviewState.partial) {
        reject(new Error('遮罩必须同时包含重绘和保留区域'));
        return;
      }
      var exportCanvas = document.createElement('canvas');
      exportCanvas.width = source.width;
      exportCanvas.height = source.height;
      var exportContext = exportCanvas.getContext('2d', { willReadFrequently: true });
      if (!exportContext) {
        reject(new Error('浏览器无法创建遮罩画布'));
        return;
      }
      renderMaskCommands(
        exportContext,
        source.width,
        source.height,
        mask.commands(false),
        true,
      );
      if (!exportedMaskIsPartial(exportContext, source.width, source.height)) {
        reject(new Error('遮罩必须同时包含重绘和保留区域'));
        return;
      }
      exportCanvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('遮罩 PNG 生成失败'));
          return;
        }
        if (blob.size > source.maxMaskBytes) {
          reject(new Error('遮罩 PNG 超过服务器大小限制'));
          return;
        }
        var reader = new FileReader();
        reader.addEventListener('load', function () {
          if (typeof reader.result !== 'string') {
            reject(new Error('遮罩 PNG 读取失败'));
            return;
          }
          resolve(reader.result);
        }, { once: true });
        reader.addEventListener('error', function () {
          reject(new Error('遮罩 PNG 读取失败'));
        }, { once: true });
        reader.readAsDataURL(blob);
      }, 'image/png');
    });
  }

  paintTool.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || paintTool.disabled) return;
    setTool('paint');
  });

  eraseTool.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || eraseTool.disabled) return;
    setTool('erase');
  });

  brushSize.addEventListener('input', function (event) {
    if (!event || event.isTrusted !== true || brushSize.disabled) return;
    updateBrushValue();
  });

  promptInput.addEventListener('input', function (event) {
    if (!event || event.isTrusted !== true || promptInput.disabled) return;
    refreshControls();
    refreshDraftStatus();
  });

  negativePromptInput.addEventListener('input', function (event) {
    if (!event || event.isTrusted !== true || negativePromptInput.disabled) return;
    refreshControls();
    refreshDraftStatus();
  });

  maskCanvas.addEventListener('pointerdown', function (event) {
    if (!event || event.isTrusted !== true || busy || completed || !isInpaint() || !sourceReady
      || activePointerId !== null || event.button !== 0 || event.isPrimary === false) return;
    var point = sourcePoint(event);
    var started = mask.beginStroke({
      mode: tool,
      brushSize: Number(brushSize.value),
      x: point.x,
      y: point.y,
    });
    if (!started) {
      refreshControls();
      refreshDraftStatus();
      return;
    }
    activePointerId = event.pointerId;
    refreshControls();
    renderMaskPreview();
    maskCanvas.setPointerCapture(event.pointerId);
  });

  maskCanvas.addEventListener('pointermove', function (event) {
    if (!event || event.pointerId !== activePointerId) return;
    var point = sourcePoint(event);
    if (!mask.extendStroke(point) && mask.state().budgetExhausted) {
      refreshControls();
      refreshDraftStatus();
    }
    renderMaskPreview();
  });

  maskCanvas.addEventListener('pointerup', function (event) {
    if (!event || event.pointerId !== activePointerId) return;
    var point = sourcePoint(event);
    mask.extendStroke(point);
    finishStroke(true);
    if (maskCanvas.hasPointerCapture(event.pointerId)) {
      maskCanvas.releasePointerCapture(event.pointerId);
    }
  });

  maskCanvas.addEventListener('pointercancel', function () { finishStroke(false); });
  maskCanvas.addEventListener('lostpointercapture', function () { finishStroke(false); });

  undoButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || undoButton.disabled) return;
    mask.undo();
    refreshMaskPreviewState();
    renderMaskPreview();
    refreshControls();
    refreshDraftStatus();
  });

  redoButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || redoButton.disabled) return;
    mask.redo();
    refreshMaskPreviewState();
    renderMaskPreview();
    refreshControls();
    refreshDraftStatus();
  });

  clearButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || clearButton.disabled) return;
    mask.clear();
    refreshMaskPreviewState();
    renderMaskPreview();
    refreshControls();
    refreshDraftStatus();
  });

  sourceImage.addEventListener('load', function () {
    if (!isInpaint()) return;
    if (!source || sourceImage.naturalWidth !== source.width
      || sourceImage.naturalHeight !== source.height) {
      sourceReady = false;
      canvasLoading.textContent = '来源图片尺寸不一致';
      sourceError = '来源图片已变化，请从商品页重新打开。';
      setStatus(sourceError, 'error');
      refreshControls();
      return;
    }
    sourceError = '';
    sourceReady = true;
    canvasLoading.hidden = true;
    resizeMaskStage();
    refreshMaskPreviewState();
    renderMaskPreview();
    refreshControls();
    refreshDraftStatus();
  });

  sourceImage.addEventListener('error', function () {
    if (!isInpaint()) return;
    sourceReady = false;
    canvasLoading.textContent = '来源图片加载失败';
    sourceError = '来源图片加载失败，请从商品页重试。';
    setStatus(sourceError, 'error');
    refreshControls();
  });

  submitButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || submitButton.disabled
      || busy || completed || activePointerId !== null || !editor) return;
    busy = true;
    refreshControls();
    setStatus(OPERATIONS[editor.operation].submittingStatus, '');
    var submitMessage = {
      type: 'ss-erp:source-listing-workbench-media-editor-submit',
      nonce: nonce,
      operation: editor.operation,
      prompt: promptInput.value,
      negativePrompt: negativePromptInput.value,
    };
    var prepareMessage = isInpaint()
      ? exportMaskDataUrl().then(function (maskDataUrl) {
        submitMessage.maskDataUrl = maskDataUrl;
        return submitMessage;
      })
      : Promise.resolve(submitMessage);
    prepareMessage.then(send).then(function (response) {
      if (!response || !response.ok || !response.result
        || response.result.state !== 'completed') {
        throw new Error(response && response.error || 'AI 图片任务创建失败');
      }
      completed = true;
      setStatus(
        OPERATIONS[editor.operation].title + '任务已进入队列，可以关闭此窗口。',
        'success',
      );
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), 'error');
    }).finally(function () {
      busy = false;
      refreshControls();
    });
  });

  cancelButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || busy) return;
    if (hasUnsubmittedChanges()
      && !window.confirm('编辑内容尚未提交，确认关闭编辑器？')) return;
    busy = true;
    refreshControls();
    send({
      type: 'ss-erp:source-listing-workbench-media-editor-cancel',
      nonce: nonce,
    }).then(function (response) {
      if (!response || !response.ok || !response.result) {
        throw new Error(response && response.error || '编辑器关闭请求失败');
      }
      if (response.result.state === 'recovery_required') {
        setStatus(
          '任务提交结果尚未确认，已保留恢复状态。请保留此窗口并重试提交。',
          'error',
        );
        return;
      }
      if (response.result.state !== 'cancelled' && response.result.state !== 'completed') {
        throw new Error('编辑器关闭状态无效');
      }
      if (response.result.state === 'completed') completed = true;
      window.close();
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), 'error');
    }).finally(function () {
      busy = false;
      refreshControls();
    });
  });

  window.addEventListener('beforeunload', function (event) {
    if (hasUnsubmittedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('pagehide', function () {
    if (previewFrame !== null) {
      window.cancelAnimationFrame(previewFrame);
      previewFrame = null;
    }
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resizeMaskStage).observe(canvasWorkspace);
  } else {
    window.addEventListener('resize', resizeMaskStage);
  }

  setTool('paint');
  updateBrushValue();
  refreshControls();
  load().catch(function (error) {
    canvasLoading.textContent = '编辑器不可用';
    setStatus(error && error.message ? error.message : String(error), 'error');
    refreshControls();
  });
}());
