'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Eraser, Paintbrush, Redo2, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  AI_IMAGE_MASK_STROKE_POINT_LIMIT,
  clearAiImageMaskHistory,
  commitAiImageMaskStroke,
  createAiImageMaskHistory,
  createAiImageMaskStroke,
  isAiImageMaskDimensionsSupported,
  redoAiImageMaskHistory,
  undoAiImageMaskHistory,
  type AiImageMaskHistory,
  type AiImageMaskMode,
  type AiImageMaskPoint,
  type AiImageMaskStroke,
} from '@/lib/ai-image-mask';

const MAX_MASK_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_PIXELS = 1_500_000;
const PROBE_EDGE = 160;

export interface SourceAiImageMaskEditorHandle {
  exportMaskDataUrl(): Promise<string>;
}

interface SourceAiImageMaskEditorProps {
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  resetKey: string;
  disabled?: boolean;
  onReadyChange?: (ready: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: AiImageMaskStroke,
  width: number,
  height: number,
  color: string,
) {
  const points = stroke.points;
  if (!points.length) return;
  const lineWidth = Math.max(1, stroke.size * Math.min(width, height));
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = lineWidth;
  context.strokeStyle = color;
  context.fillStyle = color;
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0]!.x * width, points[0]!.y * height, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(points[0]!.x * width, points[0]!.y * height);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index]!.x * width, points[index]!.y * height);
    }
    context.stroke();
  }
  context.restore();
}

function renderPreview(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: AiImageMaskStroke[],
) {
  context.clearRect(0, 0, width, height);
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    drawStroke(context, stroke, width, height, stroke.mode === 'erase' ? '#000000' : 'rgba(239, 68, 68, 0.68)');
  }
  context.globalCompositeOperation = 'source-over';
}

function renderExportMask(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: AiImageMaskStroke[],
) {
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  for (const stroke of strokes) {
    drawStroke(context, stroke, width, height, stroke.mode === 'paint' ? '#ffffff' : '#000000');
  }
}

function exportedMaskIsPartial(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const pixels = context.getImageData(0, 0, width, height).data;
  let selected = false;
  let preserved = false;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index]! > 0) selected = true;
    else preserved = true;
    if (selected && preserved) return true;
  }
  return false;
}

function effectiveMaskIsPartial(strokes: AiImageMaskStroke[], width: number, height: number) {
  if (!strokes.length || typeof document === 'undefined') return false;
  const scale = Math.min(PROBE_EDGE / width, PROBE_EDGE / height, 1);
  const probeWidth = Math.max(1, Math.round(width * scale));
  const probeHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = probeWidth;
  canvas.height = probeHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  renderPreview(context, probeWidth, probeHeight, strokes);
  const pixels = context.getImageData(0, 0, probeWidth, probeHeight).data;
  let selected = false;
  let preserved = false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index]! > 0) selected = true;
    else preserved = true;
    if (selected && preserved) return true;
  }
  return false;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('遮罩 PNG 编码失败'));
    }, 'image/png');
  });
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('遮罩 PNG 读取失败'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('遮罩 PNG 数据无效'));
    reader.readAsDataURL(blob);
  });
}

export const SourceAiImageMaskEditor = forwardRef<
  SourceAiImageMaskEditorHandle,
  SourceAiImageMaskEditorProps
>(function SourceAiImageMaskEditor({
  sourceUrl,
  sourceWidth,
  sourceHeight,
  resetKey,
  disabled = false,
  onReadyChange,
  onDirtyChange,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<AiImageMaskStroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const historyRef = useRef<AiImageMaskHistory>(createAiImageMaskHistory());
  const [history, setHistory] = useState<AiImageMaskHistory>(() => createAiImageMaskHistory());
  const [mode, setMode] = useState<AiImageMaskMode>('paint');
  const [brushPercent, setBrushPercent] = useState(5);
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'mismatch' | 'error'>('loading');
  const dimensionsValid = isAiImageMaskDimensionsSupported(sourceWidth, sourceHeight);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const strokes = activeStrokeRef.current
      ? [...historyRef.current.strokes, activeStrokeRef.current]
      : historyRef.current.strokes;
    renderPreview(context, canvas.width, canvas.height, strokes);
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  const applyHistory = useCallback((next: AiImageMaskHistory) => {
    historyRef.current = next;
    setHistory(next);
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    const next = createAiImageMaskHistory();
    activeStrokeRef.current = null;
    activePointerIdRef.current = null;
    historyRef.current = next;
    setHistory(next);
    setImageState('loading');
    onReadyChange?.(false);
    scheduleDraw();
  }, [onReadyChange, resetKey, scheduleDraw, sourceHeight, sourceWidth]);

  useEffect(() => {
    onDirtyChange?.(history.strokes.length > 0 || history.undo.length > 0 || history.redo.length > 0);
  }, [history.redo.length, history.strokes.length, history.undo.length, onDirtyChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const requestedScale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelScale = Math.min(
        requestedScale,
        Math.sqrt(MAX_PREVIEW_PIXELS / (rect.width * rect.height)),
      );
      canvas.width = Math.max(1, Math.round(rect.width * pixelScale));
      canvas.height = Math.max(1, Math.round(rect.height * pixelScale));
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [draw, resetKey]);

  useEffect(() => {
    const ready = dimensionsValid
      && imageState === 'ready'
      && effectiveMaskIsPartial(history.strokes, sourceWidth, sourceHeight);
    onReadyChange?.(ready);
  }, [dimensionsValid, history.strokes, imageState, onReadyChange, sourceHeight, sourceWidth]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    async exportMaskDataUrl() {
      if (!dimensionsValid) throw new Error('源图尺寸不支持局部重绘');
      if (imageState !== 'ready') throw new Error('源图尺寸尚未通过校验');
      if (!effectiveMaskIsPartial(historyRef.current.strokes, sourceWidth, sourceHeight)) {
        throw new Error('遮罩必须同时包含编辑区域和保留区域');
      }
      const canvas = document.createElement('canvas');
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('浏览器无法创建遮罩画布');
      renderExportMask(context, sourceWidth, sourceHeight, historyRef.current.strokes);
      if (!exportedMaskIsPartial(context, sourceWidth, sourceHeight)) {
        throw new Error('遮罩必须同时包含编辑区域和保留区域');
      }
      const blob = await canvasBlob(canvas);
      if (blob.size < 1 || blob.size > MAX_MASK_BYTES) throw new Error('遮罩 PNG 超过 20 MB 限制');
      return blobDataUrl(blob);
    },
  }), [dimensionsValid, imageState, sourceHeight, sourceWidth]);

  function pointFromPointer(event: ReactPointerEvent<HTMLCanvasElement>): AiImageMaskPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (
      disabled
      || imageState !== 'ready'
      || !event.isPrimary
      || event.button !== 0
      || activePointerIdRef.current !== null
    ) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    activeStrokeRef.current = createAiImageMaskStroke(mode, brushPercent / 100, pointFromPointer(event));
    scheduleDraw();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current;
    if (
      !stroke
      || activePointerIdRef.current !== event.pointerId
      || !event.isPrimary
      || !event.currentTarget.hasPointerCapture(event.pointerId)
    ) return;
    event.preventDefault();
    const next = pointFromPointer(event);
    const previous = stroke.points[stroke.points.length - 1];
    if (!previous || Math.hypot(next.x - previous.x, next.y - previous.y) >= 0.001) {
      if (stroke.points.length < AI_IMAGE_MASK_STROKE_POINT_LIMIT) stroke.points.push(next);
      scheduleDraw();
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLCanvasElement>, commit: boolean) {
    if (activePointerIdRef.current !== event.pointerId) return;
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    activeStrokeRef.current = null;
    if (commit) {
      applyHistory(commitAiImageMaskStroke(historyRef.current, {
        ...stroke,
        points: [...stroke.points],
      }));
    } else {
      scheduleDraw();
    }
  }

  function cancelLostPointerCapture(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = null;
    activeStrokeRef.current = null;
    scheduleDraw();
  }

  function undo() {
    applyHistory(undoAiImageMaskHistory(historyRef.current));
  }

  function redo() {
    applyHistory(redoAiImageMaskHistory(historyRef.current));
  }

  const aspectRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
  const editorMaxWidth = Math.min(720, Math.max(120, Math.round(480 * aspectRatio)));
  const editorDisabled = disabled || !dimensionsValid || imageState !== 'ready';

  return (
    <div className="space-y-3" data-ai-image-mask-editor>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="局部重绘遮罩工具">
        <Button type="button" size="icon" variant={mode === 'paint' ? 'default' : 'outline'} aria-label="画笔" aria-pressed={mode === 'paint'} title="画笔" onClick={() => setMode('paint')} disabled={editorDisabled}>
          <Paintbrush className="h-4 w-4" />
        </Button>
        <Button type="button" size="icon" variant={mode === 'erase' ? 'default' : 'outline'} aria-label="橡皮" aria-pressed={mode === 'erase'} title="橡皮" onClick={() => setMode('erase')} disabled={editorDisabled}>
          <Eraser className="h-4 w-4" />
        </Button>
        <div className="flex min-w-[150px] flex-1 items-center gap-2 sm:max-w-[260px]">
          <Label htmlFor={`ai-mask-brush-${resetKey}`} className="shrink-0 text-xs">尺寸</Label>
          <input id={`ai-mask-brush-${resetKey}`} type="range" min="1" max="25" step="1" value={brushPercent} onChange={(event) => setBrushPercent(Number(event.target.value))} disabled={editorDisabled} className="h-8 min-w-0 flex-1 accent-primary" />
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{brushPercent}%</span>
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="撤销" title="撤销" onClick={undo} disabled={editorDisabled || history.undo.length === 0}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="重做" title="重做" onClick={redo} disabled={editorDisabled || history.redo.length === 0}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="清空遮罩" title="清空遮罩" onClick={() => applyHistory(clearAiImageMaskHistory(historyRef.current))} disabled={editorDisabled || history.strokes.length === 0}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mx-auto w-full" style={{ maxWidth: `${editorMaxWidth}px` }}>
        <div className="relative w-full overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: `${Math.max(1, sourceWidth)} / ${Math.max(1, sourceHeight)}` }}>
          <img
            key={resetKey}
            src={sourceUrl}
            alt="局部重绘源图"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
            onLoad={(event) => {
              const image = event.currentTarget;
              setImageState(image.naturalWidth === sourceWidth && image.naturalHeight === sourceHeight ? 'ready' : 'mismatch');
            }}
            onError={() => setImageState('error')}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            style={{ touchAction: 'none' }}
            tabIndex={0}
            aria-label="局部重绘遮罩画布"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishPointer(event, true)}
            onPointerCancel={(event) => finishPointer(event, false)}
            onLostPointerCapture={cancelLostPointerCapture}
            onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
              event.preventDefault();
              if (event.shiftKey) redo();
              else undo();
            }}
          />
        </div>
      </div>

      {!dimensionsValid ? <p className="text-xs text-destructive">源图尺寸无效，超过 1200 万像素、16384 像素单边或 20:1 长宽比限制。</p> : null}
      {dimensionsValid && imageState === 'loading' ? <p className="text-xs text-muted-foreground">正在校验源图尺寸…</p> : null}
      {imageState === 'mismatch' ? <p className="text-xs text-destructive">源图显示尺寸与冻结像素尺寸不一致，请重新保存源图后再编辑。</p> : null}
      {imageState === 'error' ? <p className="text-xs text-destructive">源图加载失败，无法创建遮罩。</p> : null}
    </div>
  );
});

SourceAiImageMaskEditor.displayName = 'SourceAiImageMaskEditor';
