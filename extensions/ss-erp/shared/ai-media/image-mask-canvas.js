(function exposeImageMaskCanvas(global) {
  'use strict';

  var CONTRACT_VERSION = 'ss-erp-image-mask-canvas/v1';
  var MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var DEFAULT_PROBE_EDGE = 160;
  var MAX_SCAN_PIXELS = 1_000_000;
  var MAX_PIXELS = 12 * 1000 * 1000;

  function maskError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function positiveInteger(value, code, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw maskError(code);
    return value;
  }

  function dimensions(widthValue, heightValue, code) {
    var width = positiveInteger(widthValue, code, 16384);
    var height = positiveInteger(heightValue, code, 16384);
    var pixelCount = width * height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_PIXELS) throw maskError(code);
    return { width: width, height: height };
  }

  function normalizedCommands(value) {
    if (!Array.isArray(value)) throw maskError('SS_ERP_IMAGE_MASK_COMMANDS_INVALID');
    return value.map(function (stroke) {
      if (!stroke || typeof stroke !== 'object' || !['paint', 'erase'].includes(stroke.mode)
        || typeof stroke.brushSize !== 'number' || !Number.isFinite(stroke.brushSize)
        || stroke.brushSize <= 0 || stroke.brushSize > 4
        || !Array.isArray(stroke.points) || !stroke.points.length) {
        throw maskError('SS_ERP_IMAGE_MASK_COMMANDS_INVALID');
      }
      return {
        mode: stroke.mode,
        brushSize: stroke.brushSize,
        points: stroke.points.map(function (point) {
          if (!point || typeof point !== 'object'
            || typeof point.x !== 'number' || !Number.isFinite(point.x)
            || typeof point.y !== 'number' || !Number.isFinite(point.y)
            || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
            throw maskError('SS_ERP_IMAGE_MASK_COMMANDS_INVALID');
          }
          return { x: point.x, y: point.y };
        }),
      };
    });
  }

  function drawStroke(context, stroke, width, height, color) {
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

  function renderCommands(input) {
    if (!input || typeof input !== 'object' || !input.context) {
      throw maskError('SS_ERP_IMAGE_MASK_RENDER_INVALID');
    }
    var size = dimensions(input.width, input.height, 'SS_ERP_IMAGE_MASK_RENDER_INVALID');
    var width = size.width;
    var height = size.height;
    var commands = normalizedCommands(input.commands);
    var exportMode = input.mode === 'EXPORT';
    if (!exportMode && input.mode !== 'OVERLAY') {
      throw maskError('SS_ERP_IMAGE_MASK_RENDER_INVALID');
    }
    var context = input.context;
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
      drawStroke(
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
    return true;
  }

  function scanExport(context, width, height) {
    var rowsPerRead = Math.max(1, Math.floor(MAX_SCAN_PIXELS / width));
    var editPixels = 0;
    var preservedPixels = 0;
    for (var y = 0; y < height; y += rowsPerRead) {
      var rows = Math.min(rowsPerRead, height - y);
      var pixels = context.getImageData(0, y, width, rows).data;
      for (var index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 0) editPixels += 1;
        else preservedPixels += 1;
      }
    }
    return {
      partial: editPixels > 0 && preservedPixels > 0,
      editPixelCount: editPixels,
      preservedPixelCount: preservedPixels,
    };
  }

  function createCanvas(documentValue, width, height, code) {
    if (!documentValue || typeof documentValue.createElement !== 'function') throw maskError(code);
    var canvas = documentValue.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw maskError(code);
    return { canvas: canvas, context: context };
  }

  function measure(input) {
    var size = dimensions(
      input && input.width,
      input && input.height,
      'SS_ERP_IMAGE_MASK_MEASURE_INVALID',
    );
    var width = size.width;
    var height = size.height;
    var probeEdge = Number.isSafeInteger(input.probeEdge) && input.probeEdge > 0
      ? Math.min(input.probeEdge, 512)
      : DEFAULT_PROBE_EDGE;
    var scale = Math.min(probeEdge / width, probeEdge / height, 1);
    var probeWidth = Math.max(1, Math.round(width * scale));
    var probeHeight = Math.max(1, Math.round(height * scale));
    var created = createCanvas(
      input.document,
      probeWidth,
      probeHeight,
      'SS_ERP_IMAGE_MASK_MEASURE_INVALID',
    );
    renderCommands({
      context: created.context,
      width: probeWidth,
      height: probeHeight,
      commands: input.commands,
      mode: 'OVERLAY',
    });
    var pixels = created.context.getImageData(0, 0, probeWidth, probeHeight).data;
    var selected = 0;
    for (var index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) selected += 1;
    }
    var probePixels = probeWidth * probeHeight;
    var sourcePixels = width * height;
    var editPixelCount = Math.round(sourcePixels * selected / probePixels);
    return Object.freeze({
      partial: selected > 0 && selected < probePixels,
      editPixelCount: editPixelCount,
      preservedPixelCount: sourcePixels - editPixelCount,
    });
  }

  function sourcePoint(input) {
    if (!input || !input.rect || !input.rect.width || !input.rect.height) {
      throw maskError('SS_ERP_IMAGE_MASK_POINT_INVALID');
    }
    var sourceSize = dimensions(
      input.sourceWidth,
      input.sourceHeight,
      'SS_ERP_IMAGE_MASK_POINT_INVALID',
    );
    var sourceWidth = sourceSize.width;
    var sourceHeight = sourceSize.height;
    if (![input.clientX, input.clientY, input.rect.left, input.rect.top]
      .every(function (value) { return typeof value === 'number' && Number.isFinite(value); })) {
      throw maskError('SS_ERP_IMAGE_MASK_POINT_INVALID');
    }
    return Object.freeze({
      x: Math.max(0, Math.min(sourceWidth,
        (input.clientX - input.rect.left) * sourceWidth / input.rect.width)),
      y: Math.max(0, Math.min(sourceHeight,
        (input.clientY - input.rect.top) * sourceHeight / input.rect.height)),
    });
  }

  function exportPng(input) {
    return new Promise(function (resolve, reject) {
      try {
        var size = dimensions(
          input && input.width,
          input && input.height,
          'SS_ERP_IMAGE_MASK_EXPORT_INVALID',
        );
        var width = size.width;
        var height = size.height;
        var maxBytes = positiveInteger(
          input && input.maxBytes,
          'SS_ERP_IMAGE_MASK_EXPORT_INVALID',
          20 * 1024 * 1024,
        );
        var created = createCanvas(
          input.document,
          width,
          height,
          'SS_ERP_IMAGE_MASK_EXPORT_INVALID',
        );
        renderCommands({
          context: created.context,
          width: width,
          height: height,
          commands: input.commands,
          mode: 'EXPORT',
        });
        var metrics = scanExport(created.context, width, height);
        if (!metrics.partial) throw maskError('SS_ERP_IMAGE_MASK_PARTIAL_REQUIRED');
        created.canvas.toBlob(function (blob) {
          if (!blob || blob.type !== 'image/png') {
            reject(maskError('SS_ERP_IMAGE_MASK_EXPORT_INVALID'));
            return;
          }
          if (blob.size > maxBytes) {
            reject(maskError('SS_ERP_IMAGE_MASK_TOO_LARGE'));
            return;
          }
          resolve(Object.freeze({
            blob: blob,
            maskSemantics: MASK_SEMANTICS,
            width: width,
            height: height,
            editPixelCount: metrics.editPixelCount,
            preservedPixelCount: metrics.preservedPixelCount,
          }));
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }

  global.SS_ERP_IMAGE_MASK_CANVAS = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    MASK_SEMANTICS: MASK_SEMANTICS,
    MAX_PIXELS: MAX_PIXELS,
    renderCommands: renderCommands,
    measure: measure,
    sourcePoint: sourcePoint,
    exportPng: exportPng,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
