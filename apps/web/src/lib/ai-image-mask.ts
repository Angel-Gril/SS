export type AiImageMaskMode = 'paint' | 'erase';

export interface AiImageMaskPoint {
  x: number;
  y: number;
}

export interface AiImageMaskStroke {
  mode: AiImageMaskMode;
  size: number;
  points: AiImageMaskPoint[];
}

export interface AiImageMaskHistory {
  strokes: AiImageMaskStroke[];
  undo: AiImageMaskStroke[][];
  redo: AiImageMaskStroke[][];
}

export const AI_IMAGE_MASK_HISTORY_LIMIT = 100;
export const AI_IMAGE_MASK_STROKE_POINT_LIMIT = 4096;
export const AI_IMAGE_MASK_MAX_PIXELS = 12_000_000;
export const AI_IMAGE_MASK_MAX_EDGE = 16_384;
export const AI_IMAGE_MASK_MAX_ASPECT_RATIO = 20;
export const AI_IMAGE_MASK_DRAFT_DISCARD_MESSAGE = '当前局部重绘遮罩尚未提交，继续将丢弃这些笔画。';
const MIN_POINT_DISTANCE = 0.001;

export function confirmAiImageMaskDraftDiscard(
  dirty: boolean,
  confirm: (message: string) => boolean,
): boolean {
  return !dirty || confirm(AI_IMAGE_MASK_DRAFT_DISCARD_MESSAGE);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedPoint(point: AiImageMaskPoint): AiImageMaskPoint {
  return {
    x: clamp(Number.isFinite(point.x) ? point.x : 0, 0, 1),
    y: clamp(Number.isFinite(point.y) ? point.y : 0, 0, 1),
  };
}

function normalizedSize(size: number) {
  return clamp(Number.isFinite(size) ? size : 0.05, 0.005, 0.25);
}

export function createAiImageMaskHistory(): AiImageMaskHistory {
  return { strokes: [], undo: [], redo: [] };
}

export function isAiImageMaskDimensionsSupported(width: number, height: number): boolean {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > AI_IMAGE_MASK_MAX_EDGE
    || height > AI_IMAGE_MASK_MAX_EDGE
    || width * height > AI_IMAGE_MASK_MAX_PIXELS
  ) return false;
  return Math.max(width, height) / Math.min(width, height) <= AI_IMAGE_MASK_MAX_ASPECT_RATIO;
}

export function createAiImageMaskStroke(
  mode: AiImageMaskMode,
  size: number,
  point: AiImageMaskPoint,
): AiImageMaskStroke {
  return {
    mode: mode === 'erase' ? 'erase' : 'paint',
    size: normalizedSize(size),
    points: [normalizedPoint(point)],
  };
}

export function appendAiImageMaskPoint(
  stroke: AiImageMaskStroke,
  point: AiImageMaskPoint,
): AiImageMaskStroke {
  if (stroke.points.length >= AI_IMAGE_MASK_STROKE_POINT_LIMIT) return stroke;
  const next = normalizedPoint(point);
  const previous = stroke.points[stroke.points.length - 1];
  if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < MIN_POINT_DISTANCE) {
    return stroke;
  }
  return { ...stroke, points: [...stroke.points, next] };
}

export function commitAiImageMaskStroke(
  history: AiImageMaskHistory,
  stroke: AiImageMaskStroke,
): AiImageMaskHistory {
  if (!stroke.points.length) return history;
  const strokes = [...history.strokes, stroke];
  return {
    strokes: strokes.slice(-AI_IMAGE_MASK_HISTORY_LIMIT),
    undo: [...history.undo, history.strokes].slice(-AI_IMAGE_MASK_HISTORY_LIMIT),
    redo: [],
  };
}

export function undoAiImageMaskHistory(history: AiImageMaskHistory): AiImageMaskHistory {
  const previous = history.undo[history.undo.length - 1];
  if (!previous) return history;
  return {
    strokes: previous,
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, history.strokes].slice(-AI_IMAGE_MASK_HISTORY_LIMIT),
  };
}

export function redoAiImageMaskHistory(history: AiImageMaskHistory): AiImageMaskHistory {
  const next = history.redo[history.redo.length - 1];
  if (!next) return history;
  return {
    strokes: next,
    undo: [...history.undo, history.strokes].slice(-AI_IMAGE_MASK_HISTORY_LIMIT),
    redo: history.redo.slice(0, -1),
  };
}

export function clearAiImageMaskHistory(history: AiImageMaskHistory): AiImageMaskHistory {
  if (!history.strokes.length) return history;
  return {
    strokes: [],
    undo: [...history.undo, history.strokes].slice(-AI_IMAGE_MASK_HISTORY_LIMIT),
    redo: [],
  };
}

export function hasAiImageMaskPaint(history: AiImageMaskHistory): boolean {
  return history.strokes.some((stroke) => stroke.mode === 'paint');
}
