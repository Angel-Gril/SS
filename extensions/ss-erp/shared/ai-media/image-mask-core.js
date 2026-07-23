(function (root) {
  'use strict';

  var MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var MAX_DIMENSION = 16384;
  var MAX_PIXELS = 12 * 1000 * 1000;
  var MAX_ASPECT_RATIO = 20;
  var MAX_STROKE_POINTS = 4096;
  var MAX_STROKES = 512;
  var MAX_TOTAL_POINTS = 64 * 1024;
  var DEFAULT_MAX_HISTORY = 50;
  var MAX_HISTORY = 100;
  var MIN_NORMALIZED_POINT_DISTANCE = 0.001;

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function createMask(options) {
    var width = positiveInteger(options && options.width);
    var height = positiveInteger(options && options.height);
    var pixelCount = width * height;
    if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION
      || !Number.isSafeInteger(pixelCount) || pixelCount > MAX_PIXELS
      || Math.max(width, height) / Math.min(width, height) > MAX_ASPECT_RATIO) {
      throw new TypeError('mask dimensions are invalid');
    }
    var requestedHistory = positiveInteger(options && options.maxHistory);
    var maxHistory = requestedHistory
      ? Math.min(requestedHistory, MAX_HISTORY)
      : DEFAULT_MAX_HISTORY;
    var strokes = [];
    var undoHistory = [];
    var redoHistory = [];
    var activeStroke = null;
    var pointCount = 0;

    function strokePointCount(values) {
      return values.reduce(function (total, stroke) {
        return total + stroke.points.length;
      }, 0);
    }

    function point(value) {
      var x = Number(value && value.x);
      var y = Number(value && value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('mask point is invalid');
      }
      return {
        x: clamp(x / width, 0, 1),
        y: clamp(y / height, 0, 1),
      };
    }

    function normalizedBrushSize(value) {
      var size = Number(value);
      if (!Number.isFinite(size) || size <= 0 || size > Math.max(width, height) * 4) {
        throw new TypeError('mask brush size is invalid');
      }
      return clamp(size / Math.min(width, height), 1 / Math.min(width, height), 4);
    }

    function cloneStroke(stroke) {
      return {
        mode: stroke.mode,
        brushSize: stroke.brushSize,
        points: stroke.points.map(function (item) {
          return { x: item.x, y: item.y };
        }),
      };
    }

    function pushUndo(operation) {
      undoHistory.push(operation);
      if (undoHistory.length > maxHistory) undoHistory.shift();
      redoHistory = [];
    }

    function cancelActiveStroke() {
      if (!activeStroke) return false;
      activeStroke = null;
      return true;
    }

    function beginStroke(input) {
      cancelActiveStroke();
      if (strokes.length >= MAX_STROKES || pointCount >= MAX_TOTAL_POINTS) return false;
      var mode = input && input.mode;
      if (mode !== 'paint' && mode !== 'erase') {
        throw new TypeError('mask stroke mode is invalid');
      }
      activeStroke = {
        mode: mode,
        brushSize: normalizedBrushSize(input.brushSize),
        points: [point(input)],
      };
      return true;
    }

    function extendStroke(input) {
      if (!activeStroke || activeStroke.points.length >= MAX_STROKE_POINTS
        || pointCount + activeStroke.points.length >= MAX_TOTAL_POINTS) return false;
      var next = point(input);
      var previous = activeStroke.points[activeStroke.points.length - 1];
      if (Math.hypot(next.x - previous.x, next.y - previous.y)
        < MIN_NORMALIZED_POINT_DISTANCE) return false;
      activeStroke.points.push(next);
      return true;
    }

    function endStroke() {
      if (!activeStroke) return false;
      var completed = cloneStroke(activeStroke);
      activeStroke = null;
      strokes = [...strokes, completed];
      pointCount += completed.points.length;
      pushUndo({ type: 'add', stroke: completed });
      return true;
    }

    function undo() {
      cancelActiveStroke();
      var operation = undoHistory.pop();
      if (!operation) return false;
      if (operation.type === 'add') {
        if (strokes[strokes.length - 1] !== operation.stroke) return false;
        strokes = strokes.slice(0, -1);
        pointCount -= operation.stroke.points.length;
      } else {
        strokes = operation.previous;
        pointCount = strokePointCount(strokes);
      }
      redoHistory.push(operation);
      if (redoHistory.length > maxHistory) redoHistory.shift();
      return true;
    }

    function redo() {
      cancelActiveStroke();
      var operation = redoHistory.pop();
      if (!operation) return false;
      if (operation.type === 'add') {
        strokes = [...strokes, operation.stroke];
        pointCount += operation.stroke.points.length;
      } else {
        strokes = [];
        pointCount = 0;
      }
      undoHistory.push(operation);
      if (undoHistory.length > maxHistory) undoHistory.shift();
      return true;
    }

    function clear() {
      cancelActiveStroke();
      if (!strokes.length) return false;
      var previous = strokes;
      strokes = [];
      pointCount = 0;
      pushUndo({ type: 'clear', previous: previous });
      return true;
    }

    function state() {
      var activePointCount = activeStroke ? activeStroke.points.length : 0;
      var budgetExhausted = strokes.length >= MAX_STROKES
        || pointCount + activePointCount >= MAX_TOTAL_POINTS;
      return {
        width: width,
        height: height,
        strokeCount: strokes.length,
        pointCount: pointCount,
        activePointCount: activePointCount,
        budgetExhausted: budgetExhausted,
        canBeginStroke: !budgetExhausted,
        hasPaint: strokes.some(function (stroke) { return stroke.mode === 'paint'; }),
        dirty: strokes.length > 0 || undoHistory.length > 0 || redoHistory.length > 0,
        canUndo: undoHistory.length > 0,
        canRedo: redoHistory.length > 0,
      };
    }

    function commands(includeActive) {
      var result = strokes.slice();
      if (includeActive === true && activeStroke) result.push(cloneStroke(activeStroke));
      return result;
    }

    return {
      beginStroke: beginStroke,
      extendStroke: extendStroke,
      endStroke: endStroke,
      cancelStroke: cancelActiveStroke,
      undo: undo,
      redo: redo,
      clear: clear,
      state: state,
      commands: commands,
    };
  }

  root.SS_ERP_IMAGE_MASK_CORE = {
    MASK_SEMANTICS: MASK_SEMANTICS,
    MAX_STROKE_POINTS: MAX_STROKE_POINTS,
    MAX_STROKES: MAX_STROKES,
    MAX_TOTAL_POINTS: MAX_TOTAL_POINTS,
    createMask: createMask,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
