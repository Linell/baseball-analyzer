// Linked side elevation (release -> plate) on a 2D canvas, with a drag brush.
// Region selection happens here, not with a 3D lasso: a brushed rectangle
// selects every pitch whose flight passes through it.

import { CANVAS_BG, PALETTE, SIDE_SAMPLES, type Prepared } from './data';

const MIN_WIDTH = 240; // below this the mound-to-plate axis stops being readable
const HEIGHT = 150;
const PAD = { left: 8, right: 8, top: 8, bottom: 16 };
const MAX_Y = 58; // ft, past the deepest release
const MAX_Z = 9; // ft

/** Liang–Barsky: does the segment cross the axis-aligned rectangle? */
// prettier-ignore
function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, l: number, r: number, t: number, b: number): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  let lo = 0, hi = 1;
  for (const [p, q] of [[-dx, x1 - l], [dx, r - x1], [-dy, y1 - t], [dy, b - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const s = q / p;
    if (p < 0) { if (s > hi) return false; if (s > lo) lo = s; }
    else { if (s < lo) return false; if (s < hi) hi = s; }
  }
  return true;
}

export interface SideViewHandle {
  el: HTMLElement;
  redraw(vis: Uint8Array): void;
  dispose(): void;
}

export function createSideView(
  prepared: Prepared,
  onBrush: (indexes: Set<number> | null) => void,
): SideViewHandle {
  const el = document.createElement('div');
  el.className = 'showcase-sideview';
  const canvas = document.createElement('canvas');
  const scale = Math.min(window.devicePixelRatio, 2);
  let width = 0; // sized below, then tracked by the ResizeObserver
  canvas.style.height = `${HEIGHT}px`;
  el.appendChild(canvas);
  const caption = document.createElement('div');
  caption.className = 'showcase-sideview-caption';
  caption.textContent = 'Side view — drag to select a region, click to clear';
  el.appendChild(caption);
  const context = canvas.getContext('2d');

  // Mound on the left, plate on the right.
  const toPx = (y: number): number =>
    PAD.left + ((MAX_Y - y) / MAX_Y) * (width - PAD.left - PAD.right);
  const toPy = (z: number): number =>
    HEIGHT - PAD.bottom - (z / MAX_Z) * (HEIGHT - PAD.top - PAD.bottom);

  let vis: Uint8Array = new Uint8Array(prepared.payload.count).fill(1);
  let rect: { x0: number; y0: number; x1: number; y1: number } | null = null;

  // The 6,431 traces only change with visibility, never mid-drag, so they
  // render once per redraw() into an offscreen layer; draw() just blits it.
  const traces = document.createElement('canvas');
  const traceContext = traces.getContext('2d');

  function drawTraces(): void {
    if (!traceContext) return;
    traceContext.setTransform(scale, 0, 0, scale, 0, 0);
    traceContext.fillStyle = CANVAS_BG;
    traceContext.fillRect(0, 0, width, HEIGHT);
    traceContext.strokeStyle = 'rgba(255,255,255,0.22)';
    traceContext.beginPath();
    traceContext.moveTo(PAD.left, toPy(0));
    traceContext.lineTo(width - PAD.right, toPy(0));
    traceContext.stroke();
    const { payload, samples, slotByPitch } = prepared;
    traceContext.lineWidth = 1;
    for (let i = 0; i < payload.count; i++) {
      traceContext.strokeStyle = PALETTE[slotByPitch[i]];
      traceContext.globalAlpha = vis[i] ? 0.05 : 0.008;
      traceContext.beginPath();
      for (let k = 0; k < SIDE_SAMPLES; k++) {
        const o = (i * SIDE_SAMPLES + k) * 2;
        const x = toPx(samples[o]);
        const y = toPy(samples[o + 1]);
        if (k === 0) traceContext.moveTo(x, y);
        else traceContext.lineTo(x, y);
      }
      traceContext.stroke();
    }
    traceContext.globalAlpha = 1;
  }

  function draw(): void {
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(traces, 0, 0);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    if (rect) {
      const [x, y] = [Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1)];
      const [w, h] = [Math.abs(rect.x1 - rect.x0), Math.abs(rect.y1 - rect.y0)];
      context.strokeStyle = 'rgba(255,255,255,0.75)';
      context.fillStyle = 'rgba(255,255,255,0.08)';
      context.fillRect(x, y, w, h);
      context.strokeRect(x, y, w, h);
    }
  }

  function brushed(): Set<number> | null {
    if (!rect || (Math.abs(rect.x1 - rect.x0) < 4 && Math.abs(rect.y1 - rect.y0) < 4)) {
      return null;
    }
    const left = Math.min(rect.x0, rect.x1);
    const right = Math.max(rect.x0, rect.x1);
    const top = Math.min(rect.y0, rect.y1);
    const bottom = Math.max(rect.y0, rect.y1);
    const { payload, samples } = prepared;
    const hit = new Set<number>();
    for (let i = 0; i < payload.count; i++) {
      let [px, py] = [0, 0];
      for (let k = 0; k < SIDE_SAMPLES; k++) {
        const o = (i * SIDE_SAMPLES + k) * 2;
        const [qx, qy] = [toPx(samples[o]), toPy(samples[o + 1])];
        // segment test, not point-in-rect: a thin brush between samples still hits
        if (k > 0 && segmentHitsRect(px, py, qx, qy, left, right, top, bottom)) {
          hit.add(i);
          break;
        }
        [px, py] = [qx, qy];
      }
    }
    return hit;
  }

  let dragging = false;
  const point = (event: PointerEvent): { x: number; y: number } => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    rect = { x0: x, y0: y, x1: x, y1: y };
    draw();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || !rect) return;
    const { x, y } = point(event);
    rect = { ...rect, x1: x, y1: y };
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
    const selection = brushed();
    if (selection === null) rect = null; // a bare click clears the brush
    draw();
    onBrush(selection);
  });

  /** Full-width now, so the pitch axis stretches with the window. The brush
   *  rect is stored in canvas pixels, so a resize has to drop it and tell the
   *  caller — a stale rect would select a region the user never drew. */
  function resize(cssWidth: number): void {
    if (cssWidth < 1) return; // detached or hidden; keep the brush and the pixels
    const next = Math.max(MIN_WIDTH, Math.round(cssWidth));
    if (next === width) return;
    width = next;
    canvas.width = traces.width = width * scale;
    canvas.height = traces.height = HEIGHT * scale;
    const hadBrush = rect !== null;
    rect = null;
    drawTraces();
    draw();
    if (hadBrush) onBrush(null);
  }

  const observer = new ResizeObserver((entries) => {
    resize(entries[0].contentRect.width);
  });
  observer.observe(el);

  resize(MIN_WIDTH);
  return {
    el,
    redraw(next) {
      vis = next;
      drawTraces();
      draw();
    },
    dispose() {
      observer.disconnect(); // listeners die with the element; this does not
    },
  };
}
