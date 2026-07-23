(function (root) {
  'use strict';

  function positiveFinite(value, label) {
    var normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new TypeError(label + ' is invalid');
    }
    return normalized;
  }

  function fitStage(input) {
    var sourceWidth = positiveFinite(input && input.sourceWidth, 'sourceWidth');
    var sourceHeight = positiveFinite(input && input.sourceHeight, 'sourceHeight');
    var availableWidth = positiveFinite(input && input.availableWidth, 'availableWidth');
    var availableHeight = positiveFinite(input && input.availableHeight, 'availableHeight');
    var scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
    return {
      width: Math.max(1, Math.floor(sourceWidth * scale)),
      height: Math.max(1, Math.floor(sourceHeight * scale)),
      scale: scale,
    };
  }

  function fitPreviewBitmap(input) {
    var cssWidth = positiveFinite(input && input.cssWidth, 'cssWidth');
    var cssHeight = positiveFinite(input && input.cssHeight, 'cssHeight');
    var pixelRatio = positiveFinite(input && input.pixelRatio, 'pixelRatio');
    var maxPixels = positiveFinite(input && input.maxPixels, 'maxPixels');
    var scale = Math.min(pixelRatio, Math.sqrt(maxPixels / (cssWidth * cssHeight)));
    return {
      width: Math.max(1, Math.floor(cssWidth * scale)),
      height: Math.max(1, Math.floor(cssHeight * scale)),
      scale: scale,
    };
  }

  root.SS_ERP_IMAGE_MASK_LAYOUT = {
    fitStage: fitStage,
    fitPreviewBitmap: fitPreviewBitmap,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
